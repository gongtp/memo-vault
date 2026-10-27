import {test} from 'node:test';
import assert from 'node:assert/strict';
import {paginate,paginationControls} from '../notes-model.mjs';

test('账号与笔记分页遍历无重复遗漏，不修改源数据',()=>{
 for(const kind of ['accounts','notes']){
  const records=Array.from({length:23},(_,i)=>({id:`${kind}-${i}`,name:`记录${i}`,text:'内容'})),original=structuredClone(records);
  const pages=[1,2,3].map(page=>paginate(records,page));assert.deepEqual(pages.map(p=>p.items.length),[10,10,3]);
  assert.deepEqual(pages.flatMap(p=>p.items),records);assert.deepEqual(records,original);
  assert.deepEqual([pages[2].page,pages[2].pages,pages[2].start,pages[2].end,pages[2].total],[3,3,21,23,23]);
 }
});
test('先过滤全部数据再分页，搜索可找到后续页记录',()=>{
 const records=Array.from({length:31},(_,i)=>({id:i,category:i%2?'A':'B'}));
 assert.equal(paginate(records.filter(r=>r.id===30),1).items[0].id,30);
 const filtered=records.filter(r=>r.category==='A');assert.equal(paginate(filtered,2).items.length,5);
 assert.equal(paginate([...records].reverse(),1).items[0].id,30);
});
test('空列表、整页边界、删除末页与异常页码均回到有效页',()=>{
 const records=Array.from({length:20},(_,i)=>i);
 assert.equal(paginate(records,3).page,2);assert.equal(paginate(records.slice(0,10),2).page,1);
 for(const value of [0,-1,NaN,Infinity])assert.equal(paginate(records,value).page,1);
 assert.deepEqual(paginate([],9),{items:[],page:1,pages:1,total:0,start:0,end:0});
 assert.equal(paginate(records,1).end,10);assert.equal(paginate(records,2).start,11);
});
test('首尾页按钮禁用，页码和范围对应当前筛选结果',()=>{
 const records=Array.from({length:11},(_,i)=>i);
 const first=paginationControls(paginate(records,1),'accounts');assert.match(first,/data-list-page="0" disabled/);assert.match(first,/1 \/ 2 页/);
 const last=paginationControls(paginate(records,2),'notes');assert.match(last,/data-list-page="3" disabled/);assert.match(last,/11–11 条/);
 const empty=paginationControls(paginate([],1),'notes');assert.equal((empty.match(/disabled/g)||[]).length,2);
});


test('账号实际列表渲染只展示当前页，选中项随页切换，删除末页自动回退',async()=>{
 const {readFile}=await import('node:fs/promises'),{runInNewContext}=await import('node:vm');
 const source=await readFile(new URL('../app.js',import.meta.url),'utf8');
 const render=source.slice(source.indexOf('function renderRows(){'),source.indexOf('function renderDetail(){'));
 const nodes=new Map();const context={onlyFavorites:false,accounts:Array.from({length:21},(_,i)=>({id:i,name:'账号'+i,username:'user'+i,note:'',date:'2026-10-26',category:'',favorite:false})),filter:'全部',query:'',sort:'recent',selected:20,accountPage:3,paginate,paginationControls,escapeHTML:String,platform:()=>'',icon:()=>'',renderDetail:()=>{},document:{getElementById:id=>{if(!nodes.has(id))nodes.set(id,{});return nodes.get(id);}}};
 runInNewContext(render+'renderRows();',context);assert.equal((nodes.get('account-rows').innerHTML.match(/data-account=/g)||[]).length,1);assert.equal(context.selected,0);
 context.accounts=context.accounts.filter(a=>a.id!==0);runInNewContext('renderRows();',context);assert.equal(context.accountPage,2);assert.equal((nodes.get('account-rows').innerHTML.match(/data-account=/g)||[]).length,10);
 context.query='user20';context.accountPage=1;runInNewContext('renderRows();',context);assert.equal(context.selected,20);assert.match(nodes.get('account-pagination').innerHTML,/共 1 条/);
});

test('笔记实际列表渲染限制每页条数，全文搜索不局限于当前页',async()=>{
 const {readFile}=await import('node:fs/promises'),{runInNewContext}=await import('node:vm');
 const model=await import('../notes-model.mjs');const source=await readFile(new URL('../notes.js',import.meta.url),'utf8');
 const render=source.slice(source.indexOf(' function renderList(){'),source.indexOf(' function renderDetail(){'));
 const notes=Array.from({length:21},(_,i)=>({...model.newNote(),id:String(i),title:'笔记'+i,updatedAt:'2026-10-26T00:00:00.000Z'}));notes[20].blocks[0].text='独有搜索正文';
 const nodes=new Map();const context={active:true,selected:null,listPage:2,query:'',tag:'',sort:'recent',data:()=>({notes,tags:[]}),names:()=>[],...model,esc:String,button:()=>'',dateLabel:()=>'', $:id=>{if(!nodes.has(id))nodes.set(id,{});return nodes.get(id);}};
 runInNewContext(render+'renderList();',context);assert.equal((nodes.get('#note-rows').innerHTML.match(/data-note-id=/g)||[]).length,10);
 context.query='独有搜索正文';context.listPage=1;runInNewContext('renderList();',context);assert.equal((nodes.get('#note-rows').innerHTML.match(/data-note-id=/g)||[]).length,1);assert.match(nodes.get('#note-rows').innerHTML,/data-note-id="20"/);assert.match(nodes.get('#note-pagination').innerHTML,/共 1 条/);
});
