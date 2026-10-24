// Only application readiness is tracked here; this module never accesses vault data.
const panel=document.createElement('details');panel.className='offline-panel';
panel.innerHTML='<summary><span class="offline-dot" aria-hidden="true"></span><span id="offline-status" role="status">正在检查离线准备状态…</span><span class="offline-more">详情</span></summary><div class="offline-details"><p id="offline-description"></p><p id="offline-install-help"></p><p id="offline-update" hidden>新版本已下载。请先保存内容，再关闭所有本应用窗口（含 Safari 标签页），重新从主屏幕打开以启用更新。不会自动刷新当前编辑。</p><p id="offline-error" class="inline-error" role="alert"></p><button type="button" class="button secondary" id="offline-retry">检查 / 重试离线准备</button><p class="offline-footnote">离线缓存只保存程序，不是数据备份。请继续定期导出备份。系统清理网站数据后，需要重新联网准备。</p></div>';
const card=document.createElement('section');card.className='setting-card offline-card';
card.innerHTML='<h2>离线使用</h2><p>首次联网准备完成后，就能从主屏幕离线打开、解锁和记录。</p>';
card.append(panel);
export function mountOfflineSettings(container){container.append(card);}
const $=id=>panel.querySelector('#'+id);
const base=new URL('./',import.meta.url),workerURL=new URL('sw.js',base).href;
let registration=null,checking=false,lastCheck=0,hasReady=false;
const standalone=()=>matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;
function state(label,description,ready=false){
 hasReady=ready;panel.dataset.ready=String(ready);
 $('offline-status').textContent=`${navigator.onLine?'':'当前离线 · '}${label}`;
 $('offline-description').textContent=description;
 $('offline-install-help').textContent=standalone()?'当前为主屏幕应用。显示“离线已就绪”后，可断网重新打开、解锁和记录。':'iPhone：Safari 分享 → 添加到主屏幕 → 保持联网，从桌面图标打开一次，等该窗口显示“离线已就绪”。Safari 与主屏幕的数据及离线准备应分别确认。';
}
function askWorker(worker,type='OFFLINE_STATUS'){
 return new Promise((resolve,reject)=>{
  const channel=new MessageChannel(),timer=setTimeout(()=>{channel.port1.close();reject(Error('离线状态检查超时，请重试。'));},15000);
  channel.port1.onmessage=event=>{clearTimeout(timer);channel.port1.close();if(event.data?.type==='OFFLINE_STATUS')resolve(event.data);else reject(Error('离线状态响应无效。'));};
  worker.postMessage({type},[channel.port2]);
 });
}
async function inspect(repair=false){
 const worker=navigator.serviceWorker.controller;
 $('offline-update').hidden=!registration?.waiting;
 if(!worker||worker.scriptURL!==workerURL){state('正在准备离线使用…','首次需要联网下载完整程序。若下载完成后仍显示此状态，请关闭应用后重新打开。');return;}
 try{
  const result=await askWorker(worker,repair?'REPAIR_OFFLINE':'OFFLINE_STATUS');
  if(worker!==navigator.serviceWorker.controller)return;
  if(result.ready){state('离线已就绪','本窗口所需的程序文件已完整缓存，可离线打开；账号和笔记继续按原来的方式保存在本机。',true);$('offline-error').textContent=result.error||'';}
  else{state('离线尚未就绪','程序缓存不完整，请联网后点击重试。当前窗口中的本地数据不受影响。');$('offline-error').textContent=result.error||'';}
 }catch(error){state('无法确认离线准备状态','请联网后重试；本地账号和笔记不会被清除。');$('offline-error').textContent=error.message;}
}
function watch(worker){
 if(!worker)return;
 worker.addEventListener('statechange',()=>{
  if(worker.state==='installed')void inspect();
  if(worker.state==='activated')void inspect();
  if(worker.state==='redundant'){
   $('offline-error').textContent='离线程序下载未完成，请联网后重试。已有可用缓存将继续使用。';
   if(!hasReady)state('离线尚未就绪','下载可能中断，或发布尚未完成。请稍后重试。');
  }
 });
}
async function prepare(manual=false){
 if(checking)return;checking=true;lastCheck=Date.now();$('offline-retry').disabled=true;$('offline-error').textContent='';
 try{
  if(!isSecureContext||!('serviceWorker' in navigator)||!('caches' in window)){
   state('此环境暂不支持离线准备','请使用 HTTPS 的 GitHub Pages 地址，或电脑 localhost。请勿使用局域网 HTTP 地址验证离线功能。');return;
  }
  // Reuse a saved registration when offline; registration/update failures must not hide an existing cache.
  registration=await navigator.serviceWorker.getRegistration(base.href);
  if(registration?.scope!==base.href)registration=null;
  if(!registration){
   state('正在准备离线使用…','正在下载本窗口所需的程序文件。首次请保持联网。');
   registration=await navigator.serviceWorker.register(new URL('sw.js',base),{scope:base.href,updateViaCache:'none'});
  }
  registration.onupdatefound=()=>watch(registration.installing);watch(registration.installing);
  await inspect(manual&&navigator.onLine);
  if(navigator.onLine){try{await registration.update();}catch{$('offline-error').textContent=hasReady?'检查更新失败，已缓存版本仍可离线使用。':'联网检查失败，请稍后重试。';}}
  $('offline-update').hidden=!registration.waiting;
  void navigator.storage?.persist?.().catch(()=>{});
 }catch(error){
  if(navigator.serviceWorker?.controller)await inspect();
  else state('离线尚未就绪','请保持联网后重试。离线准备不会更改本地账号或笔记。');
  $('offline-error').textContent='离线准备失败，请检查网络、浏览器权限和可用存储空间。';
 }finally{checking=false;$('offline-retry').disabled=false;}
}
$('offline-retry').onclick=()=>void prepare(true);
if('serviceWorker' in navigator)navigator.serviceWorker.addEventListener('controllerchange',()=>void inspect());
window.addEventListener('online',()=>void prepare(true));
window.addEventListener('offline',()=>void inspect());
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&Date.now()-lastCheck>30000)void prepare();});
void prepare();
