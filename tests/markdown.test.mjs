import {test} from 'node:test';
import assert from 'node:assert/strict';
import {newNote,newMarkdown,validateNoteData,documentText,renderMarkdown} from '../notes-model.mjs';
test('Markdown 源码逐字保留，旧文档不增加类型字段，拒绝混入计算表格',()=>{
 const source='# 标题\r\n\r\n☑ 不转换为普通段落\n| A | B |\n| --- | --- |\n| 1 | 2 |';
 const md=newMarkdown(source,'测试'),plain=newNote();
 const checked=validateNoteData({notes:[plain,md],tags:[]});assert.deepEqual(checked.notes[0],plain);assert.equal(documentText(checked.notes[1]),source);assert.equal(checked.notes[1].format,'markdown');
 assert.throws(()=>validateNoteData({notes:[{...md,sections:[]}],tags:[]}));assert.throws(()=>newMarkdown('a'.repeat(20001)));
});
test('Markdown 渲染标题、强调、列表、引用、代码、链接和横向表格',()=>{
 const html=renderMarkdown('# 标题\n\n**加粗** 和 *斜体* [链接](https://example.com)\n\n- 一\n- 二\n\n> 引用\n\n```js\nconst x = "<b>";\n```\n\n| 名称 | 数量 |\n| --- | --- |\n| 项目 | 2 |\n\n---');
 for(const value of ['<h1>标题</h1>','<strong>加粗</strong>','<em>斜体</em>','<ul>','<blockquote>','&lt;b&gt;','markdown-table-scroll','<td>2</td>','<hr>'])assert.ok(html.includes(value),value);
});
test('Markdown 不执行 HTML、脚本链接或加载远程图片',()=>{
 const html=renderMarkdown('<script>alert(1)</script>\n<img src=x onerror=alert(1)>\n[x](javascript:alert) [x](data:text/html,test) ![图片](https://example.com/a.png)');
 assert.ok(!/<script|<img|href="(?:javascript|data):/.test(html));assert.ok(html.includes('&lt;script&gt;'));assert.ok(html.includes('rel="noopener noreferrer"'));
});
