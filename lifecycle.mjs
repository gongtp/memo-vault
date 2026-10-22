export function installAutoLock({document,window,lock,isUnlocked,now=Date.now,setTimer=setTimeout,clearTimer=clearTimeout,idleMs=300000}){
  let lastActivity=now(),timer;
  const activity=()=>{
    if(!isUnlocked())return;
    if(now()-lastActivity>=idleMs){lock('闲置超过 5 分钟，已自动锁定。');return;}
    lastActivity=now();clearTimer(timer);timer=setTimer(()=>{if(isUnlocked())lock('闲置超过 5 分钟，已自动锁定。');},idleMs);
  };
  const resume=()=>{lastActivity=now();activity();};
  const hidden=()=>{if(document.hidden)lock('离开前台，信息库已自动锁定。');};
  const hide=()=>lock();
  const show=e=>{if(e.persisted)lock();};
  document.addEventListener('visibilitychange',hidden);window.addEventListener('pagehide',hide);window.addEventListener('pageshow',show);
  const events=['pointerdown','keydown','input','scroll'];
  for(const event of events)document.addEventListener(event,activity,{passive:true,capture:true});
  return {resume,stop(){clearTimer(timer);document.removeEventListener('visibilitychange',hidden);window.removeEventListener('pagehide',hide);window.removeEventListener('pageshow',show);for(const event of events)document.removeEventListener(event,activity,{capture:true});}};
}
