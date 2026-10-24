import {IndexedVaultStore,DEFAULT_PASSWORD,ITERATIONS,deriveKey,encryptAccounts,decryptVault,validateEnvelope,validateAccounts,validateOptions,validateSettings,ConflictError,LockedError} from './vault.mjs';
import {validateNoteData,normalizeDocuments} from './notes-model.mjs';

const defaults=()=>({accounts:true,notes:false});
const empty=()=>({notes:[],tags:[]});
const params=()=>({iterations:ITERATIONS,salt:btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))))});
const revision=()=>`${Date.now()}-${crypto.randomUUID().replaceAll('-','')}`;
export const MAX_BACKUP_BYTES=32*1024*1024;
const backupEncoder=new TextEncoder();
export function validateBackup(value){
  if(value?.type==='memo-vault-encrypted')return validateEnvelope(value);
  if(value?.type!=='memo-vault-backup'||value.version!==1||!value.modules||Object.keys(value.modules).length!==2||!Object.hasOwn(value.modules,'accounts')||!Object.hasOwn(value.modules,'notes'))throw Error('请选择 Memo Vault 备份 JSON，不支持此文件格式或版本。');
  return {type:'memo-vault-backup',version:1,modules:{accounts:validateEnvelope(value.modules.accounts),notes:validateNoteData(value.modules.notes??null)}};
}
export function parseBackupFile(text){
  if(typeof text!=='string'||text.length>MAX_BACKUP_BYTES||backupEncoder.encode(text).length>MAX_BACKUP_BYTES)throw Error('备份文件不能超过 32 MB。');
  let value;try{value=JSON.parse(text);}catch{throw Error('无法读取该 JSON，请选择完整的备份文件。');}
  return validateBackup(value);
}

// One IndexedDB transaction commits the two modules and their access policy together.
// The optional account device key is non-extractable and is never used for notes.
export class ModuleVault {
  #store;#record=null;#account=null;#accountKey=null;#notes=null;#noteKey=null;#queue=Promise.resolve();#verified=false;
  #open={accounts:false,notes:false};#warning='';
  generation=0;
  notesGeneration=0;
  constructor(store=new IndexedVaultStore()){this.#store=store;}
  get legacy(){return this.#record?.type==='memo-vault-encrypted';}
  get policy(){return structuredClone(this.legacy?defaults():this.#record?.policy??defaults());}
  get authenticated(){return this.#verified;}
  get unlocked(){return this.isOpen('accounts');}
  get hasProtectedAccess(){return this.#verified;}
  get maintenanceWarning(){return this.#warning;}
  get settings(){return {...(this.#account?.settings??{verifyBeforeActions:false,usesInitialPassword:false}),moduleLocks:this.policy};}
  isOpen(module){return Boolean(this.#open[module]);}
  #assert(module){if(!this.isOpen(module))throw new LockedError();}
  #check(generation){if(typeof generation==='object'?generation.notes!==this.notesGeneration:generation!==this.generation)throw new LockedError();}
  get accounts(){this.#assert('accounts');return structuredClone(this.#account.accounts);}
  get options(){this.#assert('accounts');return structuredClone(this.#account.options);}
  get noteData(){this.#assert('notes');return structuredClone(this.#notes);}
  async exists(){return Boolean(await this.#store.read());}
  async load(){
    this.generation++;this.notesGeneration++;this.#verified=false;this.#open={accounts:false,notes:false};
    this.#account=null;this.#accountKey=null;this.#notes=null;this.#noteKey=null;this.#warning='';
    const generation=this.generation;const record=await this.#store.read();this.#check(generation);
    if(!record){
      const p=params(),key=await deriveKey(DEFAULT_PASSWORD,p);
      const settings={verifyBeforeActions:false,usesInitialPassword:true};
      const account=await encryptAccounts([],key,p,settings,validateOptions(),empty());this.#check(generation);
      const next={type:'memo-vault-modules',version:1,changeId:revision(),policy:defaults(),account,notes:empty()};
      await this.#store.write(next,null);this.#check(generation);this.#record=next;
    }else if(record.type==='memo-vault-encrypted'){
      validateEnvelope(record);this.#record=record;return;
    }else{
      if(record.type!=='memo-vault-modules'||record.version!==1||!record.policy||typeof record.policy.accounts!=='boolean'||typeof record.policy.notes!=='boolean')throw Error('模块信息库格式无效。');
      validateEnvelope(record.account);
      if(record.policy.notes)validateEnvelope(record.notes);else validateNoteData(record.notes);
      if(!record.policy.accounts&&!record.accountDeviceKey)throw Error('账号免解锁密钥缺失，请使用备份恢复。');
      this.#record=record;
    }
    if(!this.policy.notes){this.#notes=validateNoteData(this.#record.notes);this.#open.notes=true;}
    if(!this.policy.accounts){
      const data=await decryptVault(this.#record.account,this.#record.accountDeviceKey);this.#check(generation);
      this.#account=data;this.#accountKey=this.#record.accountDeviceKey;this.#open.accounts=true;
    }
    if(this.isOpen('notes'))await this.#maintainNotes();
  }
  lock(){
    this.generation++;this.#verified=false;this.#noteKey=null;
    if(this.policy.accounts){this.#account=null;this.#accountKey=null;this.#open.accounts=false;}
    if(this.policy.notes){this.notesGeneration++;this.#notes=null;this.#open.notes=false;}
  }
  async #commit(next,generation){
    this.#check(generation);next.changeId=revision();
    try{await this.#store.write(next,this.#record?.changeId??null);}catch(error){if(error instanceof ConflictError)this.lock();throw error;}
    this.#check(generation);this.#record=next;
  }
  #run(work,notes=false){
    const generation=notes?{notes:this.notesGeneration}:this.generation;
    const task=this.#queue.catch(()=>{}).then(async()=>{this.#check(generation);return work(generation);});
    this.#queue=task;return task;
  }
  async unlock(password,module='accounts'){
    return this.#run(async generation=>{
      const envelope=this.legacy?this.#record:this.#record.account;
      const key=await deriveKey(password,envelope),data=await decryptVault(envelope,key);this.#check(generation);
      let notes,noteKey=null;
      if(this.legacy){
        notes=normalizeDocuments(data.noteData);
        const account=await encryptAccounts(data.accounts,key,envelope,data.settings,data.options,empty());
        await this.#commit({type:'memo-vault-modules',version:1,policy:defaults(),account,notes},generation);
      }else if(this.policy.notes){
        noteKey=await deriveKey(password,this.#record.notes);
        notes=(await decryptVault(this.#record.notes,noteKey)).noteData;
      }else notes=validateNoteData(this.#record.notes);
      this.#check(generation);this.#account=data;this.#accountKey=key;this.#notes=notes;this.#noteKey=noteKey;this.#verified=true;
      if(module==='settings'){this.#open.accounts=true;this.#open.notes=true;}
      else {this.#open[module]=true;if(!this.policy.notes)this.#open.notes=true;if(!this.policy.accounts)this.#open.accounts=true;}
      await this.#maintainNotes(generation);
    });
  }
  async #maintainNotes(generation=this.generation){
    const cleaned=normalizeDocuments(this.#notes);
    if(JSON.stringify(cleaned)===JSON.stringify(this.#notes))return;
    const next=structuredClone(this.#record);
    next.notes=this.policy.notes?await encryptAccounts([],this.#noteKey,next.notes,this.settings,validateOptions(),cleaned):cleaned;
    try{await this.#commit(next,generation);this.#notes=cleaned;this.#warning='';}
    catch(error){if(error instanceof LockedError||error instanceof ConflictError)throw error;this.#warning='旧文档整理未完成，原数据已保留，可稍后重试。';}
  }
  async verify(password){
    const generation=this.generation,envelope=this.legacy?this.#record:this.#record.account;
    await decryptVault(envelope,await deriveKey(password,envelope));this.#check(generation);return generation;
  }
  async setModuleLock(module,locked,password){
    if(!['accounts','notes'].includes(module)||typeof locked!=='boolean')throw Error('模块设置无效。');
    // Always verify for policy changes, even when operation verification is disabled.
    await this.unlock(password,'settings');
    return this.#run(async generation=>{
      const next=structuredClone(this.#record);next.policy[module]=locked;
      let key=this.#noteKey;
      if(module==='accounts'){
        if(locked)delete next.accountDeviceKey;else next.accountDeviceKey=this.#accountKey;
      }else if(locked){
        const p=params();key=await deriveKey(password,p);
        next.notes=await encryptAccounts([],key,p,this.#account.settings,validateOptions(),this.#notes);
      }else {next.notes=structuredClone(this.#notes);key=null;}
      await this.#commit(next,generation);this.#noteKey=key;
    });
  }
  #editAccount(change,requireAccess=true){
    if(requireAccess)this.#assert('accounts');else if(!this.#verified)throw new LockedError();
    return this.#run(async generation=>{
      const data=structuredClone(this.#account);change(data);
      data.accounts=validateAccounts(data.accounts);data.settings=validateSettings(data.settings);data.options=validateOptions(data.options,data.accounts);
      const next=structuredClone(this.#record);
      next.account=await encryptAccounts(data.accounts,this.#accountKey,next.account,data.settings,data.options,empty());
      await this.#commit(next,generation);this.#account=data;
    });
  }
  save(accounts){const snapshot=validateAccounts(accounts);return this.#editAccount(d=>{d.accounts=snapshot;});}
  deleteAccount(id){return this.#editAccount(d=>{if(!d.accounts.some(a=>a.id===id))throw Error('账号不存在。');d.accounts=d.accounts.filter(a=>a.id!==id);});}
  updateSettings(value){if(typeof value!=='boolean')throw Error('操作验证设置无效。');return this.#editAccount(d=>{d.settings.verifyBeforeActions=value;},false);}
  addOption(kind,name){return this.#option(kind,name,false);}
  removeOption(kind,name){return this.#option(kind,name,true);}
  #option(kind,name,remove){
    return this.#editAccount(d=>{
      if(!['categories','methods'].includes(kind)||typeof name!=='string'||!name.trim()||name.trim().length>40)throw Error('选项名称无效。');
      name=name.trim();const list=d.options[kind];
      if(remove){if(d.accounts.some(a=>a[kind==='categories'?'category':'method']===name))throw Error('已有账号正在使用，不能删除。');d.options[kind]=list.filter(n=>n!==name);}
      else{if(list.includes(name))throw Error('这个选项已经存在。');list.push(name);}
    });
  }
  mutateNotes(change){
    this.#assert('notes');
    return this.#run(async generation=>{
      const notes=validateNoteData(change(structuredClone(this.#notes)));
      const next=structuredClone(this.#record);
      next.notes=this.policy.notes?await encryptAccounts([],this.#noteKey,next.notes,this.settings,validateOptions(),notes):notes;
      await this.#commit(next,generation);this.#notes=notes;
    },true);
  }
  saveNote(note,tagNames){
    const snapshot=structuredClone(note),names=tagNames===undefined?undefined:[...tagNames];
    return this.mutateNotes(data=>{
      if(names)snapshot.tagIds=[...new Set(names.map(n=>n.trim()).filter(Boolean).map(name=>{
        let tag=data.tags.find(t=>t.name.toLocaleLowerCase()===name.toLocaleLowerCase());
        if(!tag){tag={id:crypto.randomUUID(),name};data.tags.push(tag);}return tag.id;
      }))];
      const index=data.notes.findIndex(n=>n.id===snapshot.id);if(index<0)data.notes.push(snapshot);else data.notes[index]=snapshot;return data;
    });
  }
  changeNoteTag(id,name){return this.mutateNotes(data=>{const tag=data.tags.find(t=>t.id===id);if(!tag)throw Error('标签不存在。');if(name===null){data.tags=data.tags.filter(t=>t.id!==id);for(const n of data.notes)n.tagIds=n.tagIds.filter(t=>t!==id);}else tag.name=name.trim();return data;});}
  deleteNote(id){return this.mutateNotes(data=>{if(!data.notes.some(n=>n.id===id))throw Error('文档不存在。');return {...data,notes:data.notes.filter(n=>n.id!==id)};});}
  exportFile(){
    if(!this.#verified)throw new LockedError();
    return this.#run(async generation=>{
      const accounts=await encryptAccounts(this.#account.accounts,this.#accountKey,this.#record.account,{...this.#account.settings,moduleLocks:this.policy},this.#account.options,empty());
      this.#check(generation);
      // Export policy is separate from local module protection: notes are ordinary JSON.
      const backup={type:'memo-vault-backup',version:1,exportedAt:new Date().toISOString(),modules:{accounts,notes:validateNoteData(this.#notes)}};
      const text=JSON.stringify(backup,null,2);
      if(backupEncoder.encode(text).length>MAX_BACKUP_BYTES)throw Error('备份文件超过当前 32 MB 限制，请减少笔记内容后重试。');
      return text;
    });
  }
  stageImport(envelope,password){
    if(!this.#verified)throw new LockedError();
    return this.#run(async generation=>{
      const backup=validateBackup(envelope),mixed=backup.type==='memo-vault-backup';
      const parsed=mixed?backup.modules.accounts:backup,key=await deriveKey(password,parsed),data=await decryptVault(parsed,key);this.#check(generation);
      if(mixed)data.noteData=backup.modules.notes;
      return {...data,generation,expectedChangeId:this.#record.changeId};
    });
  }
  importPrepared(staged){
    if(!this.#verified)throw new LockedError();
    return this.#run(async generation=>{
      this.#check(staged.generation);if(staged.expectedChangeId!==this.#record.changeId)throw new ConflictError();
      const next=structuredClone(this.#record),settings={...staged.settings,usesInitialPassword:this.#account.settings.usesInitialPassword};
      const noteData=normalizeDocuments(validateNoteData(staged.noteData));
      // Keep this device's policy and keys; exports carry the source policy as a hint only.
      next.account=await encryptAccounts(staged.accounts,this.#accountKey,next.account,settings,staged.options,empty());
      next.notes=this.policy.notes?await encryptAccounts([],this.#noteKey,next.notes,settings,validateOptions(),noteData):noteData;
      await this.#commit(next,generation);this.#account={accounts:staged.accounts,settings,options:staged.options};this.#notes=noteData;
    });
  }
  changePassword(password){
    if(!this.#verified)throw new LockedError();
    if(typeof password!=='string'||password.length<8||password.length>1024)throw Error('主密码需要 8 至 1024 个字符。');
    return this.#run(async generation=>{
      const next=structuredClone(this.#record),p=params(),key=await deriveKey(password,p);
      const settings={...this.#account.settings,usesInitialPassword:password===DEFAULT_PASSWORD};
      next.account=await encryptAccounts(this.#account.accounts,key,p,settings,this.#account.options,empty());
      let noteKey=null;
      if(this.policy.notes){const np=params();noteKey=await deriveKey(password,np);next.notes=await encryptAccounts([],noteKey,np,settings,validateOptions(),this.#notes);}
      if(!this.policy.accounts)next.accountDeviceKey=key;
      await this.#commit(next,generation);this.#accountKey=key;this.#noteKey=noteKey;this.#account.settings=settings;
    });
  }
}
