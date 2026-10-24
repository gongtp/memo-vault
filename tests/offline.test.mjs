import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {runInNewContext} from 'node:vm';
import {createHash,webcrypto} from 'node:crypto';
import {shellFiles,publicFiles,workerSource} from '../scripts/app-shell.mjs';
const root=resolve(import.meta.dirname,'..');
const template=await readFile(resolve(root,'sw.js'),'utf8');
const scope='https://example.github.io/memo-vault/';
const hash=text=>createHash('sha256').update(text).digest('hex');
function harness({version='v1',files={'index.html':'<html>app</html>','app.js':'app','styles.css':'css'},network={},storage=new Map(),putFailure=false}={}){
 const listeners={},requests=[];let claimed=0;
 const cacheName=`memo-vault-shell:${encodeURIComponent(scope)}:${version}`;
 const caches={
  async has(name){return storage.has(name);},async keys(){return [...storage.keys()];},async delete(name){return storage.delete(name);},
  async open(name){if(!storage.has(name))storage.set(name,new Map());const map=storage.get(name);return {async match(key){return map.get(key)?.clone();},async put(key,response){if(putFailure)throw Error('quota');map.set(key,response.clone());}};}
 };
 const fetch=async request=>{requests.push(request.url);if(network.offline)throw Error('offline');const name=new URL(request.url).pathname.slice(new URL(scope).pathname.length);return new Response(network[name]??files[name]??'missing',{status:name in files?200:404});};
 const self={registration:{scope},clients:{claim:async()=>{claimed++;}},addEventListener:(name,callback)=>listeners[name]=callback};
 runInNewContext(template.replace("'__BUILD_ID__'",JSON.stringify(version)).replace('/*__ASSETS__*/[]',JSON.stringify(Object.entries(files).map(([key,value])=>[key,hash(value)]))),{self,caches,fetch,crypto:webcrypto,URL,Request,Response});
 async function event(name,extra={}){let pending;listeners[name]({...extra,waitUntil:value=>pending=value});await pending;}
 function request(url,options={}){let response;listeners.fetch({request:{url,method:'GET',mode:'same-origin',...options},respondWith:value=>response=value});return response;}
 async function message(type='OFFLINE_STATUS',source=scope){let result;await event('message',{data:{type},source:{url:source},ports:[{postMessage:value=>result=value}]});return result;}
 return {event,request,message,storage,cacheName,requests,network,claimed:()=>claimed};
}
test('首次完整缓存后，GitHub Pages 子路径首页及模块断网仍可加载',async()=>{
 const h=harness();await h.event('install');await h.event('activate');h.network.offline=true;
 assert.equal((await h.message()).ready,true);assert.equal(await (await h.request(scope,{mode:'navigate'})).text(),'<html>app</html>');
 assert.equal(await (await h.request(scope+'index.html?from=home',{mode:'navigate'})).text(),'<html>app</html>');assert.equal(await (await h.request(scope+'app.js')).text(),'app');assert.equal(h.claimed(),1);
});
test('不拦截备份、个人文件、POST、其他仓库或跨域请求',async()=>{
 const h=harness();await h.event('install');
 for(const [url,options] of [[scope+'backup.json',{}],[scope+'app.js?secret=private',{}],[scope+'app.js',{method:'POST'}],['https://example.github.io/another/app.js',{}],['https://another.test/app.js',{}],[scope+'unknown',{mode:'navigate'}]])assert.equal(h.request(url,options),undefined);
 assert.equal(await h.message('OFFLINE_STATUS','https://other.test/'),undefined);
});
test('发布文件不匹配或缓存写入失败，不留下假就绪的新缓存，也不删除旧缓存',async()=>{
 for(const options of [{network:{'app.js':'mixed release'}},{putFailure:true}]){
  const storage=new Map([['old-cache',new Map()]]),h=harness({...options,storage});await assert.rejects(h.event('install'));assert.equal(storage.has(h.cacheName),false);assert.equal(storage.has('old-cache'),true);
 }
});
test('新版本下载失败仍可离线运行旧版本，成功更新只删除同应用旧程序缓存',async()=>{
 const old=harness();await old.event('install');await old.event('activate');
 const bad=harness({version:'v2',storage:old.storage,network:{offline:true}});await assert.rejects(bad.event('install'));old.network.offline=true;assert.equal(await (await old.request(scope+'app.js')).text(),'app');
 old.storage.set('another-app',new Map());const next=harness({version:'v3',storage:old.storage});await next.event('install');assert.ok(old.storage.has(old.cacheName));assert.equal(next.claimed(),0);
 await next.event('activate');assert.equal(old.storage.has(old.cacheName),false);assert.ok(old.storage.has('another-app'));assert.equal((await next.message()).ready,true);
});
test('缓存缺失时不报告就绪，联网可补全，断网缺失返回明确失败',async()=>{
 const h=harness();await h.event('install');h.storage.get(h.cacheName).delete(scope+'app.js');h.network.offline=true;
 assert.equal((await h.message()).ready,false);assert.equal((await h.request(scope+'app.js')).status,503);assert.equal((await h.message('REPAIR_OFFLINE')).ready,false);
 h.network.offline=false;assert.equal((await h.message('REPAIR_OFFLINE')).ready,true);
});
test('构建自动覆盖所有运行模块、图标、清单，并生成稳定的内容版本',async()=>{
 const source=await workerSource(root);assert.equal(source,await workerSource(root));assert.ok(!source.includes('__BUILD_ID__'));assert.ok(!source.includes('/*__ASSETS__*/'));
 for(const file of ['module-vault.mjs','offline.js','notes-model.mjs','manifest.webmanifest','apple-touch-icon.png'])assert.ok(shellFiles.includes(file));
 for(const file of publicFiles)assert.ok(!file.includes('backup')&&!file.startsWith('tests/')&&!file.startsWith('examples/'));
 for(const file of shellFiles.filter(f=>/\.(m?js|html)$/.test(f))){const text=await readFile(resolve(root,file),'utf8');for(const match of text.matchAll(/(?:from\s+|src=)["']\.\/([^"']+)\.(m?js)["']/g))assert.ok(shellFiles.includes(`${match[1]}.${match[2]}`),`missing ${match[1]}`);}
 const manifest=JSON.parse(await readFile(resolve(root,'manifest.webmanifest'),'utf8'));assert.equal(manifest.start_url,'./');assert.equal(manifest.scope,'./');assert.equal(manifest.display,'standalone');
 for(const [file,size] of [['icon-192.png',192],['icon-512.png',512],['apple-touch-icon.png',180]]){const bytes=await readFile(resolve(root,file));assert.equal(bytes.readUInt32BE(16),size);assert.equal(bytes.readUInt32BE(20),size);}
 assert.ok(!/self\.skipWaiting\s*\(/.test(template));assert.ok(!/indexedDB|localStorage/.test(template.replaceAll('// Never cache backups, IndexedDB, arbitrary requests or other repositories.','')));
});
