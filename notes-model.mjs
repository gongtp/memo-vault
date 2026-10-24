export const RETENTION_MS=30*24*60*60*1000;
export const localDate=(date=new Date())=>`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
export const noteTitle=n=>n.title.trim()||n.blocks.find(b=>b.text.trim())?.text.trim().split('\n')[0].slice(0,30)||'未命名笔记';
export const noteText=n=>n.blocks.map(b=>`${b.type==='checklist'?(b.checked?'☑ ':'☐ '):b.type==='bullet'?'• ':''}${b.text}`).join('\n');
export const hasContent=n=>Boolean(n.title.trim()||n.blocks.some(b=>b.text.trim()));
export function newNote(){const now=new Date().toISOString();return {id:crypto.randomUUID(),title:'',blocks:[{id:crypto.randomUUID(),type:'text',text:''}],tagIds:[],recordDate:localDate(),isPinned:false,archivedAt:null,deletedAt:null,createdAt:now,updatedAt:now};}
export function normalizeDocuments(data){return {...data,notes:data.notes.map(n=>({...n,archivedAt:null,deletedAt:null}))};}
export function documentText(note){return note.blocks.map(b=>b.type==='checklist'?`${b.checked?'☑':'☐'} ${b.text}`:b.type==='bullet'?`• ${b.text}`:b.text).join('\n');}
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
  if(!n||!Array.isArray(n.blocks)||n.blocks.length>2000||!Array.isArray(n.tagIds)||n.tagIds.length>10||typeof n.isPinned!=='boolean')throw Error('笔记格式无效，每篇最多 10 个标签、2,000 个段落。');
  const blocks=n.blocks.map(b=>{if(!b||!['text','bullet','checklist'].includes(b.type)||(b.type==='checklist'&&typeof b.checked!=='boolean'))throw Error('笔记段落无效。');return {id:id(b.id),type:b.type,text:string(b.text,20000),...(b.type==='checklist'?{checked:b.checked}:{})};});
  unique(blocks.map(b=>b.id));if(blocks.reduce((total,b)=>total+b.text.length,0)>20000)throw Error('单篇正文最多 20,000 字。');
  unique(n.tagIds);if(n.tagIds.some(t=>!tagIds.has(t)))throw Error('笔记引用了不存在的标签。');
  const recordDate=string(n.recordDate,10);if(!/^\d{4}-\d{2}-\d{2}$/.test(recordDate)||!Number.isFinite(Date.parse(recordDate))||new Date(recordDate).toISOString().slice(0,10)!==recordDate)throw Error('请选择有效的记录日期。');
  return {id:id(n.id),title:string(n.title,100),blocks,tagIds:[...n.tagIds],recordDate,isPinned:n.isPinned,archivedAt:n.archivedAt===null?null:time(n.archivedAt),deletedAt:n.deletedAt===null?null:time(n.deletedAt),createdAt:time(n.createdAt),updatedAt:time(n.updatedAt)};
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
