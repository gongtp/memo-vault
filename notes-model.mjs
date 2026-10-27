import {validateTable,tableText} from './table-model.mjs';
export const RETENTION_MS=30*24*60*60*1000;
export const localDate=(date=new Date())=>`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
const sectionsText=sections=>sections.map(s=>s.type==='table'?tableText(s.table):s.text).join('\n\n');
export const noteTitle=n=>n.title.trim()||n.sections?.find(s=>s.type==='text'&&s.text.trim())?.text.trim().split('\n')[0].slice(0,30)||n.blocks.find(b=>b.text.trim())?.text.trim().split('\n')[0].slice(0,30)||'未命名笔记';
export const noteText=n=>n.sections?sectionsText(n.sections):n.table?tableText(n.table):n.blocks.map(b=>`${b.type==='checklist'?(b.checked?'☑ ':'☐ '):b.type==='bullet'?'• ':''}${b.text}`).join('\n');
export const hasContent=n=>Boolean(n.sections?.some(s=>s.type==='table'||s.text.trim())||n.table||n.title.trim()||n.blocks.some(b=>b.text.trim()));
export function newNote(){const now=new Date().toISOString();return {id:crypto.randomUUID(),title:'',blocks:[{id:crypto.randomUUID(),type:'text',text:''}],tagIds:[],recordDate:localDate(),isPinned:false,archivedAt:null,deletedAt:null,createdAt:now,updatedAt:now};}
export function newMarkdown(text='',title=''){
 if(typeof text!=='string'||text.length>20000)throw Error('Markdown 正文最多 20,000 字。');
 const note=newNote();note.format='markdown';note.title=title.slice(0,100);note.blocks[0].text=text;return note;
}
// Render only generated markup. Raw HTML is always text; links accept explicit safe protocols.
export function renderMarkdown(source){
 const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 function inline(text,depth=0){
  if(depth>8)return escape(text);
  const token=/(`+)([^`\n]+?)\1|!?\[([^\]\n]+)\]\(([^\s)]+)\)|\*\*([^*\n]+)\*\*|__([^_\n]+)__|\*([^*\n]+)\*|_([^_\n]+)_|~~([^~\n]+)~~|\\([\\`*_[\]{}()#+.!|>-])/g;
  let out='',last=0;
  for(const m of text.matchAll(token)){
   out+=escape(text.slice(last,m.index));last=m.index+m[0].length;
   if(m[1])out+=`<code>${escape(m[2])}</code>`;
   else if(m[3]){let safe=false;try{safe=['http:','https:','mailto:'].includes(new URL(m[4]).protocol);}catch{}out+=safe?`<a href="${escape(m[4])}" target="_blank" rel="noopener noreferrer">${inline(m[3],depth+1)}</a>`:escape(m[0]);}
   else if(m[5]||m[6])out+=`<strong>${inline(m[5]??m[6],depth+1)}</strong>`;
   else if(m[7]||m[8])out+=`<em>${inline(m[7]??m[8],depth+1)}</em>`;
   else if(m[9])out+=`<del>${inline(m[9],depth+1)}</del>`;
   else out+=escape(m[10]);
  }
  return out+escape(text.slice(last));
 }
 const lines=source.replace(/\r\n?/g,'\n').split('\n'),out=[];
 const cells=line=>line.trim().replace(/^\||\|$/g,'').split(/(?<!\\)\|/).map(s=>s.trim());
 const divider=line=>line.includes('|')&&cells(line).every(s=>/^:?-{3,}:?$/.test(s));
 const special=line=>/^\s*$|^ {0,3}(?:#{1,6}\s|```|~~~|>|[-+*]\s|\d+[.)]\s|(?:-\s*){3,}$|(?:\*\s*){3,}$|(?:_\s*){3,}$)/.test(line);
 for(let i=0;i<lines.length;){
  const line=lines[i];if(!line.trim()){i++;continue;}
  const fence=/^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
  if(fence){const code=[];i++;while(i<lines.length&&!new RegExp('^ {0,3}'+fence[1][0]+'{'+fence[1].length+',}\\s*$').test(lines[i]))code.push(lines[i++]);if(i<lines.length)i++;out.push(`<pre><code>${escape(code.join('\n'))}</code></pre>`);continue;}
  const heading=/^ {0,3}(#{1,6})\s+(.*)$/.exec(line);if(heading){out.push(`<h${heading[1].length}>${inline(heading[2].replace(/\s+#+\s*$/,''))}</h${heading[1].length}>`);i++;continue;}
  if(/^ {0,3}(?:(?:-\s*){3,}|(?:\*\s*){3,}|(?:_\s*){3,})$/.test(line)){out.push('<hr>');i++;continue;}
  if(i+1<lines.length&&line.includes('|')&&divider(lines[i+1])){
   const headers=cells(line);i+=2;let rows='';while(i<lines.length&&lines[i].includes('|')&&lines[i].trim()){const row=cells(lines[i++]);rows+=`<tr>${headers.map((_,j)=>`<td>${inline(row[j]??'')}</td>`).join('')}</tr>`;}
   out.push(`<div class="markdown-table-scroll" tabindex="0" aria-label="可横向滚动的 Markdown 表格"><table><thead><tr>${headers.map(h=>`<th scope="col">${inline(h)}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>`);continue;
  }
  if(/^ {0,3}>/.test(line)){const quote=[];while(i<lines.length&&/^ {0,3}>/.test(lines[i]))quote.push(lines[i++].replace(/^ {0,3}> ?/,''));out.push(`<blockquote>${quote.map(t=>inline(t)).join('<br>')}</blockquote>`);continue;}
  const item=/^\s*([-+*]|\d+[.)])\s+(.*)$/.exec(line);
  if(item){const ordered=/\d/.test(item[1]),tag=ordered?'ol':'ul';let items='';while(i<lines.length){const m=/^\s*([-+*]|\d+[.)])\s+(.*)$/.exec(lines[i]);if(!m||/\d/.test(m[1])!==ordered)break;const task=/^\[([ xX])\]\s+(.*)$/.exec(m[2]);items+=`<li>${task?`<span aria-label="${task[1]===' '?'未完成':'已完成'}">${task[1]===' '?'☐':'☑'}</span> ${inline(task[2])}`:inline(m[2])}</li>`;i++;}out.push(`<${tag}>${items}</${tag}>`);continue;}
  const paragraph=[line];i++;while(i<lines.length&&!special(lines[i])&&!(i+1<lines.length&&divider(lines[i+1])))paragraph.push(lines[i++]);out.push(`<p>${paragraph.map(t=>inline(t)).join('<br>')}</p>`);
 }
 return out.join('');
}
export function normalizeDocuments(data){return {...data,notes:data.notes.map(n=>({...n,archivedAt:null,deletedAt:null}))};}
export function documentText(note){return note.sections?sectionsText(note.sections):note.table?tableText(note.table):note.blocks.map(b=>b.type==='checklist'?`${b.checked?'☑':'☐'} ${b.text}`:b.type==='bullet'?`• ${b.text}`:b.text).join('\n');}
export function documentBlocks(text){
 const blocks=[];let lines=[];
 const flush=()=>{if(lines.length){blocks.push({id:crypto.randomUUID(),type:'text',text:lines.join('\n')});lines=[];}};
 for(const line of text.split('\n')){
  const item=/^([☑☐•]) (.*)$/.exec(line);
  if(item){flush();blocks.push({id:crypto.randomUUID(),type:item[1]==='•'?'bullet':'checklist',text:item[2],...(item[1]==='•'?{}:{checked:item[1]==='☑'})});}
  else lines.push(line);
 }
 flush();return blocks.length?blocks:[{id:crypto.randomUUID(),type:'text',text:''}];
}
export function validateNoteData(value={notes:[],tags:[]}){
 if(!value||!Array.isArray(value.notes)||!Array.isArray(value.tags)||value.notes.length>10000||value.tags.length>500)throw Error('笔记或标签数据无效，最多 10,000 篇笔记、500 个标签。');
 const string=(v,max)=>{if(typeof v!=='string'||v.length>max)throw Error('笔记文字过长或格式无效。');return v;};
 const id=v=>{if(!/^[a-zA-Z0-9_-]{1,80}$/.test(string(v,80)))throw Error('笔记编号无效。');return v;};
 const time=v=>{if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v)||!Number.isFinite(Date.parse(v))||new Date(v).toISOString()!==v)throw Error('笔记时间无效。');return v;};
 const unique=values=>{if(new Set(values).size!==values.length)throw Error('笔记或标签编号重复。');};
 const tags=value.tags.map(t=>{const name=string(t?.name,20).trim();if(!name||/[,，]/.test(name))throw Error('标签名称不能为空或包含逗号。');return {id:id(t.id),name};});
 unique(tags.map(t=>t.id));unique(tags.map(t=>t.name.toLocaleLowerCase()));const tagIds=new Set(tags.map(t=>t.id));
 const notes=value.notes.map(n=>{
  if(n?.format!==undefined&&n.format!=='markdown')throw Error('不支持的文档类型。');
  if(n?.format==='markdown'&&(n.sections!==undefined||n.table!==undefined||n.blocks?.length!==1||n.blocks[0]?.type!=='text'))throw Error('Markdown 文档必须保存为独立源码。');
  if(!n||!Array.isArray(n.blocks)||n.blocks.length>2000||!Array.isArray(n.tagIds)||n.tagIds.length>10||typeof n.isPinned!=='boolean')throw Error('笔记格式无效，每篇最多 10 个标签、2,000 个段落。');
  const blocks=n.blocks.map(b=>{if(!b||!['text','bullet','checklist'].includes(b.type)||(b.type==='checklist'&&typeof b.checked!=='boolean'))throw Error('笔记段落无效。');return {id:id(b.id),type:b.type,text:string(b.text,20000),...(b.type==='checklist'?{checked:b.checked}:{})};});
  unique(blocks.map(b=>b.id));if(blocks.reduce((total,b)=>total+b.text.length,0)>20000)throw Error('单篇正文最多 20,000 字。');
  unique(n.tagIds);if(n.tagIds.some(t=>!tagIds.has(t)))throw Error('笔记引用了不存在的标签。');
  const recordDate=string(n.recordDate,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(recordDate)||!Number.isFinite(Date.parse(recordDate))||new Date(recordDate).toISOString().slice(0,10)!==recordDate)throw Error('请选择有效的记录日期。');
  let sections;
  if(n.sections!==undefined){
   if(!Array.isArray(n.sections)||n.sections.length>60||n.table!==undefined)throw Error('混合文档格式无效，最多 60 个内容段。');
   sections=n.sections.map(part=>{if(!part||!['text','table'].includes(part.type))throw Error('文档内容类型无效。');return {id:id(part.id),type:part.type,...(part.type==='table'?{table:validateTable(part.table)}:{text:string(part.text,20000)})};});
   unique(sections.map(part=>part.id));if(sections.filter(part=>part.type==='table').length>20||sections.reduce((sum,part)=>sum+(part.text?.length??0),0)+blocks.reduce((sum,b)=>sum+b.text.length,0)>20000)throw Error('单篇最多 20 张表格、20,000 字正文。');
  }
  return {...(n.format==='markdown'?{format:'markdown'}:{}),...(sections?{sections}:{}),...(n.table!==undefined?{table:validateTable(n.table)}:{}),id:id(n.id),title:string(n.title,100),blocks,tagIds:[...n.tagIds],recordDate,isPinned:n.isPinned,archivedAt:n.archivedAt===null?null:time(n.archivedAt),deletedAt:n.deletedAt===null?null:time(n.deletedAt),createdAt:time(n.createdAt),updatedAt:time(n.updatedAt)};
 });unique(notes.map(n=>n.id));return {notes,tags};
}
export function pruneNoteData(data,now=Date.now()){return {...data,notes:data.notes.filter(n=>!n.deletedAt||now-Date.parse(n.deletedAt)<RETENTION_MS)};}
export function filterNotes(data,{query='',scope='all',tag='',includeArchived=false,sort='recent'}={}){
 const q=query.trim().toLocaleLowerCase();const tags=new Map(data.tags.map(t=>[t.id,t.name]));
 return data.notes.filter(n=>{
  if(scope==='trash'?!n.deletedAt:n.deletedAt)return false;
  if(scope==='archived'&&!n.archivedAt)return false;
  if(['all','pinned'].includes(scope)&&n.archivedAt&&!includeArchived)return false;
  if(scope==='pinned'&&!n.isPinned)return false;
  return (!tag||n.tagIds.includes(tag))&&(!q||[n.title,noteText(n),...n.tagIds.map(id=>tags.get(id))].join('\n').toLocaleLowerCase().includes(q));
 }).sort((a,b)=>Number(b.isPinned)-Number(a.isPinned)||(sort==='date'?b.recordDate.localeCompare(a.recordDate):b.updatedAt.localeCompare(a.updatedAt))||b.id.localeCompare(a.id));
}

export function mixedSections(note){if(note.sections)return structuredClone(note.sections);const text=documentText({...note,table:undefined});const sections=[];if(text.trim()||!note.table)sections.push({id:crypto.randomUUID(),type:'text',text});if(note.table)sections.push({id:crypto.randomUUID(),type:'table',table:structuredClone(note.table)});return sections;}

// Build a new value before touching the draft, so a limit error cannot lose text.
export function insertDocumentTable(note,table,position=null){
 const sections=mixedSections(note),part={id:crypto.randomUUID(),type:'table',table:structuredClone(table)};
 const index=position?.sectionId?sections.findIndex(s=>s.id===position.sectionId):position?.plain&&!note.sections?0:-1;
 if(index>=0&&sections[index].type==='text'){
  const text=sections[index].text,offset=Math.max(0,Math.min(text.length,position.offset??text.length));
  const tail={id:crypto.randomUUID(),type:'text',text:text.slice(offset)};
  sections[index].text=text.slice(0,offset);sections.splice(index+1,0,part,tail);
 }else sections.splice(Number.isInteger(position?.gap)?Math.max(0,Math.min(sections.length,position.gap)):sections.length,0,part);
 if(sections.length>60||sections.filter(s=>s.type==='table').length>20)throw Error('单篇最多 60 个内容段、20 张表格。');
 return {sections,tableId:part.id};
}


export function deleteTextBoundary(sections,id,direction=-1){
 const index=sections.findIndex(p=>p.id===id),part=sections[index];
 if(!part||part.type!=='text')return null;
 const neighbor=sections[index+direction];
 if(neighbor?.type==='text'){
  const next=structuredClone(sections),left=direction<0?next[index-1]:next[index],right=direction<0?next[index]:next[index+1],offset=left.text.length;
  left.text+=right.text;next.splice(direction<0?index:index+1,1);
  return {sections:next,focusId:left.id,offset};
 }
 if(part.text===''&&sections.length>1){const next=structuredClone(sections);next.splice(index,1);const target=neighbor??next[0];return {sections:next,focusId:target.id,offset:direction<0?(target.text?.length??0):0};}
 return null;
}


// View-only pagination: callers filter and sort the full collection first.
export function paginate(items,requested=1,size=10){
 const pages=Math.max(1,Math.ceil(items.length/size));
 const page=Math.min(pages,Math.max(1,Number.isFinite(requested)?Math.trunc(requested):1));
 const offset=(page-1)*size;
 return {items:items.slice(offset,offset+size),page,pages,total:items.length,start:items.length?offset+1:0,end:Math.min(offset+size,items.length)};
}
export function paginationControls(view,kind){
 return `<nav class="list-pagination" aria-label="${kind==='accounts'?'账号':'笔记'}分页"><div class="pagination-summary" aria-live="polite">共 ${view.total} 条 · ${view.start}–${view.end} 条</div><div class="pagination-actions"><button type="button" class="button secondary" data-list-kind="${kind}" data-list-page="${view.page-1}" ${view.page===1?'disabled':''}>上一页</button><span aria-live="polite">${view.page} / ${view.pages} 页</span><button type="button" class="button secondary" data-list-kind="${kind}" data-list-page="${view.page+1}" ${view.page===view.pages?'disabled':''}>下一页</button></div></nav>`;
}
