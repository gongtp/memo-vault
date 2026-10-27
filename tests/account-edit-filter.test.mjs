import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {paginate} from '../notes-model.mjs';
const source=await readFile(new URL('../app.js',import.meta.url),'utf8');
const code=source.slice(source.indexOf('function filteredAccounts(){'),source.indexOf('function renderDetail(){'))+source.slice(source.indexOf("$('account-form').onsubmit=e=>{"),source.indexOf('const closeAccount='));
async function save({filter='category:A',query='match',fields={},fail=false,edit=true}={}){
 const records=Array.from({length:15},(_,i)=>({id:i+1,name:`match ${String(i).padStart(2,'0')}`,username:'user',note:'',category:'A',method:'密码',password:'test',url:'',favorite:true,date:'2026.10.01'}));
 const nodes=new Map();let pending,toastText='',detail=false;
 const context={accounts:records,editId:edit?12:null,selected:12,accountPage:2,filter,query,sort:'name',page:'accounts',busy:false,FormData:class{get(key){return ({...records[11],...fields})[key]??'';}has(key){return key==='favorite'&&(fields.favorite??true);}},$:id=>{if(!nodes.has(id))nodes.set(id,{reset(){},close(){}});return nodes.get(id);},document:{querySelector:()=>({classList:{contains:()=>true,add:()=>detail=true}})},session:{unlocked:true,accounts:records,async save(next){if(fail)throw Error('save failed');this.accounts=next;}},changed(){},toast:text=>toastText=text,perform:fn=>{pending=fn().catch(()=>{});},render(){const list=context.filteredAccounts(),view=paginate(list,context.accountPage);context.accountPage=view.page;if(!view.items.some(a=>a.id===context.selected))context.selected=view.items[0]?.id??null;}};
 runInNewContext(code,context);nodes.get('account-form').onsubmit({preventDefault(){},target:{}});await pending;return {context,toastText,detail};
}
test('分类筛选后编辑保存保留搜索、排序、定位页和手机详情',async()=>{
 const {context:c,detail}=await save({fields:{note:'已修改'}});assert.equal(c.filter,'category:A');assert.equal(c.query,'match');assert.equal(c.sort,'name');assert.equal(c.accountPage,2);assert.equal(c.selected,12);assert.equal(detail,true);assert.equal(c.accounts.find(a=>a.id===12).note,'已修改');
});
test('修改分类、取消常用或不再匹配搜索时保留筛选并提示',async()=>{
 for(const options of [{fields:{category:'B'}},{filter:'常用',fields:{favorite:false}},{fields:{name:'new name'}}]){const {context:c,toastText,detail}=await save(options);assert.equal(c.filter,options.filter??'category:A');assert.equal(c.query,'match');assert.match(toastText,/不符合当前筛选/);assert.equal(detail,false);assert.equal(c.accounts.length,15);}
});
test('保存失败保留筛选和原数据；新增仍可定位新账号',async()=>{
 const {context:c}=await save({fail:true,fields:{category:'B'}});assert.equal(c.filter,'category:A');assert.equal(c.accountPage,2);assert.equal(c.editId,12);assert.equal(c.accounts.find(a=>a.id===12).category,'A');
 const {context:n}=await save({edit:false});assert.equal(n.filter,'全部');assert.equal(n.query,'');assert.equal(n.accounts.length,16);
});
