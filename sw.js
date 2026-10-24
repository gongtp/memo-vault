/* Build/preview inject the exact application file digests. No personal data is cached. */
const BUILD_ID='__BUILD_ID__';
const ASSETS=/*__ASSETS__*/[];
const BASE=self.registration.scope;
const PREFIX=`memo-vault-shell:${encodeURIComponent(BASE)}:`;
const CACHE=PREFIX+BUILD_ID;
const urls=new Map(ASSETS.map(([path,hash])=>[new URL(path,BASE).href,hash]));
const hex=bytes=>Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');

async function download(url,expected){
 const response=await fetch(new Request(url,{cache:'no-store',credentials:'same-origin',redirect:'error'}));
 if(!response.ok||response.type==='opaque')throw Error('程序文件下载失败。');
 const hash=hex(await crypto.subtle.digest('SHA-256',await response.clone().arrayBuffer()));
 if(hash!==expected)throw Error('发布文件尚未完整更新，请稍后重试。');
 return response;
}
async function complete(){
 if(!ASSETS.length||!await caches.has(CACHE))return false;
 const cache=await caches.open(CACHE);
 return (await Promise.all([...urls.keys()].map(async url=>Boolean(await cache.match(url))))).every(Boolean);
}
self.addEventListener('install',event=>event.waitUntil((async()=>{
 if(!ASSETS.length)throw Error('请使用 npm run build 生成发布文件。');
 try{
  // Validate the entire release before writing any of this version's cache.
  const responses=await Promise.all([...urls].map(async([url,hash])=>[url,await download(url,hash)]));
  const cache=await caches.open(CACHE);
  for(const [url,response] of responses)await cache.put(url,response);
  if(!await complete())throw Error('离线缓存不完整。');
 }catch(error){await caches.delete(CACHE);throw error;}
 // No skipWaiting: an update cannot replace code underneath an open editor.
})()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
 if(!await complete())throw Error('离线缓存不完整。');
 await Promise.all((await caches.keys()).filter(key=>key.startsWith(PREFIX)&&key!==CACHE).map(key=>caches.delete(key)));
 await self.clients.claim();
})()));
self.addEventListener('fetch',event=>{
 const request=event.request,url=new URL(request.url),base=new URL(BASE);
 if(request.method!=='GET'||url.origin!==base.origin)return;
 const navigation=request.mode==='navigate'&&(url.pathname===base.pathname||url.pathname===new URL('index.html',BASE).pathname);
 const key=navigation?new URL('index.html',BASE).href:request.url;
 if(!urls.has(key))return; // Never cache backups, IndexedDB, arbitrary requests or other repositories.
 event.respondWith((async()=>{
  const cache=await caches.open(CACHE),cached=await cache.match(key);
  if(cached)return cached;
  // Repair only with the exact file for this version; never mix deployment versions.
  try{const response=await download(key,urls.get(key));await cache.put(key,response.clone());return response;}
  catch{return new Response('离线程序文件暂不可用。请联网后重新打开并检查离线准备状态。',{status:503,headers:{'Content-Type':'text/plain; charset=utf-8'}});}
 })());
});
self.addEventListener('message',event=>{
 if(!['OFFLINE_STATUS','REPAIR_OFFLINE'].includes(event.data?.type)||!event.ports?.[0])return;
 const source=event.source?.url;
 if(!source||new URL(source).origin!==new URL(BASE).origin||!new URL(source).pathname.startsWith(new URL(BASE).pathname))return;
 event.waitUntil((async()=>{
  let error='';
  if(event.data.type==='REPAIR_OFFLINE'){
   try{const cache=await caches.open(CACHE);for(const [url,hash] of urls)if(!await cache.match(url))await cache.put(url,await download(url,hash));}
   catch{error='缓存补全失败，请确认联网且设备有可用存储空间。';}
  }
  event.ports[0].postMessage({type:'OFFLINE_STATUS',ready:await complete(),version:BUILD_ID,error});
 })().catch(()=>event.ports[0].postMessage({type:'OFFLINE_STATUS',ready:false,error:'无法读取离线缓存。'})));
});
