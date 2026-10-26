import {test} from 'node:test';
import assert from 'node:assert/strict';
import {newTable,decimal,format,cellValue,total,validateTable,tableWithTotal,moveTableColumn} from '../table-model.mjs';
import {newNote,validateNoteData,noteText,mixedSections,documentText,insertDocumentTable,deleteTextBoundary} from '../notes-model.mjs';
import {ModuleVault,parseBackupFile} from '../module-vault.mjs';
import {DEFAULT_PASSWORD} from '../vault.mjs';
const legacyPurchase=()=>({columns:[{id:'item',name:'物品',type:'text'},{id:'quantity',name:'数量',type:'number'},{id:'price',name:'单价',type:'money'},{id:'amount',name:'金额',type:'product',factors:['quantity','price'],sum:true}],rows:[{}]});
test('购买金额按分四舍五入，求和无浮点误差，空值和负数正确',()=>{
 const t=legacyPurchase(),c=t.columns[3];t.rows=[{quantity:'3',price:'0.10'},{quantity:'1',price:'0.20'},{quantity:'0.25',price:'0.10'},{quantity:'-0.25',price:'0.10'},{}];
 assert.equal(format(cellValue(t,t.rows[0],c)),'0.30');assert.equal(format(cellValue(t,t.rows[2],c)),'0.03');assert.equal(format(cellValue(t,t.rows[3],c)),'-0.03');assert.equal(format(total(t,c)),'0.50');assert.equal(decimal(''),null);
 for(const value of ['NaN','1e3','1.234','1000000000','-'])assert.throws(()=>decimal(value));
});
test('表格验证拒绝坏引用、重复列、非法日期与容量越界，搜索包含表格内容',()=>{
 const t=legacyPurchase();t.rows=[{item:'咖啡',quantity:'2',price:'15.50'}];const n={...newNote(),table:t};assert.match(noteText(n),/31.00/);assert.match(noteText(n),/咖啡/);assert.deepEqual(validateNoteData({notes:[n],tags:[]}).notes[0].table.rows[0],t.rows[0]);
 const bad=structuredClone(t);bad.columns[3].factors=['amount','price'];assert.throws(()=>validateTable(bad));assert.throws(()=>validateTable({...t,rows:Array(501).fill({})}));assert.throws(()=>validateTable({columns:[{id:'d',name:'日期',type:'date'}],rows:[{d:'2026-02-30'}]}));assert.throws(()=>validateTable({...t,columns:[...t.columns,t.columns[0]]}));
});
test('表格保存重开、加密保护、新版备份恢复和失败保留原数据',async()=>{
 const store={value:null,fail:false,async read(){return structuredClone(this.value);},async write(value){if(this.fail)throw Error('写入失败');this.value=structuredClone(value);}};
 const vault=new ModuleVault(store);await vault.load();const n={...newNote(),title:'采购',table:legacyPurchase()};n.table.rows=[{item:'测试物品',quantity:'2',price:'9.99'}];await vault.saveNote(n);await vault.unlock(DEFAULT_PASSWORD,'settings');
 const text=await vault.exportFile(),backup=parseBackupFile(text);assert.equal(backup.version,2);assert.equal(backup.modules.notes.notes[0].table.rows[0].item,'测试物品');
 await vault.setModuleLock('notes',true,DEFAULT_PASSWORD);assert.ok(!JSON.stringify(store.value).includes('测试物品'));const reopened=new ModuleVault(store);await reopened.load();await reopened.unlock(DEFAULT_PASSWORD,'notes');assert.equal(reopened.noteData.notes[0].table.rows[0].price,'9.99');
 await reopened.importPrepared(await reopened.stageImport(backup,DEFAULT_PASSWORD));assert.equal(reopened.noteData.notes[0].table.rows[0].item,'测试物品');
 const before=structuredClone(store.value);store.fail=true;await assert.rejects(reopened.saveNote({...n,title:'不能提交'}));assert.deepEqual(store.value,before);
});

test('通用表格默认无购买字段，计算列支持四则运算并保留旧乘法',()=>{
 assert.deepEqual(newTable().columns.map(c=>c.name),['名称','数值']);
 const t=legacyPurchase(),c=t.columns[3],row={quantity:'10',price:'3'};
 for(const [operator,expected] of [['+','13.00'],['-','7.00'],['*','30.00'],['/','3.33']]){c.operator=operator;assert.equal(format(cellValue(t,row,c)),expected);assert.equal(validateTable(t).columns[3].operator,operator);}
 assert.equal(format(cellValue(t,{quantity:'-1',price:'8'},c)),'-0.13');
 t.rows=[{quantity:'1',price:'0'}];assert.throws(()=>cellValue(t,t.rows[0],c),/除数/);assert.match(noteText({...newNote(),table:t}),/除数/);
 c.operator='eval';assert.throws(()=>validateTable(t));
});

test('文字和多表格按顺序保存、搜索、备份和加密恢复，旧内容转换不丢失',async()=>{
 const plain=newNote();plain.blocks[0].text='开头说明';const old={...newNote(),table:legacyPurchase()};old.table.rows=[{item:'旧记录',quantity:'2',price:'5'}];
 assert.equal(mixedSections(plain)[0].text,'开头说明');assert.deepEqual(mixedSections(old)[0].table,old.table);
 const first=newTable(),second=newTable();first.columns[1].sum=true;second.columns[1].sum=true;first.rows=[{name:'甲',value:'10'}];second.rows=[{name:'乙',value:'20'}];
 const n={...newNote(),title:'混合记录',sections:[{id:'intro',type:'text',text:'说明甲'},{id:'one',type:'table',table:first},{id:'middle',type:'text',text:'中间说明'},{id:'two',type:'table',table:second},{id:'end',type:'text',text:'结尾'}]};
 const checked=validateNoteData({notes:[n],tags:[]});assert.deepEqual(checked.notes[0].sections,n.sections);assert.ok(documentText(n).indexOf('说明甲')<documentText(n).indexOf('中间说明'));assert.match(noteText(n),/结尾/);
 const store={value:null,async read(){return structuredClone(this.value);},async write(value){this.value=structuredClone(value);}};
 const vault=new ModuleVault(store);await vault.load();await vault.saveNote(n);await vault.unlock(DEFAULT_PASSWORD,'settings');const backup=parseBackupFile(await vault.exportFile());assert.equal(backup.version,3);
 await vault.setModuleLock('notes',true,DEFAULT_PASSWORD);assert.ok(!JSON.stringify(store.value).includes('中间说明'));const reopened=new ModuleVault(store);await reopened.load();await reopened.unlock(DEFAULT_PASSWORD,'notes');assert.deepEqual(reopened.noteData.notes[0].sections,n.sections);
 await reopened.importPrepared(await reopened.stageImport(backup,DEFAULT_PASSWORD));assert.deepEqual(reopened.noteData.notes[0].sections,n.sections);
 const bad=structuredClone(n);bad.sections[1].table.columns[0].type='unknown';assert.throws(()=>validateNoteData({notes:[bad],tags:[]}));
 const duplicate=structuredClone(n);duplicate.sections[1].id='intro';assert.throws(()=>validateNoteData({notes:[duplicate],tags:[]}));
});


test('光标插表保留前后文字，不修改原文，支持首尾和无光标追加',()=>{
 const n=newNote();n.blocks[0].text='前文后文';const original=structuredClone(n);
 for(const offset of [0,2,4]){const r=insertDocumentTable(n,newTable(),{plain:true,offset});assert.equal(r.sections[0].text,'前文后文'.slice(0,offset));assert.equal(r.sections[2].text,'前文后文'.slice(offset));assert.equal(r.sections[1].id,r.tableId);}
 assert.deepEqual(n,original);assert.equal(insertDocumentTable(n,newTable()).sections.at(-1).type,'table');
 const r=insertDocumentTable(n,newTable(),{plain:true,offset:2});n.sections=r.sections;n.blocks[0].text='';
 const next=insertDocumentTable(n,newTable(),{sectionId:r.sections[2].id,offset:1});assert.equal(next.sections[2].text,'后');assert.equal(next.sections[4].text,'文');validateNoteData({notes:[{...n,sections:next.sections}],tags:[]});
});
test('旧表格与空白间隙插入兼容，达到上限时原数据不变',()=>{
 const n=newNote();n.table=newTable();const original=structuredClone(n);
 const r=insertDocumentTable(n,newTable(),{gap:0});assert.equal(r.sections[0].id,r.tableId);assert.deepEqual(r.sections[1].table,n.table);assert.deepEqual(n,original);
 n.sections=Array.from({length:20},()=>({id:crypto.randomUUID(),type:'table',table:newTable()}));delete n.table;
 const before=structuredClone(n);assert.throws(()=>insertDocumentTable(n,newTable()),/20/);assert.deepEqual(n,before);
});


test('文本列一键合计保留原单元格内容，非法转换不修改旧表',()=>{
 const t=newTable();t.columns[1].type='text';t.rows=[{name:'阅读',value:'30'},{name:'散步',value:'20'}];const original=structuredClone(t);
 const converted=tableWithTotal(t,'value',true);assert.equal(format(total(converted,converted.columns[1])),'50.00');assert.deepEqual(converted.rows,t.rows);assert.deepEqual(t,original);
 assert.equal(tableWithTotal(converted,'value',false).columns[1].sum,false);
 t.rows[0].value='待确认';const invalid=structuredClone(t);assert.throws(()=>tableWithTotal(t,'value',true));assert.deepEqual(t,invalid);
 assert.throws(()=>tableWithTotal(t,'missing',true));
});


test('退格合并文字与空段，保持光标位置，不跨表格删除内容',()=>{
 const parts=[{id:'a',type:'text',text:'前文'},{id:'b',type:'text',text:''},{id:'c',type:'text',text:'后文'}];const original=structuredClone(parts);
 const r=deleteTextBoundary(parts,'b');assert.equal(r.sections.length,2);assert.equal(r.focusId,'a');assert.equal(r.offset,2);assert.deepEqual(parts,original);
 const merged=deleteTextBoundary(r.sections,'c');assert.equal(merged.sections[0].text,'前文后文');assert.equal(merged.offset,2);
 assert.equal(deleteTextBoundary(parts,'a',1).sections[0].text,'前文');
 const table={id:'t',type:'table',table:newTable()};assert.equal(deleteTextBoundary([table,parts[2]],'c'),null);
 const empty=deleteTextBoundary([table,parts[1]],'b');assert.deepEqual(empty.sections,[table]);assert.equal(empty.focusId,'t');
 assert.equal(deleteTextBoundary([parts[1]],'b'),null);
});


test('指定列位置保留单元格、计算引用和合计，支持跨列移动及恢复',()=>{
 const t=legacyPurchase();t.rows=[{item:'书',quantity:'2',price:'12.50'}];const original=structuredClone(t);
 const moved=moveTableColumn(t,'amount',0);assert.deepEqual(moved.columns.map(c=>c.id),['amount','item','quantity','price']);assert.deepEqual(moved.rows,t.rows);
 assert.deepEqual(moved.columns[0].factors,['quantity','price']);assert.equal(format(total(moved,moved.columns[0])),'25.00');validateTable(moved);
 assert.deepEqual(moveTableColumn(moved,'amount',3),t);assert.deepEqual(t,original);
 assert.deepEqual(moveTableColumn(t,'item',0),t);assert.deepEqual(moveTableColumn(t,'amount',3),t);
 assert.deepEqual(moveTableColumn(t,'item',2).columns.map(c=>c.id),['quantity','price','item','amount']);
 assert.throws(()=>moveTableColumn(t,'missing',1));for(const index of [-1,4,1.5])assert.throws(()=>moveTableColumn(t,'item',index));
});
