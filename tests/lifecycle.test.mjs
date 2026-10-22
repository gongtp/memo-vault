import {test} from 'node:test';
import assert from 'node:assert/strict';
import {installAutoLock} from '../lifecycle.mjs';
function fixture(){
 const document=new EventTarget(),window=new EventTarget();document.hidden=false;let unlocked=true,time=0,locks=0,timer;
 const guard=installAutoLock({document,window,lock:()=>{unlocked=false;locks++;},isUnlocked:()=>unlocked,now:()=>time,setTimer:fn=>{timer=fn;return 1;},clearTimer:()=>{timer=null;}});guard.resume();
 return {document,window,guard,get locks(){return locks;},set time(n){time=n;},runTimer:()=>timer?.()};
}
test('切后台立即锁定，回前台不会自动解锁',()=>{const f=fixture();f.document.hidden=true;f.document.dispatchEvent(new Event('visibilitychange'));assert.equal(f.locks,1);f.document.hidden=false;f.document.dispatchEvent(new Event('visibilitychange'));assert.equal(f.locks,1);f.guard.stop();});
test('页面离开与 bfcache 恢复均触发锁定',()=>{const f=fixture();f.window.dispatchEvent(new Event('pagehide'));const event=new Event('pageshow');event.persisted=true;f.window.dispatchEvent(event);assert.equal(f.locks,2);f.guard.stop();});
test('前台 5 分钟定时锁定，计时器暂停时下一次操作仍检查期限',()=>{const f=fixture();f.runTimer();assert.equal(f.locks,1);f.guard.stop();const other=fixture();other.time=300001;other.document.dispatchEvent(new Event('pointerdown'));assert.equal(other.locks,1);other.guard.stop();});
