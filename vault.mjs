// All persisted/exported account data is inside one authenticated ciphertext.
export const MAX_FILE_BYTES = 8 * 1024 * 1024;
export const ITERATIONS = 600000;
// Public bootstrap password only; never used as a fallback for an existing vault.
export const DEFAULT_PASSWORD = 'a12345678';
const TYPE = 'memo-vault-encrypted';
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', {fatal:true});
export const CATEGORIES = ['开发工具','日常生活','工作效率','社交娱乐'];
export const METHODS = ['密码登录','Apple 登录','Google 登录','手机验证码','通行密钥'];
const random = n => crypto.getRandomValues(new Uint8Array(n));
const to64 = bytes => {
  let result='';
  for(let i=0;i<bytes.length;i+=8192) result+=String.fromCharCode(...bytes.subarray(i,i+8192));
  return btoa(result);
};
const from64 = (text, min, max) => {
  if(typeof text!=='string'||text.length>Math.ceil(max/3)*4||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(text)) throw new Error('加密文件编码无效。');
  const bytes=Uint8Array.from(atob(text),c=>c.charCodeAt(0));
  if(bytes.length<min||bytes.length>max)throw new Error('加密文件长度无效。');
  return bytes;
};
export function validateAccounts(rows) {
  if(!Array.isArray(rows)||rows.length>10000)throw new Error('账号数据无效或超过 10,000 条。');
  const ids=new Set();
  return rows.map(a=>{
    if(!a||!Number.isSafeInteger(a.id)||a.id<1||ids.has(a.id))throw new Error('账号编号无效或重复。');
    ids.add(a.id);
    const str=(k,max,required=false)=>{
      if(typeof a[k]!=='string'||a[k].length>max||(required&&!a[k].trim()))throw new Error(`账号字段 ${k} 无效。`);
      return a[k];
    };
    if(typeof a.favorite!=='boolean')throw new Error('账号收藏标记无效。');
    const category=str('category',40),method=str('method',40);
    const url=str('url',500);
    if(url){try{if(!['https:','http:'].includes(new URL(url).protocol))throw Error();}catch{throw new Error('网址必须使用 HTTP 或 HTTPS。');}}
    const date=str('date',10);
    if(!/^\d{4}\.\d{2}\.\d{2}$/.test(date))throw new Error('账号日期格式无效。');
    const name=str('name',60,true);
    return {id:a.id,name,username:str('username',120,true),password:str('password',200),category,method,url,note:str('note',1000),favorite:a.favorite,date,
      color:typeof a.color==='string'&&/^#[a-f\d]{6}$/i.test(a.color)?a.color:'#efefff',
      ink:typeof a.ink==='string'&&/^#[a-f\d]{6}$/i.test(a.ink)?a.ink:'#7a77ca',
      letter:typeof a.letter==='string'?a.letter.slice(0,2):name.slice(0,1),...(a.logo==='github'?{logo:'github'}:{})};
  });
}
export function validateEnvelope(e) {
  if(!e||e.type!==TYPE||e.version!==1||e.cipher!=='AES-256-GCM'||e.kdf!=='PBKDF2-SHA-256')throw new Error('请选择 Memo Vault 加密文件，不支持旧版明文演示文件。');
  if(!Number.isSafeInteger(e.iterations)||e.iterations<ITERATIONS||e.iterations>2000000)throw new Error('文件密钥派生参数不受支持。');
  if(typeof e.changeId!=='string'||!/^\d{13}-[a-f\d]{32}$/.test(e.changeId))throw new Error('文件修订标记无效。');
  from64(e.salt,16,16);from64(e.iv,12,12);from64(e.ciphertext,16,5*1024*1024);
  // Reconstruct known fields: no prototype properties or arbitrary header fields.
  return {type:TYPE,version:1,cipher:'AES-256-GCM',kdf:'PBKDF2-SHA-256',iterations:e.iterations,salt:e.salt,iv:e.iv,changeId:e.changeId,ciphertext:e.ciphertext};
}
export function parseEncryptedFile(text){
  if(typeof text!=='string'||encoder.encode(text).length>MAX_FILE_BYTES)throw new Error('文件不能超过 8 MB。');
  let data;try{data=JSON.parse(text);}catch{throw new Error('无法读取该文件，请选择完整的加密备份。');}
  return validateEnvelope(data);
}
const aad = e => encoder.encode(JSON.stringify([e.type,e.version,e.cipher,e.kdf,e.iterations,e.salt,e.iv,e.changeId]));
export async function deriveKey(password,e){
  if(typeof password!=='string'||!password.length||password.length>1024)throw new Error('请输入主密码（最多 1024 个字符）。');
  const bytes=encoder.encode(password);
  let material;
  try{material=await crypto.subtle.importKey('raw',bytes,'PBKDF2',false,['deriveKey']);}finally{bytes.fill(0);}
  return crypto.subtle.deriveKey({name:'PBKDF2',hash:'SHA-256',iterations:e.iterations,salt:from64(e.salt,16,16)},material,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
}
export function validateSettings(value){
  if(value===undefined)return {verifyBeforeActions:true,usesInitialPassword:false};
  if(!value||typeof value.verifyBeforeActions!=='boolean'||typeof value.usesInitialPassword!=='boolean')throw new Error('信息库设置格式无效。');
  return {verifyBeforeActions:value.verifyBeforeActions,usesInitialPassword:value.usesInitialPassword};
}
export function validateOptions(value,accounts=[]){
  if(value===undefined)value={categories:[...new Set([...CATEGORIES,...accounts.map(a=>a.category).filter(Boolean)])],methods:[...new Set([...METHODS,...accounts.map(a=>a.method).filter(Boolean)])]};
  if(!value||typeof value!=='object')throw new Error('分类和登录方式设置无效。');
  const result={};
  for(const kind of ['categories','methods']){
    const list=value[kind];
    if(!Array.isArray(list)||list.length>100||list.some(name=>typeof name!=='string'||!name.trim()||name!==name.trim()||name.length>40)||new Set(list).size!==list.length)throw new Error('选项名称应为 1 至 40 个字符、不能重复，每组最多 100 个。');
    result[kind]=[...list];
  }
  for(const a of accounts)if((a.category&&!result.categories.includes(a.category))||(a.method&&!result.methods.includes(a.method)))throw new Error('账号引用了已删除或不存在的分类/登录方式。');
  return result;
}
export async function encryptAccounts(accounts,key,params,settings,options){
  const header={type:TYPE,version:1,cipher:'AES-256-GCM',kdf:'PBKDF2-SHA-256',iterations:params.iterations,salt:params.salt,iv:to64(random(12)),changeId:`${Date.now()}-${Array.from(random(16),n=>n.toString(16).padStart(2,'0')).join('')}`};
  const checked=validateAccounts(accounts);
  const bytes=encoder.encode(JSON.stringify({schemaVersion:1,accounts:checked,settings:validateSettings(settings),options:validateOptions(options,checked)}));
  try{
    if(bytes.length>5*1024*1024-16)throw new Error('信息库超过当前 5 MB 容量限制。');
    const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv:from64(header.iv,12,12),additionalData:aad(header),tagLength:128},key,bytes);
    return {...header,ciphertext:to64(new Uint8Array(encrypted))};
  }finally{bytes.fill(0);}
}
export async function decryptVault(envelope,key){
  const e=validateEnvelope(envelope);
  let plain;
  try{plain=new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:from64(e.iv,12,12),additionalData:aad(e),tagLength:128},key,from64(e.ciphertext,16,5*1024*1024)));}
  catch{throw new Error('主密码不正确，或加密数据已损坏。');}
  try{const data=JSON.parse(decoder.decode(plain));if(data.schemaVersion!==1)throw new Error('信息库数据版本不受支持。');const accounts=validateAccounts(data.accounts);return {accounts,settings:validateSettings(data.settings),options:validateOptions(data.options,accounts)};}finally{plain.fill(0);}
}
export async function decryptAccounts(envelope,key){return (await decryptVault(envelope,key)).accounts;}

export class ConflictError extends Error {constructor(){super('另一页面已修改信息库。已锁定，请重新解锁后再编辑。');}}
export class LockedError extends Error {constructor(){super('信息库已锁定，请重新解锁。');}}

export class IndexedVaultStore {
  #db;
  async open(){
    if(this.#db)return this.#db;
    this.#db=await new Promise((resolve,reject)=>{
      const request=indexedDB.open('memo-vault-secure',1);
      request.onupgradeneeded=()=>request.result.createObjectStore('vault');
      request.onsuccess=()=>{request.result.onversionchange=()=>{request.result.close();this.#db=null;};resolve(request.result);};
      request.onerror=()=>reject(new Error('无法打开本地存储，请检查浏览器是否允许网站保存数据。'));
      request.onblocked=()=>reject(new Error('请关闭其他 Memo Vault 页面后重试。'));
    });return this.#db;
  }
  async read(){
    const db=await this.open();
    return new Promise((resolve,reject)=>{
      const tx=db.transaction('vault','readonly');const request=tx.objectStore('vault').get('primary');
      tx.oncomplete=()=>resolve(request.result??null);tx.onabort=tx.onerror=()=>reject(new Error('读取本地信息库失败，未更改数据。'));
    });
  }
  async write(envelope,expectedChangeId){
    const db=await this.open();
    return new Promise((resolve,reject)=>{
      const tx=db.transaction('vault','readwrite');const store=tx.objectStore('vault');let conflict=false;
      const request=store.get('primary');
      request.onsuccess=()=>{
        if((request.result?.changeId??null)!==expectedChangeId){conflict=true;tx.abort();return;}
        store.put(envelope,'primary');
      };
      tx.oncomplete=()=>resolve();
      tx.onabort=tx.onerror=()=>reject(conflict?new ConflictError():new Error('加密数据保存失败，原数据未被替换。请检查存储空间或权限。'));
    });
  }
}

export class VaultSession {
  #store; #key=null; #accounts=[]; #settings=null; #options=null; #envelope=null; #queue=Promise.resolve();
  generation=0;
  constructor(store){this.#store=store;}
  get unlocked(){return this.#key!==null;}
  get accounts(){this.assertUnlocked();return structuredClone(this.#accounts);}
  get settings(){this.assertUnlocked();return {...this.#settings};}
  get options(){this.assertUnlocked();return structuredClone(this.#options);}
  assertUnlocked(){if(!this.#key)throw new LockedError();}
  #check(generation){if(this.generation!==generation)throw new LockedError();}
  lock(){this.generation++;this.#key=null;this.#accounts=[];this.#settings=null;this.#options=null;this.#envelope=null;}
  async exists(){return (await this.#store.read())!==null;}
  async create(password){
    if(typeof password!=='string'||password.length<8||password.length>1024)throw new Error('主密码需要 8 至 1024 个字符，建议使用较长的独特口令。');
    const generation=this.generation;
    if(await this.exists())throw new Error('当前设备已有信息库，请先解锁。');
    const params={iterations:ITERATIONS,salt:to64(random(16))};
    const key=await deriveKey(password,params);this.#check(generation);
    const settings={verifyBeforeActions:false,usesInitialPassword:password===DEFAULT_PASSWORD};
    const options=validateOptions();const envelope=await encryptAccounts([],key,params,settings,options);this.#check(generation);
    await this.#store.write(envelope,null);this.#check(generation);
    this.#key=key;this.#accounts=[];this.#settings=settings;this.#options=options;this.#envelope=envelope;
  }
  async unlock(password){
    const generation=this.generation;const raw=await this.#store.read();
    if(!raw)throw new Error('当前设备还没有信息库。');
    const envelope=validateEnvelope(raw);const key=await deriveKey(password,envelope);
    const data=await decryptVault(envelope,key);this.#check(generation);
    this.#key=key;this.#accounts=data.accounts;this.#settings=data.settings;this.#options=data.options;this.#envelope=envelope;
  }
  async verify(password){
    this.assertUnlocked();const generation=this.generation;
    const envelope=this.#envelope;const key=await deriveKey(password,envelope);this.#check(generation);
    await decryptAccounts(envelope,key);this.#check(generation);
    return generation;
  }
  save(accounts){
    this.assertUnlocked();const generation=this.generation;const snapshot=validateAccounts(accounts);
    const work=this.#queue.catch(()=>{}).then(async()=>{
      this.#check(generation);this.assertUnlocked();
      const envelope=await encryptAccounts(snapshot,this.#key,this.#envelope,this.#settings,this.#options);this.#check(generation);
      try{await this.#store.write(envelope,this.#envelope.changeId);}catch(error){if(error instanceof ConflictError)this.lock();throw error;}
      this.#check(generation);this.#envelope=envelope;this.#accounts=snapshot;
    });this.#queue=work;return work;
  }
  async exportFile(){
    const generation=this.generation;await this.#queue.catch(()=>{});this.#check(generation);this.assertUnlocked();
    return JSON.stringify(this.#envelope,null,2);
  }
  deleteAccount(id){
    this.assertUnlocked();
    if(!Number.isSafeInteger(id)||id<1)throw new Error('账号编号无效。');
    const generation=this.generation;
    const work=this.#queue.catch(()=>{}).then(async()=>{
      this.#check(generation);this.assertUnlocked();
      if(!this.#accounts.some(a=>a.id===id))throw new Error('账号不存在，未删除任何数据。');
      const next=this.#accounts.filter(a=>a.id!==id);
      const envelope=await encryptAccounts(next,this.#key,this.#envelope,this.#settings,this.#options);this.#check(generation);
      try{await this.#store.write(envelope,this.#envelope.changeId);}catch(error){if(error instanceof ConflictError)this.lock();throw error;}
      this.#check(generation);this.#accounts=next;this.#envelope=envelope;
    });this.#queue=work;return work;
  }
  updateSettings(verifyBeforeActions){
    this.assertUnlocked();if(typeof verifyBeforeActions!=='boolean')throw new Error('操作验证设置无效。');
    const generation=this.generation;
    const work=this.#queue.catch(()=>{}).then(async()=>{
      this.#check(generation);this.assertUnlocked();
      const settings={...this.#settings,verifyBeforeActions};
      const envelope=await encryptAccounts(this.#accounts,this.#key,this.#envelope,settings,this.#options);this.#check(generation);
      try{await this.#store.write(envelope,this.#envelope.changeId);}catch(error){if(error instanceof ConflictError)this.lock();throw error;}
      this.#check(generation);this.#settings=settings;this.#envelope=envelope;
    });this.#queue=work;return work;
  }
  addOption(kind,name){return this.#changeOption(kind,name);}
  removeOption(kind,name){return this.#changeOption(kind,name,true);}
  #changeOption(kind,name,remove=false){
    this.assertUnlocked();
    if(!['categories','methods'].includes(kind)||typeof name!=='string'||!name.trim()||name.trim().length>40)throw new Error('请输入 1 至 40 个字符的选项名称。');
    name=name.trim();const generation=this.generation;
    const work=this.#queue.catch(()=>{}).then(async()=>{
      this.#check(generation);this.assertUnlocked();
      const options=structuredClone(this.#options);let accounts=this.#accounts;
      if(!remove){
        if(options[kind].includes(name))throw new Error('这个选项已经存在。');
        options[kind].push(name);
      }else{
        if(!options[kind].includes(name))throw new Error('这个选项已经不存在。');
        const field=kind==='categories'?'category':'method';
        const count=this.#accounts.filter(a=>a[field]===name).length;
        if(count)throw new Error(`已有 ${count} 个账号使用此选项，不可删除。请先修改相关账号。`);
        options[kind]=options[kind].filter(item=>item!==name);
      }
      validateOptions(options,accounts);
      const envelope=await encryptAccounts(accounts,this.#key,this.#envelope,this.#settings,options);this.#check(generation);
      try{await this.#store.write(envelope,this.#envelope.changeId);}catch(error){if(error instanceof ConflictError)this.lock();throw error;}
      this.#check(generation);this.#options=options;this.#accounts=accounts;this.#envelope=envelope;
    });this.#queue=work;return work;
  }
  changePassword(password){
    this.assertUnlocked();
    if(typeof password!=='string'||password.length<8||password.length>1024)throw new Error('新主密码需要 8 至 1024 个字符。');
    const generation=this.generation,usesInitialPassword=password===DEFAULT_PASSWORD;
    const work=this.#queue.catch(()=>{}).then(async()=>{
      this.#check(generation);this.assertUnlocked();
      const params={iterations:ITERATIONS,salt:to64(random(16))};
      const key=await deriveKey(password,params);password='';this.#check(generation);
      const settings={...this.#settings,usesInitialPassword};
      const envelope=await encryptAccounts(this.#accounts,key,params,settings,this.#options);this.#check(generation);
      try{await this.#store.write(envelope,this.#envelope.changeId);}catch(error){if(error instanceof ConflictError)this.lock();throw error;}
      this.#check(generation);this.#key=key;this.#settings=settings;this.#envelope=envelope;
    });this.#queue=work;return work;
  }
  async stageImport(envelope,password){
    const generation=this.generation;const current=await this.#store.read();
    if(current&&!this.unlocked)throw new Error('请先解锁当前信息库，再导入替换。');
    const parsed=validateEnvelope(envelope);const key=await deriveKey(password,parsed);
    const data=await decryptVault(parsed,key);this.#check(generation);
    return {generation,expectedChangeId:current?.changeId??null,envelope:parsed,key,accounts:data.accounts,settings:data.settings,options:data.options};
  }
  async importPrepared(staged){
    const work=this.#queue.catch(()=>{}).then(async()=>{
      this.#check(staged.generation);
      // Existing local vault keeps its own master password. New device adopts file password.
      const key=this.#key??staged.key;const params=this.#envelope??staged.envelope;
      const settings=this.#settings?{...staged.settings,usesInitialPassword:this.#settings.usesInitialPassword}:staged.settings;
      const envelope=await encryptAccounts(staged.accounts,key,params,settings,staged.options);this.#check(staged.generation);
      try{await this.#store.write(envelope,staged.expectedChangeId);}catch(error){if(error instanceof ConflictError)this.lock();throw error;}
      this.#check(staged.generation);this.#key=key;this.#accounts=structuredClone(staged.accounts);this.#settings=validateSettings(settings);this.#options=validateOptions(staged.options,staged.accounts);this.#envelope=envelope;
    });this.#queue=work;return work;
  }
}
