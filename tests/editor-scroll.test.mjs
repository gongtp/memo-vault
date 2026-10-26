import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
const source=await readFile(new URL('../notes.js',import.meta.url),'utf8');

test('正文测量不缩短真实输入框，保留输入值并移除测量节点',()=>{
 const code=source.slice(source.indexOf(' function resize(el,'),source.indexOf(' async function open('));
 const writes=[];let attached=false,removed=false;
 const measure={style:{},removeAttribute(){},setAttribute(){},get scrollHeight(){assert.equal(attached,true);assert.equal(measure.value,'长正文');return 1800;},remove(){removed=true;}};
 const el={value:'长正文',style:new Proxy({height:'1802px'},{set(target,key,value){writes.push(value);target[key]=value;return true;}}),cloneNode:()=>measure,getBoundingClientRect:()=>({width:350}),parentElement:{append(){attached=true;}}};
 runInNewContext(code+'resize(el);',{el});assert.deepEqual(writes,[]);assert.equal(removed,true);
 el.style.height='360px';writes.length=0;runInNewContext(code+'resize(el);',{el});assert.deepEqual(writes,['1802px']);
});
test('手机滚动、键盘与地址栏高度变化不重算正文；宽度变化才重新排版',()=>{
 const code=source.slice(source.indexOf(' let editorWidth='),source.indexOf(" window.addEventListener('beforeunload'"));
 const events={},root={clientWidth:390,querySelectorAll:()=>['mixed']};let measured=0,synced=0;
 const context={active:true,editing:true,root,$:()=> 'body',resize:()=>measured++,syncViewport:()=>synced++,window:{addEventListener:(name,fn)=>events[name]=fn,visualViewport:{addEventListener:(name,fn)=>events['viewport-'+name]=fn}}};
 runInNewContext(code,context);
 for(let i=0;i<20;i++){events['viewport-scroll']();events['viewport-resize']();events.resize();}
 assert.equal(measured,0);assert.equal(synced,60);
 root.clientWidth=740;events.resize();assert.equal(measured,2);events['viewport-resize']();assert.equal(measured,2);
 context.editing=false;events['viewport-scroll']();events.resize();assert.equal(measured,2);
});
