import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
const source=await readFile(new URL('../app.js',import.meta.url),'utf8');
const code=source.slice(source.indexOf('function setCategoryView('),source.indexOf("$('form-category-button').onclick"));
test('分类面板在选择、管理、编辑之间原地切换，保留层级展开和管理滚动位置',()=>{
 const nodes=new Map(),get=id=>{if(!nodes.has(id))nodes.set(id,{value:'',scrollTop:0,setAttribute(){},focus(){}});return nodes.get(id);};
 const ctx={$:get,session:{unlocked:true,options:{categories:['工作','开发'],categoryParents:[{name:'开发',parent:'工作'}]}},accounts:[{category:'开发'}],categoryPickerMode:'filter',categoryEditing:'开发',categoryView:'select',categoryScroll:0,filter:'category:开发',expandedCategories:new Set(['工作']),escapeHTML:String,icon:()=>'<svg></svg>',document:{querySelector:get}};
 runInNewContext(code,ctx);ctx.renderCategoryPicker();assert.equal(get('category-picker-title').textContent,'选择分类');assert.equal(get('.category-search').hidden,true);assert.match(get('category-tree').innerHTML,/data-category-choice="开发"/);
 ctx.setCategoryView('manage');assert.equal(get('category-manage').textContent,'完成');assert.match(get('category-tree').innerHTML,/data-category-add="工作"/);assert.match(get('category-tree').innerHTML,/data-category-more="开发"/);
 get('category-tree').scrollTop=160;ctx.setCategoryView('edit');assert.equal(get('category-editor-form').hidden,false);assert.equal(get('category-browse').hidden,true);
 get('category-tree').scrollTop=0;ctx.setCategoryView('manage');assert.equal(get('category-tree').scrollTop,160);assert.equal(get('category-editor-form').hidden,true);
 ctx.setCategoryView('select');assert.equal(get('category-back').hidden,true);assert.match(get('category-tree').innerHTML,/category-choice chosen/);
});
