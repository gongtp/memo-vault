import {test} from 'node:test';
import assert from 'node:assert/strict';
import {VaultSession,ConflictError,LockedError,deriveKey,decryptAccounts,decryptVault,encryptAccounts,parseEncryptedFile,validateAccounts,ITERATIONS,DEFAULT_PASSWORD} from '../vault.mjs';
const password='test-only-master-phrase';
const account={id:1,name:'TEST_PRIVATE_PLATFORM',username:'test-private@example.com',password:'test-private-secret',category:'开发工具',method:'密码登录',url:'https://example.com',note:'<private note>',favorite:true,date:'2026.10.22',color:'#efefff',ink:'#7a77ca',letter:'T'};
class MemoryStore{
  value=null;fail=false;
  async read(){return structuredClone(this.value);}
  async write(value,expected){if((this.value?.changeId??null)!==expected)throw new ConflictError();if(this.fail)throw new Error('test storage failure');this.value=structuredClone(value);}
}
async function fixture(){const store=new MemoryStore();const session=new VaultSession(store);await session.create(password);return {session,store};}
test('空库起步、保存为密文、重开后必须解锁，错误密码不更改数据',async()=>{
 const {session,store}=await fixture();assert.deepEqual(session.accounts,[]);
 await session.save([account]);const stored=JSON.stringify(store.value);
 for(const secret of [password,account.name,account.username,account.password,account.note])assert.equal(stored.includes(secret),false);
 const reopened=new VaultSession(store);assert.throws(()=>reopened.accounts,LockedError);
 await assert.rejects(reopened.unlock('wrong-password'));assert.equal(JSON.stringify(store.value),stored);assert.equal(reopened.unlocked,false);
 await reopened.unlock(password);assert.deepEqual(reopened.accounts,[account]);
});
test('主密码验证必须正确，派生密钥不可导出，锁定后不能读取/导出',async()=>{
 const {session,store}=await fixture();await session.save([account]);
 await assert.rejects(session.verify('wrong-password'));await session.verify(password);
 const key=await deriveKey(password,store.value);assert.equal(key.extractable,false);await assert.rejects(crypto.subtle.exportKey('raw',key));
 session.lock();assert.equal(session.unlocked,false);assert.throws(()=>session.accounts,LockedError);await assert.rejects(session.exportFile(),LockedError);
});
test('同一数据每次保存随机 IV，独立信息库随机盐',async()=>{
 const first=await fixture();await first.session.save([account]);const a=first.store.value;
 await first.session.save([account]);const b=first.store.value;assert.notEqual(a.iv,b.iv);assert.notEqual(a.ciphertext,b.ciphertext);
 const second=await fixture();assert.notEqual(a.salt,second.store.value.salt);
});
test('密文与认证头被篡改时解密失败，拒绝未知版本/明文/过量 KDF',async()=>{
 const {session,store}=await fixture();await session.save([account]);const original=store.value;
 const key=await deriveKey(password,original);
 for(const altered of [{...original,iv:btoa('123456789012')},{...original,changeId:original.changeId.replace(/.$/,original.changeId.endsWith('a')?'b':'a')},{...original,ciphertext:(original.ciphertext[0]==='A'?'B':'A')+original.ciphertext.slice(1)}])await assert.rejects(decryptAccounts(altered,key));
 for(const altered of [{...original,version:2},{...original,iterations:ITERATIONS-1},{...original,iterations:2e9},{type:'memo-vault-demo-NOT-ENCRYPTED',accounts:[]}])assert.throws(()=>parseEncryptedFile(JSON.stringify(altered)));
});
test('跨设备导入保留所有字段，新设备采用文件主密码',async()=>{
 const first=await fixture();await first.session.save([account]);const file=await first.session.exportFile();
 const store=new MemoryStore();const target=new VaultSession(store);
 const staged=await target.stageImport(parseEncryptedFile(file),password);assert.equal(store.value,null);
 await target.importPrepared(staged);assert.deepEqual(target.accounts,[account]);assert.notEqual(store.value.iv,first.store.value.iv);
 target.lock();await target.unlock(password);assert.deepEqual(target.accounts,[account]);
});
test('已有库导入不更改本设备主密码；导入失败不覆盖原数据',async()=>{
 const source=await fixture();await source.session.save([account]);
 const store=new MemoryStore();const target=new VaultSession(store);const localPassword='different-local-master';await target.create(localPassword);
 const before=JSON.stringify(store.value);await assert.rejects(target.stageImport(source.store.value,'wrong'));assert.equal(JSON.stringify(store.value),before);
 const staged=await target.stageImport(source.store.value,password);await target.importPrepared(staged);
 target.lock();await assert.rejects(target.unlock(password));await target.unlock(localPassword);assert.deepEqual(target.accounts,[account]);
});
test('存储失败不报告保存成功、不替换内存/已保存数据',async()=>{
 const {session,store}=await fixture();const before=JSON.stringify(store.value);store.fail=true;
 await assert.rejects(session.save([account]));assert.equal(JSON.stringify(store.value),before);assert.deepEqual(session.accounts,[]);
});
test('多页面冲突锁定旧页面，避免静默覆盖',async()=>{
 const {session,store}=await fixture();const stale=new VaultSession(store);await stale.unlock(password);
 await session.save([account]);await assert.rejects(stale.save([]),ConflictError);assert.equal(stale.unlocked,false);
 const reopened=new VaultSession(store);await reopened.unlock(password);assert.deepEqual(reopened.accounts,[account]);
});
test('解锁、验证、导入异步操作遇到锁定时不能重新解锁',async()=>{
 const {session,store}=await fixture();await session.save([account]);
 const verifying=session.verify(password);session.lock();await assert.rejects(verifying,LockedError);
 const unlocking=session.unlock(password);session.lock();await assert.rejects(unlocking,LockedError);assert.equal(session.unlocked,false);
 const target=new VaultSession(new MemoryStore());const staging=target.stageImport(store.value,password);target.lock();await assert.rejects(staging,LockedError);
 const staged=await target.stageImport(store.value,password);target.lock();await assert.rejects(target.importPrepared(staged),LockedError);assert.equal(target.unlocked,false);
});
test('提交后的写入完成也不能将后台页面重新解锁',async()=>{
 const {session,store}=await fixture();let release,reached;
 const started=new Promise(resolve=>{reached=resolve;});const write=store.write.bind(store);
 store.write=async(...args)=>{reached();await new Promise(resolve=>{release=resolve;});await write(...args);};
 const saving=session.save([account]);await started;session.lock();release();await assert.rejects(saving,LockedError);
 assert.equal(session.unlocked,false);const reopened=new VaultSession(store);await reopened.unlock(password);assert.deepEqual(reopened.accounts,[account]);
});
test('输入校验阻止危险网址、重复编号及样式注入',()=>{
 assert.throws(()=>validateAccounts([account,account]));assert.throws(()=>validateAccounts([{...account,url:'javascript:alert(1)'}]));
 const clean=validateAccounts([{...account,color:'red;position:fixed',unknown:'ignored'}])[0];assert.equal(clean.color,'#efefff');assert.equal(clean.unknown,undefined);
});
test('创建过程中切后台，已落盘信息库仍可重新读取但不能自动解锁',async()=>{
 const store=new MemoryStore();const session=new VaultSession(store);let release,reached;
 const started=new Promise(resolve=>{reached=resolve;});const write=store.write.bind(store);
 store.write=async(...args)=>{reached();await new Promise(resolve=>{release=resolve;});await write(...args);};
 const creating=session.create(password);await started;session.lock();release();await assert.rejects(creating,LockedError);
 assert.equal(session.unlocked,false);assert.equal(await session.exists(),true);await session.unlock(password);assert.deepEqual(session.accounts,[]);
});
test('公开初始密码可创建空库，默认不重复验证，修改后无初始密码后门',async()=>{
 const store=new MemoryStore();const session=new VaultSession(store);await session.create(DEFAULT_PASSWORD);
 assert.deepEqual(session.settings,{verifyBeforeActions:false,usesInitialPassword:true});await session.save([account]);
 const oldFile=await session.exportFile();const oldSalt=store.value.salt;
 await session.changePassword('new-personal-password');assert.notEqual(store.value.salt,oldSalt);assert.equal(session.settings.usesInitialPassword,false);
 session.lock();await assert.rejects(session.unlock(DEFAULT_PASSWORD));await session.unlock('new-personal-password');assert.deepEqual(session.accounts,[account]);
 const oldKey=await deriveKey(DEFAULT_PASSWORD,parseEncryptedFile(oldFile));assert.deepEqual(await decryptAccounts(parseEncryptedFile(oldFile),oldKey),[account]);
});
test('操作验证开关加密持久化，两种状态导出都保持加密且可跨设备迁移',async()=>{
 const {session,store}=await fixture();await session.save([account]);
 for(const value of [true,false]){
  await session.updateSettings(value);const text=await session.exportFile();assert.equal(text.includes(account.password),false);assert.equal(text.includes('verifyBeforeActions'),false);
  const key=await deriveKey(password,store.value);assert.equal((await decryptVault(store.value,key)).settings.verifyBeforeActions,value);
  const target=new VaultSession(new MemoryStore());const staged=await target.stageImport(parseEncryptedFile(text),password);await target.importPrepared(staged);assert.equal(target.settings.verifyBeforeActions,value);
  session.lock();await session.unlock(password);assert.equal(session.settings.verifyBeforeActions,value);
 }
});
test('修改密码保存失败时旧密码和旧数据仍有效',async()=>{
 const {session,store}=await fixture();await session.save([account]);const original=JSON.stringify(store.value);store.fail=true;
 await assert.rejects(session.changePassword('new-personal-password'));assert.equal(JSON.stringify(store.value),original);
 session.lock();await session.unlock(password);assert.deepEqual(session.accounts,[account]);await assert.rejects(new VaultSession(store).unlock('new-personal-password'));
});
test('修改密码过程遇到锁定不会重新解锁，配置开关遇到写入冲突也会拒绝覆盖',async()=>{
 const {session,store}=await fixture();const change=session.changePassword('new-personal-password');session.lock();await assert.rejects(change,LockedError);assert.equal(session.unlocked,false);
 await session.unlock(password);const stale=new VaultSession(store);await stale.unlock(password);await session.updateSettings(true);
 await assert.rejects(stale.updateSettings(false),ConflictError);assert.equal(stale.unlocked,false);
});
test('已有库导入继承操作设置但保留本设备是否使用初始密码的状态',async()=>{
 const source=new VaultSession(new MemoryStore());await source.create(DEFAULT_PASSWORD);await source.updateSettings(true);
 const {session}=await fixture();const stage=await session.stageImport(parseEncryptedFile(await source.exportFile()),DEFAULT_PASSWORD);await session.importPrepared(stage);
 assert.deepEqual(session.settings,{verifyBeforeActions:true,usesInitialPassword:false});session.lock();await session.unlock(password);
});
test('兼容旧版无设置的密文，升级后保持原先再次验证开启行为',async()=>{
 const {store}=await fixture();const header=store.value;const key=await deriveKey(password,header);
 const encoder=new TextEncoder();const aad=encoder.encode(JSON.stringify([header.type,header.version,header.cipher,header.kdf,header.iterations,header.salt,header.iv,header.changeId]));
 const iv=Uint8Array.from(atob(header.iv),c=>c.charCodeAt(0));
 const bytes=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:aad,tagLength:128},key,encoder.encode(JSON.stringify({schemaVersion:1,accounts:[account]})));
 store.value={...header,ciphertext:Buffer.from(bytes).toString('base64')};
 const session=new VaultSession(store);await session.unlock(password);assert.deepEqual(session.settings,{verifyBeforeActions:true,usesInitialPassword:false});assert.deepEqual(session.accounts,[account]);
});
test('删除指定账号后加密持久化，保留其他账号和设置',async()=>{
 const {session,store}=await fixture();const second={...account,id:2,name:'保留的账号'};
 await session.save([account,second]);await session.updateSettings(true);await session.deleteAccount(account.id);
 assert.deepEqual(session.accounts,[second]);assert.equal(session.settings.verifyBeforeActions,true);
 session.lock();await session.unlock(password);assert.deepEqual(session.accounts,[second]);
 const key=await deriveKey(password,store.value);assert.deepEqual(await decryptAccounts(store.value,key),[second]);
 await session.deleteAccount(second.id);session.lock();await session.unlock(password);assert.deepEqual(session.accounts,[]);
});
test('删除失败或编号不存在时不丢失原账号',async()=>{
 const {session,store}=await fixture();await session.save([account]);const original=JSON.stringify(store.value);
 await assert.rejects(session.deleteAccount(999));assert.equal(JSON.stringify(store.value),original);
 store.fail=true;await assert.rejects(session.deleteAccount(account.id));assert.deepEqual(session.accounts,[account]);assert.equal(JSON.stringify(store.value),original);
 assert.equal(JSON.stringify(parseEncryptedFile(await session.exportFile())),JSON.stringify(store.value));
});
test('锁定状态不能删除，删除写入冲突时锁定且保留最新数据',async()=>{
 const {session,store}=await fixture();await session.save([account]);const stale=new VaultSession(store);await stale.unlock(password);
 await session.save([account,{...account,id:2}]);await assert.rejects(stale.deleteAccount(account.id),ConflictError);assert.equal(stale.unlocked,false);
 assert.throws(()=>stale.deleteAccount(account.id),LockedError);const reopened=new VaultSession(store);await reopened.unlock(password);assert.equal(reopened.accounts.length,2);
});
test('新增自定义分类和登录方式，支持账号保存、重新解锁及备份迁移',async()=>{
 const {session}=await fixture();await session.addOption('categories','我的项目');await session.addOption('methods','企业单点登录');
 const custom={...account,category:'我的项目',method:'企业单点登录'};await session.save([custom]);
 session.lock();await session.unlock(password);assert.equal(session.options.categories.includes('我的项目'),true);assert.deepEqual(session.accounts,[custom]);
 const target=new VaultSession(new MemoryStore());await target.importPrepared(await target.stageImport(parseEncryptedFile(await session.exportFile()),password));
 assert.deepEqual(target.options,session.options);assert.deepEqual(target.accounts,[custom]);
});
test('已有账号使用的分类和登录方式不可删除，修改账号后才允许删除',async()=>{
 const {session,store}=await fixture();await session.save([account]);const original=JSON.stringify(store.value);
 await assert.rejects(session.removeOption('categories','开发工具'),/不可删除/);await assert.rejects(session.removeOption('methods','密码登录'),/不可删除/);
 assert.deepEqual(session.accounts,[account]);assert.equal(JSON.stringify(store.value),original);
 await session.save([{...account,category:'日常生活',method:'Google 登录'}]);
 await session.removeOption('categories','开发工具');await session.removeOption('methods','密码登录');
 session.lock();await session.unlock(password);assert.equal(session.options.categories.includes('开发工具'),false);assert.equal(session.options.methods.includes('密码登录'),false);assert.equal(session.accounts.length,1);assert.equal(session.accounts[0].password,account.password);
});
test('默认项和自定义项均可全部删除，空选项不会在刷新或导入时恢复默认项',async()=>{
 const {session}=await fixture();await session.save([{...account,category:'',method:''}]);await session.addOption('categories','自定义');
 for(const name of session.options.categories)await session.removeOption('categories',name);
 for(const name of session.options.methods)await session.removeOption('methods',name);
 session.lock();await session.unlock(password);assert.deepEqual(session.options,{categories:[],methods:[]});assert.equal(session.accounts[0].category,'');assert.equal(session.accounts[0].method,'');
 await session.save([{...account,category:'',method:''}]);
 const target=new VaultSession(new MemoryStore());await target.importPrepared(await target.stageImport(parseEncryptedFile(await session.exportFile()),password));assert.deepEqual(target.options,{categories:[],methods:[]});
});
test('拒绝重复名称和不存在的引用，不改变原数据',async()=>{
 const {session,store}=await fixture();await session.save([account]);const original=JSON.stringify(store.value);
 await assert.rejects(session.addOption('categories','开发工具'));assert.throws(()=>session.addOption('methods',' '));
 await assert.rejects(session.removeOption('categories','不存在'));await assert.rejects(session.save([{...account,category:'未创建'}]));
 assert.equal(JSON.stringify(store.value),original);assert.deepEqual(session.accounts,[account]);
});
test('选项写入失败或并发冲突时不丢失选项及账号',async()=>{
 const {session,store}=await fixture();await session.save([account]);const options=session.options;store.fail=true;
 await assert.rejects(session.removeOption('categories','日常生活'),/storage failure/);assert.deepEqual(session.options,options);assert.deepEqual(session.accounts,[account]);
 store.fail=false;const stale=new VaultSession(store);await stale.unlock(password);await session.addOption('methods','自定义方式');
 await assert.rejects(stale.addOption('categories','并发选项'),ConflictError);assert.equal(stale.unlocked,false);
});
