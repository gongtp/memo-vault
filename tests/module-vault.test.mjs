import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ModuleVault,parseBackupFile,MAX_BACKUP_BYTES} from '../module-vault.mjs';
import {VaultSession,DEFAULT_PASSWORD,ConflictError,LockedError,deriveKey,decryptVault} from '../vault.mjs';
import {newNote,normalizeDocuments,documentText,documentBlocks} from '../notes-model.mjs';
class Store{
 value=null;fail=false;
 async read(){return structuredClone(this.value);}
 async write(value,expected){if(this.fail)throw Error('保存失败');if((this.value?.changeId??null)!==expected)throw new ConflictError();this.value=structuredClone(value);}
}
const account={id:1,name:'测试账号',username:'me',password:'account-secret',category:'开发工具',method:'密码登录',url:'',note:'',favorite:false,date:'2026.10.23',color:'#efefff',ink:'#7a77ca',letter:'测'};
function note(){const n=newNote();n.title='note-secret';n.blocks[0].text='独立笔记';return n;}
async function fixture(){const store=new Store(),vault=new ModuleVault(store);await vault.load();return {store,vault};}
test('默认仅账号锁定；账号锁定后笔记仍可读取和写入，刷新保留',async()=>{
 const {store,vault}=await fixture();assert.deepEqual(vault.policy,{accounts:true,notes:false});assert.throws(()=>vault.accounts,LockedError);
 const n=note();await vault.saveNote(n,['生活']);await vault.unlock(DEFAULT_PASSWORD);await vault.save([account]);
 vault.lock();assert.throws(()=>vault.accounts,LockedError);assert.equal(vault.noteData.notes[0].title,n.title);
 await vault.saveNote({...n,title:'后台后继续编辑'});
 const reopened=new ModuleVault(store);await reopened.load();assert.equal(reopened.isOpen('accounts'),false);assert.equal(reopened.noteData.notes[0].title,'后台后继续编辑');
 assert.ok(!JSON.stringify(store.value).includes('account-secret'));
});
test('开启笔记锁定后两模块都受保护，用同一密码分别进入；取消账号锁定不会泄露受保护笔记',async()=>{
 const {store,vault}=await fixture();await vault.saveNote(note());await vault.unlock(DEFAULT_PASSWORD);await vault.save([account]);
 await assert.rejects(vault.setModuleLock('notes',true,'wrong'));assert.equal(vault.policy.notes,false);
 await vault.setModuleLock('notes',true,DEFAULT_PASSWORD);assert.ok(!JSON.stringify(store.value).includes('note-secret'));
 vault.lock();assert.throws(()=>vault.noteData,LockedError);await vault.unlock(DEFAULT_PASSWORD,'notes');assert.equal(vault.noteData.notes.length,1);assert.throws(()=>vault.accounts,LockedError);
 await vault.setModuleLock('accounts',false,DEFAULT_PASSWORD);vault.lock();assert.equal(vault.accounts.length,1);assert.throws(()=>vault.noteData,LockedError);
 const reopened=new ModuleVault(store);await reopened.load();assert.equal(reopened.accounts.length,1);assert.throws(()=>reopened.noteData,LockedError);
 await assert.rejects(decryptVault(store.value.notes,store.value.accountDeviceKey));
 await reopened.unlock(DEFAULT_PASSWORD,'notes');assert.equal(reopened.noteData.notes[0].title,'note-secret');
 await reopened.setModuleLock('accounts',true,DEFAULT_PASSWORD);assert.equal(store.value.accountDeviceKey,undefined);
});
test('迁移旧加密库原子保留账号、笔记、标签和主密码，失败时原库不变',async()=>{
 const store=new Store(),legacy=new VaultSession(store);await legacy.create('old-master-password');await legacy.save([account]);await legacy.saveNote(note(),['生活']);
 const before=structuredClone(store.value),vault=new ModuleVault(store);await vault.load();assert.equal(vault.legacy,true);assert.throws(()=>vault.noteData,LockedError);
 await assert.rejects(vault.unlock('wrong'));assert.deepEqual(store.value,before);
 store.fail=true;await assert.rejects(vault.unlock('old-master-password'));assert.deepEqual(store.value,before);
 store.fail=false;await vault.unlock('old-master-password','notes');assert.deepEqual(vault.noteData,legacy.noteData);assert.equal(vault.isOpen('accounts'),false);
 vault.lock();assert.equal(vault.noteData.tags[0].name,'生活');await vault.unlock('old-master-password');assert.deepEqual(vault.accounts,[account]);
});
test('统一改密、分模块备份、导入保留数据和目标设备开关，笔记保护开关不影响导出明文',async()=>{
 const {vault}=await fixture();await vault.saveNote(note());await vault.unlock(DEFAULT_PASSWORD);await vault.save([account]);await vault.setModuleLock('notes',true,DEFAULT_PASSWORD);
 const oldBackup=parseBackupFile(await vault.exportFile());await vault.changePassword('new-master-password');vault.lock();
 await assert.rejects(vault.unlock(DEFAULT_PASSWORD));await vault.unlock('new-master-password','settings');assert.equal(vault.noteData.notes.length,1);assert.equal(vault.accounts[0].password,'account-secret');
 const backup=parseBackupFile(await vault.exportFile()),encrypted=backup.modules.accounts;
 const decoded=await decryptVault(encrypted,await deriveKey('new-master-password',encrypted));assert.equal(decoded.noteData.notes.length,0);assert.deepEqual(decoded.settings.moduleLocks,{accounts:true,notes:true});
 assert.equal(backup.modules.notes.notes[0].title,'note-secret');assert.ok(!JSON.stringify(backup).includes('account-secret'));
 const oldEncrypted=oldBackup.modules.accounts;assert.equal((await decryptVault(oldEncrypted,await deriveKey(DEFAULT_PASSWORD,oldEncrypted))).accounts.length,1);
 const {vault:target}=await fixture();await target.unlock(DEFAULT_PASSWORD,'settings');const staged=await target.stageImport(backup,'new-master-password');await target.importPrepared(staged);
 assert.deepEqual(target.policy,{accounts:true,notes:false});target.lock();assert.equal(target.noteData.notes.length,1);await target.unlock(DEFAULT_PASSWORD);assert.deepEqual(target.accounts,[account]);
});
test('旧归档及回收站保留正文和标签，导入后统一恢复为普通文档',async()=>{
 const {vault}=await fixture();await vault.unlock(DEFAULT_PASSWORD,'settings');await vault.save([account]);
 const n=note(),archived={...note(),archivedAt:new Date().toISOString()},deleted={...note(),deletedAt:new Date().toISOString()};
 n.blocks.push({id:crypto.randomUUID(),type:'checklist',text:'已完成',checked:true});
 await vault.saveNote(n,['生活']);await vault.saveNote(archived,['归档']);await vault.saveNote(deleted,['回收站']);
 const text=await vault.exportFile(),backup=parseBackupFile(text);assert.ok(text.includes('独立笔记'));assert.ok(!text.includes('account-secret'));assert.ok(!text.includes('测试账号'));assert.ok(!text.includes('accountDeviceKey'));
 assert.equal(backup.modules.notes.notes.length,3);
 const {store,vault:target}=await fixture();await target.unlock(DEFAULT_PASSWORD,'settings');const before=structuredClone(store.value);
 await assert.rejects(target.stageImport(backup,'wrong'));assert.deepEqual(store.value,before);
 const staged=await target.stageImport(backup,DEFAULT_PASSWORD);await target.importPrepared(staged);assert.deepEqual(target.noteData,normalizeDocuments(vault.noteData));assert.deepEqual(target.accounts,[account]);
});
test('文档连续正文保留换行、旧列表与勾选状态，直接删除写入失败时保留原文档',async()=>{
 const legacy={blocks:[{type:'text',text:'第一段\n\n第二段'},{type:'bullet',text:'列表'},{type:'checklist',text:'已完成',checked:true},{type:'checklist',text:'待完成',checked:false}]};
 const text=documentText(legacy);assert.equal(text,'第一段\n\n第二段\n• 列表\n☑ 已完成\n☐ 待完成');assert.equal(documentText({blocks:documentBlocks(text)}),text);
 const {store,vault}=await fixture(),n=note();n.blocks=documentBlocks('普通文档\n\n保留空行与中文输入');await vault.saveNote(n,['文档']);
 const original=structuredClone(store.value);store.fail=true;await assert.rejects(vault.deleteNote(n.id));assert.deepEqual(store.value,original);assert.equal(vault.noteData.notes.length,1);
 store.fail=false;await vault.deleteNote(n.id);assert.equal(vault.noteData.notes.length,0);const reopened=new ModuleVault(store);await reopened.load();assert.equal(reopened.noteData.notes.length,0);
});
test('兼容旧整库加密备份，非法笔记、缺失模块和损坏账号密文都不会覆盖数据',async()=>{
 const oldStore=new Store(),legacy=new VaultSession(oldStore);await legacy.create('old-backup-password');await legacy.save([account]);await legacy.saveNote(note(),['旧笔记']);
 const legacyBackup=parseBackupFile(await legacy.exportFile());assert.equal(legacyBackup.type,'memo-vault-encrypted');
 const {store,vault}=await fixture();await vault.unlock(DEFAULT_PASSWORD,'settings');await vault.importPrepared(await vault.stageImport(legacyBackup,'old-backup-password'));
 assert.deepEqual(vault.accounts,[account]);assert.deepEqual(vault.noteData,legacy.noteData);
 const backup=parseBackupFile(await vault.exportFile()),before=structuredClone(store.value);
 const missing=structuredClone(backup);delete missing.modules.notes;assert.throws(()=>parseBackupFile(JSON.stringify(missing)));
 const invalid=structuredClone(backup);invalid.modules.notes.notes[0].tagIds=['missing'];await assert.rejects(vault.stageImport(invalid,DEFAULT_PASSWORD));
 const damaged=structuredClone(backup);damaged.modules.accounts.iv='AAAAAAAAAAAAAAAA';await assert.rejects(vault.stageImport(damaged,DEFAULT_PASSWORD));
 assert.deepEqual(store.value,before);assert.throws(()=>parseBackupFile('x'.repeat(MAX_BACKUP_BYTES+1)),/32 MB/);
});
test('普通笔记备份超过 5 MB 不再触发账号加密容量限制，并可完整导入',async()=>{
 const {vault}=await fixture();await vault.unlock(DEFAULT_PASSWORD,'settings');
 const notes=Array.from({length:290},()=>{const n=note();n.blocks[0].text='a'.repeat(19000);return n;});
 await vault.mutateNotes(()=>({notes,tags:[]}));
 const text=await vault.exportFile();assert.ok(new TextEncoder().encode(text).length>5*1024*1024);
 const backup=parseBackupFile(text);assert.equal(backup.modules.notes.notes.length,290);assert.ok(backup.modules.accounts.ciphertext.length<20000);
 const {vault:target}=await fixture();await target.unlock(DEFAULT_PASSWORD,'settings');await target.importPrepared(await target.stageImport(backup,DEFAULT_PASSWORD));
 assert.deepEqual(target.noteData,vault.noteData);
});
test('设置转换和改密写入失败不改数据，跨页冲突拒绝覆盖，锁定打断保护数据写入',async()=>{
 const {store,vault}=await fixture();await vault.unlock(DEFAULT_PASSWORD,'settings');await vault.save([account]);const before=structuredClone(store.value);
 store.fail=true;await assert.rejects(vault.setModuleLock('notes',true,DEFAULT_PASSWORD));assert.deepEqual(store.value,before);assert.equal(vault.policy.notes,false);
 await assert.rejects(vault.changePassword('next-password'));assert.deepEqual(store.value,before);store.fail=false;
 const other=new ModuleVault(store);await other.load();await other.saveNote(note());await assert.rejects(vault.save([account]),ConflictError);assert.equal(vault.isOpen('accounts'),false);
 const current=new ModuleVault(store);await current.load();await current.unlock(DEFAULT_PASSWORD);const pending=current.save([]);current.lock();await assert.rejects(pending,LockedError);
 await current.unlock(DEFAULT_PASSWORD);assert.equal(current.accounts.length,1);
});
test('未锁定笔记正在保存时切后台仍可完成，受保护笔记锁定后拒绝排队写入',async()=>{
 const {vault}=await fixture();const pending=vault.saveNote(note());vault.lock();await pending;assert.equal(vault.noteData.notes.length,1);
 await vault.setModuleLock('notes',true,DEFAULT_PASSWORD);const protectedWrite=vault.saveNote({...note(),title:'不得保存'});vault.lock();await assert.rejects(protectedWrite,LockedError);
});
test('跨页开启笔记保护后重载撤销旧的明文访问权限，错误密码不解锁',async()=>{
 const {store,vault}=await fixture();await vault.saveNote(note());
 const other=new ModuleVault(store);await other.load();await other.setModuleLock('notes',true,DEFAULT_PASSWORD);
 await vault.load();assert.equal(vault.policy.notes,true);assert.equal(vault.isOpen('notes'),false);assert.throws(()=>vault.noteData,LockedError);
 await assert.rejects(vault.unlock('wrong','notes'));assert.equal(vault.isOpen('notes'),false);
 await vault.unlock(DEFAULT_PASSWORD,'notes');assert.equal(vault.noteData.notes[0].title,'note-secret');
});
