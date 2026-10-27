import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
const source=await readFile(new URL('../app.js',import.meta.url),'utf8');
const code=source.slice(source.indexOf('function returnToAccountList(){'),source.indexOf('function openForm('));
test('详情返回保留所选账号原位置，避开底部导航，且不重置分页筛选',()=>{
 for(const [savedTop,expected] of [[240,760],[750,292]]){
  let visible=false,focused=false,target;
  const row={dataset:{account:'12'},focus:options=>{assert.equal(options.preventScroll,true);focused=true;},getBoundingClientRect:()=>{assert.equal(visible,true);return {top:1000,height:80};}};
  const layout={classList:{remove:()=>visible=true},querySelector:()=>row};
  const ctx={accountReturnPosition:{id:12,top:savedTop},hidePassword(){},document:{querySelector:selector=>selector==='.accounts-layout'?layout:{getBoundingClientRect:()=>({top:800,height:60})}},window:{scrollY:0,innerHeight:860,scrollTo:options=>target=options.top}};
  runInNewContext(code+'returnToAccountList();',ctx);assert.equal(target,expected);assert.equal(focused,true);assert.equal(ctx.accountReturnPosition,null);
 }
});
test('所选账号发生变化时返回定位到当前选中项',()=>{
 let centered=false;
 const row={dataset:{account:'3'},focus(){},scrollIntoView:options=>centered=options.block==='center'};
 const ctx={accountReturnPosition:{id:12,top:240},hidePassword(){},document:{querySelector:()=>({classList:{remove(){}},querySelector:()=>row})}};
 runInNewContext(code+'returnToAccountList();',ctx);assert.equal(centered,true);
});
