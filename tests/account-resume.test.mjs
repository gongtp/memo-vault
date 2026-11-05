import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
const source=await readFile(new URL('../app.js',import.meta.url),'utf8');
const code=source.slice(source.indexOf('let accountResumeContext=null;'),source.indexOf('function changed(){'));
function fixture(edit=true){
 const records=[{id:12,name:'原账号',password:'saved-secret'}],nodes=new Map(),fields={};let open=true,detail=true,restored=0,frame;
 for(const name of ['name','username','phone','category','method','password','url','note'])fields[name]={name,value:name==='password'?'unsaved-secret':'draft-'+name,selectionStart:2,selectionEnd:4,selectionDirection:'forward',scrollTop:15,replaceChildren(){},focus(){},setSelectionRange(start,end){this.selectionStart=start;this.selectionEnd=end;}};
 fields.favorite={checked:true};const form={elements:fields,contains:el=>el===fields.note,reset(){for(const field of Object.values(fields))field.value='';fields.favorite.checked=false;}};
 const get=id=>{if(id==='account-form')return form;if(!nodes.has(id))nodes.set(id,{open:id==='account-dialog'&&edit,reset(){},replaceChildren(){},classList:{remove(){}},close(){this.open=false;}});return nodes.get(id);};
 const body={scrollTop:180},layout={classList:{contains:()=>detail,add:()=>detail=true}};
 const ctx={$:get,page:'accounts',accounts:structuredClone(records),selected:12,filter:'category:工作',query:'查询',sort:'name',onlyFavorites:true,accountPage:2,accountReturnPosition:{id:12,top:220},editId:edit?12:null,showPassword:true,operation:0,busy:false,revealTimer:null,notes:{active:false,reset(){}},expandedCategories:new Set(),categoryEditing:null,clearDelete(){},clearOptions(){},clearAuth(){ctx.authorized=false;},clearImport(){},cancelMaster(){},clearTimeout(){},syncButtons(){},syncCategoryButton(){},authorized:true,
  document:{hidden:false,activeElement:fields.note,querySelector:selector=>selector==='.account-form-body'?body:layout,querySelectorAll:()=>[get('account-dialog')]},window:{scrollX:0,scrollY:560,scrollTo:pos=>{ctx.window.scrollY=pos.top;}},session:{generation:1,policy:{accounts:true,notes:false},isOpen:()=>open,lock(){open=false;this.generation++;},options:{categories:['工作']}},
  render(){detail=false;if(open)ctx.accounts=structuredClone(records);},toast:message=>ctx.message=message,openForm(isEdit){restored++;get('account-dialog').open=true;ctx.editId=isEdit?ctx.selected:null;},requestAnimationFrame:fn=>{frame=fn;}};
 runInNewContext(code,ctx);
 return {ctx,fields,get,records,body,get restored(){return restored;},get detail(){return detail;},unlock(){open=true;},frame(){frame?.();}};
}
test('后台锁定清空可见表单及授权，重复锁定后解锁恢复草稿、筛选、分页和位置',()=>{
 const f=fixture();f.ctx.lock('后台',{preserveAccount:true});assert.equal(f.fields.password.value,'');assert.equal(f.get('account-dialog').open,false);assert.equal(f.ctx.authorized,false);assert.equal(f.ctx.showPassword,false);
 f.ctx.lock('再次隐藏',{preserveAccount:true});assert.equal(f.ctx.restoreAccountContext(),false);f.unlock();assert.equal(f.ctx.restoreAccountContext(),true);f.frame();
 assert.equal(f.fields.password.value,'unsaved-secret');assert.equal(f.fields.note.value,'draft-note');assert.equal(f.fields.favorite.checked,true);assert.equal(f.body.scrollTop,180);assert.equal(f.ctx.editId,12);assert.equal(f.ctx.selected,12);assert.equal(f.ctx.accountPage,2);assert.equal(f.ctx.filter,'category:工作');assert.equal(f.ctx.query,'查询');assert.equal(f.ctx.onlyFavorites,true);assert.equal(f.ctx.window.scrollY,560);assert.equal(f.detail,true);assert.equal(f.ctx.showPassword,false);assert.equal(f.records[0].password,'saved-secret');
});
test('详情恢复不打开编辑；手动锁定清除恢复状态',()=>{
 const f=fixture(false);f.ctx.lock('',{preserveAccount:true});f.unlock();f.ctx.restoreAccountContext();assert.equal(f.restored,0);assert.equal(f.detail,true);
 const g=fixture();g.ctx.lock('',{preserveAccount:true});g.ctx.lock();g.unlock();assert.equal(g.ctx.restoreAccountContext(),false);
});
test('账号发生变化时不应用旧草稿；恢复回调再次锁定后不能回填内容',()=>{
 const f=fixture();f.ctx.lock('',{preserveAccount:true});f.records[0].name='其他窗口修改';f.unlock();f.ctx.restoreAccountContext();assert.equal(f.restored,0);assert.match(f.ctx.message,/发生变化/);
 const g=fixture();g.ctx.lock('',{preserveAccount:true});g.unlock();g.ctx.restoreAccountContext();g.ctx.lock('',{preserveAccount:true});g.frame();assert.equal(g.fields.password.value,'');assert.equal(g.get('account-dialog').open,false);
});
