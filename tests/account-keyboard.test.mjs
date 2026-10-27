import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
const source=await readFile(new URL('../app.js',import.meta.url),'utf8');
const code=source.slice(source.indexOf('function refreshDialogViewport(){'),source.indexOf('function requestVerification(type){'));
function fixture(){
 const events={},frames=new Map(),timers=new Map();let id=0,rect={top:350,bottom:394};
 const field={matches:()=>true,getBoundingClientRect:()=>rect};
 const body={scrollTop:0,contains:el=>el===field,getBoundingClientRect:()=>({top:100,bottom:300})};
 const dialog={open:true,querySelector:()=>body,addEventListener:(name,fn)=>events['dialog-'+name]=fn};
 const form={addEventListener:(name,fn)=>events['form-'+name]=fn};
 const context={$:name=>name==='account-dialog'?dialog:form,document:{activeElement:field,documentElement:{style:{setProperty(){}}}},window:{innerHeight:844,visualViewport:{height:400,offsetTop:0,addEventListener:(name,fn)=>events['viewport-'+name]=fn},addEventListener:(name,fn)=>events[name]=fn},requestAnimationFrame:fn=>{frames.set(++id,fn);return id;},cancelAnimationFrame:key=>frames.delete(key),setTimeout:fn=>{timers.set(++id,fn);return id;},clearTimeout:key=>timers.delete(key)};
 runInNewContext(code,context);
 return {events,body,dialog,context,frames,timers,setRect:value=>rect=value,flush:()=>{const pending=[...frames.values()];frames.clear();pending.forEach(fn=>fn());}};
}
test('键盘压缩弹框后，在布局更新的下一帧显示当前输入框',()=>{
 const f=fixture();f.events['viewport-resize']();assert.equal(f.body.scrollTop,0);f.flush();assert.equal(f.body.scrollTop,106);
 f.setRect({top:200,bottom:244});f.events['viewport-resize']();f.flush();assert.equal(f.body.scrollTop,106);
 f.setRect({top:80,bottom:124});f.events['form-focusin']();f.flush();assert.equal(f.body.scrollTop,74);
});
test('普通滚动不抢位置，失焦或关闭后不滚动，关闭清理待执行回调',()=>{
 const f=fixture();f.events['viewport-scroll']();assert.equal(f.frames.size,0);
 f.events['form-focusin']();f.context.document.activeElement=null;f.flush();assert.equal(f.body.scrollTop,0);
 f.events['form-focusin']();f.dialog.open=false;f.events['dialog-close']();assert.equal(f.frames.size,0);assert.equal(f.timers.size,0);
});
