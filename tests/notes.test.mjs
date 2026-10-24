import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {VaultSession,ConflictError,LockedError,parseEncryptedFile,deriveKey,decryptVault} from '../vault.mjs';
import {newNote,validateNoteData,filterNotes,pruneNoteData,RETENTION_MS,noteTitle} from '../notes-model.mjs';
const password='notes-test-password';
const account={id:1,name:'保留账号',username:'user',password:'private-password',category:'开发工具',method:'密码登录',url:'',note:'原账号备注',favorite:true,date:'2026.10.23',color:'#efefff',ink:'#7a77ca',letter:'保'};
class MemoryStore{
 value=null;fail=false;
 async read(){return structuredClone(this.value);}
 async write(value,expected){if((this.value?.changeId??null)!==expected)throw new ConflictError();if(this.fail)throw Error('模拟存储失败');this.value=structuredClone(value);}
}
async function fixture(){const store=new MemoryStore(),session=new VaultSession(store);await session.create(password);return {store,session};}
function sample(){const n=newNote();n.title='PRIVATE_NOTE_TITLE';n.blocks[0].text='正文 <script>private</script>';n.blocks.push({id:crypto.randomUUID(),type:'checklist',text:'买咖啡',checked:true});return n;}

test('笔记与账号交错写入、设置及分类修改、删除账号、密码修改不会覆盖其他模块',async()=>{
 const {session,store}=await fixture();const n=sample();
 await Promise.all([session.save([account]),session.saveNote(n,['生活']),session.updateSettings(true),session.addOption('categories','笔记回归')]);
 assert.deepEqual(session.accounts,[account]);assert.equal(session.noteData.notes.length,1);assert.equal(session.noteData.tags[0].name,'生活');
 await Promise.all([session.saveNote({...n,title:'第二次编辑'},['生活','工作']),session.changePassword('changed-notes-password')]);
 await session.deleteAccount(1);assert.equal(session.noteData.notes[0].title,'第二次编辑');await session.save([account]);
 session.lock();await session.unlock('changed-notes-password');assert.deepEqual(session.accounts,[account]);assert.equal(session.noteData.notes[0].blocks[1].checked,true);
 const text=JSON.stringify(store.value);for(const secret of ['第二次编辑','买咖啡','生活',account.password])assert.ok(!text.includes(secret));
});

test('完整备份迁移所有笔记状态和标签，保留目标库密码',async()=>{
 const {session}=await fixture();await session.save([account]);const a=sample(),b=sample(),c=sample();
 await session.saveNote(a,['生活']);await session.saveNote(b,['工作']);await session.saveNote(c,['删除']);
 await session.updateNote(a.id,'pin');await session.updateNote(b.id,'archive');await session.updateNote(c.id,'trash');
 const exported=parseEncryptedFile(await session.exportFile());const target=new VaultSession(new MemoryStore());await target.create('local-only-password');
 const staged=await target.stageImport(exported,password);assert.equal(staged.schemaVersion,2);await target.importPrepared(staged);
 assert.deepEqual(target.noteData,session.noteData);assert.deepEqual(target.accounts,[account]);target.lock();await target.unlock('local-only-password');assert.deepEqual(target.noteData,session.noteData);
});

test('旧版真实示例迁移补空笔记，升级后保存账号仍保留新笔记',async()=>{
 const envelope=parseEncryptedFile(await readFile(new URL('../examples/demo.vault.json',import.meta.url),'utf8'));
 const store=new MemoryStore();store.value=envelope;const session=new VaultSession(store);await session.unlock('a12345678');
 const original=session.accounts;assert.equal(original.length,3);assert.deepEqual(session.noteData,{notes:[],tags:[]});
 await session.saveNote(sample(),['日常']);await session.save(original);session.lock();await session.unlock('a12345678');assert.deepEqual(session.accounts,original);assert.equal(session.noteData.notes.length,1);
 const decoded=await decryptVault(store.value,await deriveKey('a12345678',store.value));assert.equal(decoded.schemaVersion,2);
 const staged=await session.stageImport(envelope,'a12345678');assert.equal(staged.schemaVersion,1);assert.equal(staged.noteData.notes.length,0);
 await session.importPrepared(staged);assert.deepEqual(session.accounts,original);assert.equal(session.noteData.notes.length,0);
});

test('笔记保存失败、非法标签、超长正文均不替换原库，随后可以重试',async()=>{
 const {session,store}=await fixture();const n=sample();await session.saveNote(n,['生活']);const original=JSON.stringify(store.value);
 store.fail=true;await assert.rejects(session.saveNote({...n,title:'不能落盘'},['工作']),/模拟存储失败/);assert.equal(JSON.stringify(store.value),original);assert.equal(session.noteData.notes[0].title,n.title);store.fail=false;
 const oversized=sample();oversized.blocks[0].text='a'.repeat(20001);await assert.rejects(session.saveNote(oversized,[]));
 await assert.rejects(session.saveNote(sample(),['x'.repeat(21)]));await assert.rejects(session.saveNote(sample(),Array.from({length:11},(_,i)=>String(i))));assert.equal(JSON.stringify(store.value),original);
 await session.saveNote({...n,title:'重试成功'},['生活']);assert.equal(session.noteData.notes[0].title,'重试成功');
});

test('笔记并发冲突锁定旧页面，锁定时排队写入不再执行',async()=>{
 const {session,store}=await fixture();const stale=new VaultSession(store);await stale.unlock(password);await session.saveNote(sample(),[]);
 await assert.rejects(stale.saveNote(sample(),[]),ConflictError);assert.throws(()=>stale.noteData,LockedError);
 const pending=session.saveNote(sample(),[]);session.lock();await assert.rejects(pending,LockedError);await session.unlock(password);assert.equal(session.noteData.notes.length,1);
});

test('已提交的笔记写入在锁定后完成不能恢复明文会话',async()=>{
 const {session,store}=await fixture();let reached,release;const started=new Promise(resolve=>reached=resolve),write=store.write.bind(store);
 store.write=async(...args)=>{reached();await new Promise(resolve=>release=resolve);await write(...args);};
 const pending=session.saveNote(sample(),['生活']);await started;session.lock();release();await assert.rejects(pending,LockedError);assert.equal(session.unlocked,false);assert.throws(()=>session.noteData,LockedError);
 store.write=write;await session.unlock(password);assert.equal(session.noteData.notes.length,1);
});

test('标签重命名和删除同步关联，清单、日期、归档恢复保持原样',async()=>{
 const {session}=await fixture();const n=sample();n.recordDate='2026-10-01';await session.saveNote(n,['生活','工作']);
 const id=session.noteData.tags[0].id;await session.changeNoteTag(id,'日常');assert.equal(filterNotes(session.noteData,{query:'日常'}).length,1);
 await assert.rejects(session.changeNoteTag(id,'工作'));await assert.rejects(session.changeNoteTag(id,'生活,工作'));await session.updateNote(n.id,'archive');await session.updateNote(n.id,'trash');assert.equal(filterNotes(session.noteData,{scope:'trash'}).length,1);
 await session.changeNoteTag(id,null);await session.updateNote(n.id,'restore');const restored=session.noteData.notes[0];assert.ok(restored.archivedAt);assert.equal(restored.recordDate,'2026-10-01');assert.equal(restored.blocks[1].checked,true);assert.equal(restored.tagIds.length,1);
 await assert.rejects(session.updateNote(n.id,'purge'));await session.updateNote(n.id,'trash');await session.updateNote(n.id,'purge');assert.equal(session.noteData.notes.length,0);
});

test('回收站过期只清理删除项，清理失败不丢数据',async()=>{
 const {session,store}=await fixture();const old=sample(),keep=sample();old.deletedAt=new Date(Date.now()-RETENTION_MS-1000).toISOString();await session.saveNote(old,[]);await session.saveNote(keep,[]);const before=JSON.stringify(store.value);
 session.lock();store.fail=true;await session.unlock(password);assert.equal(session.unlocked,true);assert.ok(session.maintenanceWarning);assert.equal(JSON.stringify(store.value),before);assert.equal(session.noteData.notes.length,2);assert.equal(JSON.stringify(parseEncryptedFile(await session.exportFile())),before);
 session.lock();store.fail=false;await session.unlock(password);assert.deepEqual(session.noteData.notes.map(n=>n.id),[keep.id]);
 await session.updateNote(keep.id,'trash');await session.emptyNoteTrash();assert.equal(session.noteData.notes.length,0);
});

test('搜索范围、大小写、标签、置顶、日期排序与数据校验',()=>{
 const a=sample(),b=sample(),c=sample();a.title='HELLO';a.recordDate='2026-01-01';b.archivedAt=b.updatedAt;c.deletedAt=c.updatedAt;
 const data=validateNoteData({notes:[a,b,c],tags:[]});assert.equal(filterNotes(data,{query:'hello'}).length,1);assert.equal(filterNotes(data).length,1);assert.equal(filterNotes(data,{includeArchived:true}).length,2);assert.equal(filterNotes(data,{scope:'trash'}).length,1);
 b.isPinned=true;assert.equal(filterNotes({notes:[a,b],tags:[]},{includeArchived:true})[0].id,b.id);
 for(const n of [{...a,recordDate:'2026-02-30'},{...a,createdAt:'nope'},{...a,id:'<script>'},{...a,tagIds:['missing']}])assert.throws(()=>validateNoteData({notes:[n],tags:[]}));
 assert.equal(noteTitle({...a,title:''}),'正文 <script>private</script>');assert.equal(pruneNoteData(data).notes.length,3);
});
