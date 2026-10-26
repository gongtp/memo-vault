import {newTable,cellValue,total,format,validateTable,formulaLabel,operators,tableWithTotal,moveTableColumn} from './table-model.mjs';
import {newNote,noteTitle,noteText,hasContent,normalizeDocuments,documentText,documentBlocks,mixedSections,insertDocumentTable,deleteTextBoundary,paginate,paginationControls} from './notes-model.mjs';

const esc=(value='')=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const button=(action,label,style='secondary')=>`<button type="button" class="button ${style}" data-note-action="${action}">${label}</button>`;
const dateLabel=value=>new Date(value).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});

export function createNotes({session,root,changed,toast,onError}){
 let active=false,selected=null,draft=null,editing=false,dirty=false,version=0,timer,maxTimer,saving=null,composing=false,working=false;
 let legacyEditingParts=null,textCaret=null,cellCursor=null,tableSelected=false,expandedTable=false,returnScroll=0;let rowDraftDirty=false;let activeTableId=null;let listPage=1;let query='',tag='',sort='recent',history=[],future=[],lastHistory=0;
 const dialog=document.createElement('dialog');dialog.className='notes-dialog';document.body.append(dialog);
 let dialogResolve=null;
 const $=selector=>root.querySelector(selector);
 const data=()=>normalizeDocuments(session.noteData);
 const names=n=>{const tags=data().tags;return n.tagIds.map(id=>tags.find(t=>t.id===id)?.name).filter(Boolean);};
 const snapshot=()=>structuredClone(draft);
 function closeDialog(result=false){rowDraftDirty=false;dialog.classList.remove('table-row-dialog');dialog.close();dialog.replaceChildren();const resolve=dialogResolve;dialogResolve=null;resolve?.(result);}
 dialog.addEventListener('cancel',e=>{e.preventDefault();closeDialog();});
 function ask(title,message,{password=false,input=null,accept='确认',danger=false}={}){
  closeDialog();dialog.innerHTML=`<form class="notes-dialog-form"><h2 id="notes-dialog-title">${esc(title)}</h2><p>${esc(message)}</p>${password?'<label>主密码<input type="password" name="value" autocomplete="current-password" maxlength="1024" required></label>':input!==null?`<label>标签名称<input name="value" value="${esc(input)}" maxlength="20" required></label>`:''}<p class="inline-error" role="alert"></p><div class="form-footer"><button type="button" class="button secondary" data-cancel>取消</button><button class="button ${danger?'danger':'primary'}" type="submit">${esc(accept)}</button></div></form>`;
  dialog.setAttribute('aria-labelledby','notes-dialog-title');dialog.showModal();
  dialog.querySelector('input, [data-cancel]').focus();
  dialog.querySelector('[data-cancel]').onclick=()=>closeDialog();
  return new Promise(resolve=>{
   dialogResolve=resolve;const generation=session.generation;
   dialog.querySelector('form').onsubmit=async e=>{
    e.preventDefault();const form=e.target;const value=form.elements.value?.value;
    if(password){
     form.elements.value.value='';form.querySelector('[type=submit]').disabled=true;
     try{await session.verify(value);if(generation!==session.generation||!dialog.open||!dialog.contains(form))return;closeDialog(true);}
     catch(error){if(generation===session.generation&&dialog.open&&dialog.contains(form)){form.querySelector('.inline-error').textContent=error.message;form.querySelector('[type=submit]').disabled=false;}}
    }else closeDialog(input!==null?value.trim():true);
   };
  });
 }
 async function authorize(){return !session.settings.verifyBeforeActions||await ask('验证主密码','验证后继续本次笔记操作。编辑期间自动保存不会重复验证。',{password:true,accept:'验证并继续'});}
 function status(text,error=false){const el=$('#note-save-status');if(el){el.textContent=text;el.classList.toggle('save-error',error);}}
 function stopTimers(){clearTimeout(timer);clearTimeout(maxTimer);timer=maxTimer=null;}
 function remember(force=false){const now=Date.now();if(force||now-lastHistory>600){history.push(snapshot());if(history.length>80)history.shift();lastHistory=now;}future=[];}
 function touched(){dirty=true;version++;status('待保存');clearTimeout(timer);timer=setTimeout(()=>void autoSave(),600);if(!maxTimer)maxTimer=setTimeout(()=>{maxTimer=null;void autoSave();},3000);}
 async function autoSave(){if(composing)return;const generation=session.generation;try{await flush();}catch(error){if(generation!==session.generation){if(!session.unlocked&&active)onError(error);return;}if(session.unlocked&&active)status(`${error.message} 点击重试`,true);else onError(error);}}
 async function flush(){
  const started=session.generation;stopTimers();if(saving)await saving;
  if(started!==session.generation)return;
  while(dirty&&draft&&session.unlocked){
   if(!hasContent(draft)&&!data().notes.some(n=>n.id===draft.id)){dirty=false;status('空白笔记不会保存');return;}
   const current=snapshot(),revision=version,generation=session.generation;
   current.updatedAt=new Date().toISOString();const tagNames=current.tagNames.split(/[,，]/).map(t=>t.trim()).filter(Boolean);delete current.tagNames;
   status('正在保存…');
   const pending=session.saveNote(current,tagNames);saving=pending;
   try{await pending;}catch(error){if(generation===session.generation)status(`${error.message} 点击重试`,true);throw error;}finally{if(saving===pending)saving=null;}
   if(generation!==session.generation||!active)return;
   changed();if(version===revision){dirty=false;draft.updatedAt=current.updatedAt;draft.tagIds=data().notes.find(n=>n.id===current.id).tagIds;status('已保存到本机');}
   renderList();
  }
 }
 async function settle(){
  try{await flush();return true;}catch(error){
   if(!session.unlocked){onError(error);return false;}
   const discard=await ask('尚有未保存的更改',`${error.message} 取消后可重试；放弃只丢弃尚未成功保存的更改。`,{accept:'放弃未保存更改',danger:true});
   if(discard){dirty=false;draft=null;editing=false;history=[];future=[];renderDetail();}return discard;
  }
 }
 async function leave(){if(working)return false;if(!active)return true;working=true;try{if(!await settle())return false;clear();return true;}finally{working=false;}}
 function clear(){stopTimers();active=false;selected=null;draft=null;editing=false;dirty=false;saving=null;version++;history=[];future=[];composing=false;activeTableId=null;textCaret=null;closeDialog();expandedTable=false;tableSelected=false;cellCursor=null;document.body.classList.remove('note-focus','document-editing','table-expanded','reading-table-expanded');}
 function reset(){clear();listPage=1;query='';tag='';sort='recent';}
 function render(){
  active=true;
  root.innerHTML=`<div class="page-heading notes-heading"><div><span class="eyebrow">YOUR DOCUMENTS</span><h1>我的文档</h1><p>打开就写，让想法自然成篇。</p></div>${button('new','＋ 新建文档','primary')}</div><div class="notes-layout document-layout"><section class="list-panel notes-list" aria-label="文档列表"><div class="list-toolbar"><div class="list-title"><h2>全部文档 <span id="note-count"></span></h2>${button('tags','标签')}</div><div class="search-box"><input id="note-search" type="search" aria-label="搜索文档" placeholder="搜索标题、正文或标签…" value="${esc(query)}"></div><div class="notes-filters"><select id="note-tag-filter" aria-label="按标签筛选"><option value="">所有标签</option>${data().tags.map(t=>`<option value="${esc(t.id)}" ${tag===t.id?'selected':''}>${esc(t.name)}</option>`).join('')}</select><select id="note-sort" aria-label="文档排序"><option value="recent">最近编辑</option><option value="date">记录日期</option></select></div></div><div id="note-rows"></div><div id="note-pagination"></div><div class="list-footer">${session.settings.moduleLocks.notes?'本地加密保存':'自动保存到本机'}</div></section><section class="notes-detail document-detail" id="note-detail" aria-label="文档内容"></section></div>`;
  $('#note-sort').value=sort;
  $('#note-search').oninput=e=>{query=e.target.value;listPage=1;renderList();};
  $('#note-tag-filter').onchange=e=>{tag=e.target.value;listPage=1;renderList();};
  $('#note-sort').onchange=e=>{sort=e.target.value;listPage=1;renderList();};
  renderList();renderDetail();
 }
 function renderList(){
  if(!active||!$('#note-rows'))return;
  const store=data(),q=query.trim().toLocaleLowerCase();
  const list=store.notes.filter(n=>(!tag||n.tagIds.includes(tag))&&(!q||[n.title,noteText(n),...names(n)].some(s=>s.toLocaleLowerCase().includes(q)))).sort((a,b)=>sort==='date'?b.recordDate.localeCompare(a.recordDate)||b.updatedAt.localeCompare(a.updatedAt):b.updatedAt.localeCompare(a.updatedAt));
  const view=paginate(list,listPage);listPage=view.page;$('#note-pagination').innerHTML=paginationControls(view,'notes');
  $('#note-count').textContent=list.length;
  $('#note-rows').innerHTML=list.length?view.items.map(n=>`<button class="note-row ${n.id===selected?'selected':''}" data-note-id="${esc(n.id)}" aria-pressed="${n.id===selected}"><span class="note-row-title">${esc(noteTitle(n))}</span><span class="note-preview">${esc(noteText(n).slice(0,200)||'暂无正文')}</span><span class="note-row-meta"><time>${esc(dateLabel(n.updatedAt))}</time><span>${n.sections?'文档 · '+n.sections.filter(p=>p.type==='table').length+' 张表格':n.table?'表格 · '+n.table.rows.length+' 行':documentText(n).length+' 字'}</span></span><span class="note-tags">${names(n).slice(0,2).map(t=>`<span>${esc(t)}</span>`).join('')}</span></button>`).join(''):`<div class="empty">${query||tag?'没有找到对应文档':'从一张空白文档开始。'}<br>${query||tag?button('clear-filter','清除筛选'):button('new','新建文档')}</div>`;
 }
 function renderDetail(){
  const el=$('#note-detail');if(!el)return;
  const n=draft??data().notes.find(n=>n.id===selected);
  document.body.classList.toggle('note-focus',Boolean(n));document.body.classList.toggle('document-editing',Boolean(n)&&editing);
  if(!n){editing=false;el.innerHTML='<div class="notes-welcome"><span>✎</span><h2>写下一篇新文档</h2><p>选择左侧文档继续写，或从空白开始。</p>'+button('new','＋ 新建文档','primary')+'</div>';return;}
  if(!editing){renderReading(el,n);return;}
  if(!draft)draft={...structuredClone(n),tagNames:names(n).join(', ')};
  el.innerHTML=`<div class="note-detail-toolbar document-toolbar">${button('back','‹ 所有文档')}<button type="button" id="note-save-status" class="note-save-status" aria-live="polite" data-note-action="retry">${dirty?'待保存':hasContent(draft)?'已保存到本机':'自动保存'}</button>${button('done','完成','primary')}</div><div class="document-paper"><input id="note-title" class="document-title" aria-label="文档标题" maxlength="100" placeholder="无标题文档" value="${esc(draft.title)}"><div class="document-writing-tools" role="toolbar" aria-label="编辑工具"></div>${draft.sections||draft.table?mixedEditor():`<textarea id="note-body" class="document-body" aria-label="文档正文" placeholder="从这里开始写…" rows="12" spellcheck="false">${esc(documentText(draft))}</textarea><div class="document-foot"><span id="document-word-count">${documentText(draft).length} 字</span><span>${session.settings.moduleLocks.notes?'自动加密保存':'自动保存到本机'}</span></div>`}<details class="document-properties"><summary>文档信息</summary><div class="note-meta-inputs"><label>记录日期<input id="note-date" type="date" value="${esc(draft.recordDate)}" required></label><label>标签<input id="note-tags" list="note-tag-suggestions" placeholder="可选，用逗号分隔" value="${esc(draft.tagNames)}" maxlength="210"></label><datalist id="note-tag-suggestions">${data().tags.map(t=>`<option value="${esc(t.name)}"></option>`).join('')}</datalist></div></details></div>`;
  syncTools();syncViewport();
  for(const [id,key] of [['note-title','title'],['note-date','recordDate'],['note-tags','tagNames']])$('#'+id).oninput=e=>{remember();draft[key]=e.target.value;touched();};
  if(draft.sections||draft.table){bindMixed();return;}
  const body=$('#note-body');resize(body);trackCaret(body);
  body.oninput=()=>{remember();draft.blocks=documentBlocks(body.value);$('#document-word-count').textContent=`${body.value.length} 字`;resize(body);touched();};
 }

 function tableReading(table){return `<div class="note-table-scroll reading-table-scroll" tabindex="0" aria-label="可横向滚动的表格"><table class="note-table reading-table"><thead><tr>${table.columns.map(c=>`<th scope="col">${esc(c.name)}</th>`).join('')}</tr></thead><tbody>${table.rows.map((row,i)=>`<tr>${table.columns.map(c=>`<td>${esc(c.type==='product'?calculated(()=>cellValue(table,row,c)):row[c.id]??'')}</td>`).join('')}</tr>`).join('')}</tbody></table></div><div class="table-totals">${table.columns.filter(c=>c.sum).map(c=>`<span>${esc(c.name)}合计 <strong>${esc(calculated(()=>total(table,c)))}</strong></span>`).join('')}</div>`;}
 function renderReading(el,n){
  const table=n.table;
  let readIndex=0;const readTable=t=>`<div class="reading-table-block"><button class="button secondary reading-expand" type="button" data-expand-reading="${readIndex++}">展开表格</button>${tableReading(t)}</div>`;
  const body=n.sections?n.sections.map(part=>part.type==='table'?readTable(part.table):`<div class="document-reading-body mixed-reading-text">${esc(part.text)}</div>`).join(''):table?readTable(table):`<div class="document-reading-body">${esc(documentText(n))||'<span class="document-empty">暂无正文</span>'}</div>`;
  el.innerHTML=`<div class="note-detail-toolbar document-toolbar reading-toolbar">${button('back','‹ 所有文档')}<div class="reading-actions">${button('edit','编辑','primary')}<details class="notes-more"><summary aria-label="更多文档操作">•••</summary><div>${button('copy','复制全文')}${button('delete','删除文档','danger')}</div></details></div></div><article class="document-paper document-reading"><h2>${esc(noteTitle(n))}</h2>${body}</article>`;
 }

 function resize(el,minHeight=360){
  // Measure off-flow: shrinking the live textarea clamps iOS's scroll position.
  const measure=el.cloneNode(false);measure.removeAttribute('id');measure.removeAttribute('name');measure.setAttribute('aria-hidden','true');measure.tabIndex=-1;measure.value=el.value;
  Object.assign(measure.style,{position:'fixed',top:'0',left:'0',visibility:'hidden',pointerEvents:'none',width:`${el.getBoundingClientRect().width}px`,height:'0',minHeight:'0',maxHeight:'none',overflow:'hidden'});
  el.parentElement.append(measure);
  try{const height=`${Math.max(minHeight,measure.scrollHeight+2)}px`;if(el.style.height!==height)el.style.height=height;}finally{measure.remove();}
 }
 async function open(id=null){
  if(!await settle()||id&&!await authorize())return;
  const n=id?data().notes.find(n=>n.id===id):newNote();if(!n)return;
  if(!id)listPage=1;
  textCaret=null;tableSelected=false;cellCursor=null;expandedTable=false;selected=n.id;editing=!id;draft=id?null:{...n,tagNames:''};
  dirty=false;history=[];future=[];renderList();renderDetail();
  if(!id&&n.table)touched();if(!id)$('#note-title')?.focus();window.scrollTo(0,0);
 }

 function chooseNew(){return open();}
 const calculated=fn=>{try{return format(fn());}catch(error){return error.message.includes('除数')?'除数不能为 0':'待修正';}};

 function currentTable(){return draft.sections?draft.sections.find(p=>p.id===activeTableId)?.table:draft.table;}
 function setCurrentTable(table){if(draft.sections)draft.sections.find(p=>p.id===activeTableId).table=table;else draft.table=table;}
 function tableRoot(){return $('#table-settings-host');}
 function gridRoot(){return root.querySelector(`[data-table-id="${activeTableId}"]`);}
 function trackCaret(el){
  const capture=()=>{textCaret={noteId:draft.id,offset:el.selectionStart,...(el.dataset.sectionText?(draft.sections?{sectionId:el.dataset.sectionText}:{plain:true}):el.dataset.textGap!==undefined?{gap:Number(el.dataset.textGap)}:{plain:true})};};
  for(const event of ['focus','click','keyup','select','input','blur'])el.addEventListener(event,capture);
  el.addEventListener('focus',()=>{tableSelected=false;syncTools();});
 }
 function mixedEditor(){
  const parts=draft.sections??(legacyEditingParts=mixedSections(draft));
  if(!parts.some(p=>p.id===activeTableId&&p.type==='table'))activeTableId=parts.find(p=>p.type==='table')?.id??null;
  const textArea=(value,attrs)=>`<textarea class="mixed-text" ${attrs} aria-label="文档正文" rows="1">${esc(value)}</textarea>`;
  const gap=index=>textArea('',`data-text-gap="${index}"`);
  return parts.map((part,index)=>`${part.type==='table'&&(index===0||parts[index-1].type==='table')?gap(index):''}<section class="document-section">${part.type==='text'?textArea(part.text,`data-section-text="${esc(part.id)}"`):tableGrid(part.table,part.id)}</section>`).join('')+(!parts.length||parts.at(-1).type==='table'?gap(parts.length):'')+'<div id="table-settings-host" hidden></div>';

 }
 function bindMixed(){
  const legacyParts=legacyEditingParts;
  root.querySelectorAll('[data-section-text],[data-text-gap]').forEach(el=>{
   const resizeText=()=>resize(el,48);resizeText();
   el.oninput=()=>{
    const sections=draft.sections??legacyParts;
    if(el.dataset.textGap!==undefined&&sections.length>=60){toast('单篇最多 60 个内容段。');el.value='';resizeText();return;}
    remember();
    if(!draft.sections){draft.sections=sections;delete draft.table;draft.blocks=documentBlocks('');activeTableId=sections.find(p=>p.type==='table')?.id??null;}
    let part=sections.find(p=>p.id===el.dataset.sectionText);
    if(!part){const index=Number(el.dataset.textGap);part={id:crypto.randomUUID(),type:'text',text:''};sections.splice(index,0,part);delete el.dataset.textGap;el.dataset.sectionText=part.id;
     root.querySelectorAll('[data-text-gap]').forEach(other=>{if(Number(other.dataset.textGap)>=index)other.dataset.textGap=Number(other.dataset.textGap)+1;});}
    part.text=el.value;resizeText();touched();
   };
   const deleteBoundary=(e,direction)=>{
    if(composing||e.isComposing||el.selectionStart!==el.selectionEnd||el.selectionStart!==(direction<0?0:el.value.length)||!draft.sections)return;
    const result=deleteTextBoundary(draft.sections,el.dataset.sectionText,direction);if(!result)return;
    e.preventDefault();remember(true);draft.sections=result.sections;textCaret=null;renderDetail();touched();
    const text=root.querySelector(`[data-section-text="${result.focusId}"]`);
    if(text){text.focus();text.setSelectionRange(result.offset,result.offset);text.dispatchEvent(new Event('select'));}
    else{const grid=root.querySelector(`[data-table-id="${result.focusId}"]`),cells=grid?.querySelectorAll('[data-table-row]');(direction<0?cells?.[cells.length-1]:cells?.[0])?.focus();}
   };
   el.addEventListener('keydown',e=>{if(e.key==='Backspace')deleteBoundary(e,-1);else if(e.key==='Delete')deleteBoundary(e,1);});
   el.addEventListener('beforeinput',e=>{if(e.inputType==='deleteContentBackward')deleteBoundary(e,-1);else if(e.inputType==='deleteContentForward')deleteBoundary(e,1);});
   trackCaret(el);
  });
  bindGrids();
 }
 async function sectionAction(el){
  if(!editing)return;
  if(el.dataset.editTable){activeTableId=el.dataset.editTable;renderDetail();return;}
  if(el.dataset.removePart){if(!await ask('移除这张表格？','表格会被移除，可在当前编辑过程撤销。',{accept:'移除',danger:true}))return;remember(true);if(draft.sections)draft.sections=draft.sections.filter(p=>p.id!==el.dataset.removePart);else delete draft.table;expandedTable=false;tableSelected=false;document.body.classList.remove('table-expanded');textCaret=null;renderDetail();touched();return;}
  const blank=newTable();blank.columns[1]={...blank.columns[1],name:'内容',type:'text'};
  const result=insertDocumentTable(draft,blank,textCaret?.noteId===draft.id?textCaret:null);
  remember(true);draft.sections=result.sections;draft.blocks=documentBlocks('');delete draft.table;
  activeTableId=result.tableId;textCaret=null;tableSelected=true;renderDetail();touched();gridRoot()?.querySelector('[data-table-row]')?.focus();
 }

 function syncViewport(){
  const v=window.visualViewport;if(!v)return;
  for(const [name,value] of [['--keyboard-inset',`${Math.max(0,window.innerHeight-v.height-v.offsetTop)}px`],['--editor-height',`${v.height}px`]])if(root.style.getPropertyValue(name)!==value)root.style.setProperty(name,value);
 }
 function syncTools(){
  const bar=$('.document-writing-tools');if(!bar)return;
  bar.innerHTML=tableSelected&&currentTable()?`${button('previous-cell','上一格')}${button('next-cell','下一格')}${button('add-row','＋ 行')}${button('quick-column','＋ 列')}${button('calculate','计算')}<details class="notes-more"><summary aria-label="更多表格操作">•••</summary><div>${button('undo','撤销')}${button('redo','重做')}${button('columns','列设置')}${button('remove-current-row','删除当前行')}${button('remove-current-table','删除表格','danger')}</div></details>`:`${button('undo','撤销')}${button('redo','重做')}<button class="button secondary insert-table-direct" type="button" data-insert-part="table">插入表格</button>`;
  root.querySelectorAll('[data-table-id]').forEach(el=>el.classList.toggle('selected-table',tableSelected&&el.dataset.tableId===activeTableId));
 }
 function tableGrid(t,id){return `<div class="inline-table ${expandedTable&&activeTableId===id?'expanded-table':''}" data-table-id="${esc(id)}"><div class="table-caption"><span>${t.rows.length} 行 · ${t.columns.length} 列</span><button type="button" class="button secondary" data-expand-table="${esc(id)}">${expandedTable&&activeTableId===id?'收起表格':'展开'}</button></div><div class="note-table-scroll"><table class="note-table"><thead><tr>${t.columns.map(c=>`<th><button type="button" data-configure-column="${esc(c.id)}">${esc(c.name)}</button></th>`).join('')}</tr></thead><tbody>${t.rows.map((row,i)=>`<tr>${t.columns.map(c=>`<td>${c.type==='product'?`<output data-table-result="${i}:${esc(c.id)}">${calculated(()=>cellValue(t,row,c))}</output>`:`<input aria-label="第${i+1}行 ${esc(c.name)}" data-table-row="${i}" data-table-col="${esc(c.id)}" type="${c.type==='date'?'date':'text'}" ${['number','money'].includes(c.type)?'inputmode="decimal"':''} maxlength="500" value="${esc(row[c.id]??'')}" autocomplete="off">`}</td>`).join('')}</tr>`).join('')}</tbody></table></div><button type="button" class="table-append-row" data-append-row>＋ 行</button><div class="table-totals" aria-live="polite">${t.columns.filter(c=>c.sum).map(c=>`<span>${esc(c.name)}合计 <strong data-table-total="${esc(c.id)}">${esc(calculated(()=>total(t,c)))}</strong></span>`).join('')}</div></div>`;}
 function selectGrid(wrapper){if(activeTableId!==wrapper.dataset.tableId)cellCursor=null;activeTableId=wrapper.dataset.tableId;tableSelected=true;textCaret=null;syncTools();}
 function bindGrids(){
  root.querySelectorAll('[data-table-id]').forEach(wrapper=>{
   wrapper.addEventListener('focusin',e=>{selectGrid(wrapper);if(e.target.dataset.tableRow!==undefined)cellCursor={row:Number(e.target.dataset.tableRow),col:e.target.dataset.tableCol};});
   wrapper.querySelectorAll('[data-table-row]').forEach(el=>{
    el.oninput=()=>{selectGrid(wrapper);remember();currentTable().rows[Number(el.dataset.tableRow)][el.dataset.tableCol]=el.value;updateTotals();touched();};
    el.onkeydown=e=>{if(e.key==='Tab'){e.preventDefault();moveCell(e.shiftKey?-1:1);}else if(e.key==='Enter'&&!e.isComposing){e.preventDefault();moveCell(1);}};
   });
   wrapper.querySelector('[data-append-row]').onclick=()=>{selectGrid(wrapper);void run(()=>action('add-row'));};
   wrapper.querySelector('[data-expand-table]').onclick=()=>{selectGrid(wrapper);if(!expandedTable)returnScroll=window.scrollY;expandedTable=!expandedTable;document.body.classList.toggle('table-expanded',expandedTable);renderDetail();if(!expandedTable)window.scrollTo(0,returnScroll);};
   wrapper.querySelectorAll('[data-configure-column]').forEach(el=>el.onclick=()=>{selectGrid(wrapper);showSettings();const card=tableRoot().querySelector(`[data-column-card="${el.dataset.configureColumn}"]`);card.open=true;card.scrollIntoView({block:'nearest'});});
  });syncTools();
 }
 function moveCell(delta){
  const fields=[...gridRoot().querySelectorAll('[data-table-row]')];let index=fields.findIndex(el=>Number(el.dataset.tableRow)===cellCursor?.row&&el.dataset.tableCol===cellCursor?.col);
  index=Math.max(0,Math.min(fields.length-1,index+delta));fields[index]?.focus();fields[index]?.scrollIntoView({block:'nearest',inline:'nearest'});
 }
 function showSettings(calculation=false){
  const host=tableRoot();if(!host||!currentTable())return;
  const body=calculation?`<p class="table-hint">选择需要合计的列；填写数字后，合计自动更新。</p><div class="sum-options">${currentTable().columns.map(c=>`<label><span>${esc(c.name)}</span><input type="checkbox" data-quick-sum="${esc(c.id)}" ${c.sum?'checked':''} ${c.type==='date'?'disabled':''} aria-label="${esc(c.name)}底部合计"></label>`).join('')}</div><button class="button secondary" type="button" data-advanced-calculation>设置计算列（加减乘除）</button>`:tableEditor();
  host.hidden=false;host.innerHTML=`<div class="settings-sheet" role="dialog" aria-modal="true" aria-label="${calculation?'计算与合计':'表格设置'}"><div class="settings-sheet-heading"><strong>${calculation?'计算与合计':'表格设置'}</strong><button type="button" class="button secondary" data-close-settings>完成</button></div>${body}</div>`;
  const close=()=>{host.hidden=true;host.replaceChildren();renderDetail();};host.querySelector('[data-close-settings]').onclick=close;
  host.onkeydown=e=>{if(e.key==='Escape'){e.preventDefault();close();}if(e.key==='Tab'){const fields=[...host.querySelectorAll('button,input,select,summary')].filter(el=>!el.disabled&&el.getClientRects().length);if(e.shiftKey&&document.activeElement===fields[0]){e.preventDefault();fields.at(-1)?.focus();}else if(!e.shiftKey&&document.activeElement===fields.at(-1)){e.preventDefault();fields[0]?.focus();}}};
  if(calculation){
   host.querySelectorAll('[data-quick-sum]').forEach(el=>el.onchange=()=>{let next;try{next=tableWithTotal(currentTable(),el.dataset.quickSum,el.checked);}catch(error){el.checked=!el.checked;toast('这列包含非数字内容，请先修改内容再开启合计。');return;}remember(true);setCurrentTable(next);touched();renderDetail();showSettings(true);});
   host.querySelector('[data-advanced-calculation]').onclick=()=>{showSettings();$('#table-new-type').value='product';$('#new-column-formula').hidden=false;$('#table-new-name').focus();};
  }else{host.querySelector('.table-properties').open=true;bindTable();}
  host.querySelector('[data-close-settings]').focus();
 }
 function tableEditor(){const t=currentTable();return `<details class="table-properties"><summary>设置列</summary><p class="table-hint">可修改列名和类型，按需开启求和。计算列可选择两个数字或金额列进行加、减、乘、除。</p>${t.columns.map(c=>columnSettings(t,c)).join('')}<div class="table-add-column"><label>新列名称<input id="table-new-name" maxlength="40" placeholder="例如：时长、进度、得分"></label><label>列类型<select id="table-new-type" aria-label="新列类型">${typeOptions('text',true)}</select></label><div id="new-column-formula" hidden>${formulaControls(t,{id:'new',factors:[],operator:'+'})}</div>${button('add-column','＋ 添加列')}</div></details>`;}

 const types={text:'文本',number:'数字',money:'金额',date:'日期',product:'计算'};
 function typeOptions(selected,includeFormula=false){return Object.entries(types).filter(([key])=>includeFormula||key!=='product').map(([key,label])=>`<option value="${key}" ${key===selected?'selected':''}>${label}</option>`).join('');}
 function formulaControls(t,c){const numeric=t.columns.filter(x=>['number','money'].includes(x.type));const options=selected=>numeric.map(x=>`<option value="${esc(x.id)}" ${x.id===selected?'selected':''}>${esc(x.name||'未命名列')}</option>`).join('');return `<div class="table-formula" data-formula="${esc(c.id)}"><select aria-label="计算左侧列" data-factor="0">${options(c.factors[0])}</select><select aria-label="运算方式" data-operator>${Object.entries(operators).map(([op,label])=>`<option value="${op}" ${op===(c.operator??'*')?'selected':''}>${label}</option>`).join('')}</select><select aria-label="计算右侧列" data-factor="1">${options(c.factors[1]??numeric[1]?.id)}</select></div>`;}
 function columnSettings(t,c){const index=t.columns.findIndex(column=>column.id===c.id);return `<details class="table-column-card" data-column-card="${esc(c.id)}"><summary><strong data-column-caption="${esc(c.id)}">${esc(c.name||'未命名列')}</strong><span>${types[c.type]}${c.sum?' · 求和':''}</span></summary><div class="table-column-setting"><label class="column-field column-position">列位置<select aria-label="${esc(c.name)}列位置" data-column-position="${esc(c.id)}">${t.columns.map((other,i)=>`<option value="${i}" ${i===index?'selected':''}>第 ${i+1} 列</option>`).join('')}</select></label><label class="column-field">列名称<input aria-label="列名 ${esc(c.name)}" data-column-name="${esc(c.id)}" maxlength="40" value="${esc(c.name)}"></label>${c.type==='product'?'<span>自动计算</span>':`<label class="column-field">内容类型<select aria-label="列类型 ${esc(c.name)}" data-column-type="${esc(c.id)}">${typeOptions(c.type)}</select></label>`}${['number','money','product'].includes(c.type)?`<label class="column-sum"><input type="checkbox" data-column-sum="${esc(c.id)}" ${c.sum?'checked':''}>底部显示合计</label>`:''}${c.type==='product'?formulaControls(t,c):''}<button type="button" data-remove-column="${esc(c.id)}">删除此列</button></div></details>`;}
 function refreshTableSettings(){const opened=[...root.querySelectorAll('[data-column-card][open]')].map(el=>el.dataset.columnCard);renderDetail();showSettings();root.querySelectorAll('[data-column-card]').forEach(el=>el.open=opened.includes(el.dataset.columnCard));}

 function updateTotals(){const t=currentTable();gridRoot().querySelectorAll('[data-table-result]').forEach(el=>{const [index,id]=el.dataset.tableResult.split(':');el.textContent=calculated(()=>cellValue(t,t.rows[index],t.columns.find(c=>c.id===id)));});gridRoot().querySelectorAll('[data-table-total]').forEach(el=>{const c=t.columns.find(c=>c.id===el.dataset.tableTotal);el.textContent=c.sum?calculated(()=>total(t,c)):'';});}

 function bindTable(){
  tableRoot().querySelectorAll('[data-column-position]').forEach(el=>el.onchange=()=>{
   const id=el.dataset.columnPosition,target=Number(el.value);if(currentTable().columns[target]?.id===id)return;
   const next=moveTableColumn(currentTable(),id,target);remember(true);setCurrentTable(next);refreshTableSettings();touched();
   const field=tableRoot().querySelector(`[data-column-position="${id}"]`);field.scrollIntoView({block:'nearest'});field.focus({preventScroll:true});
  });
  tableRoot().querySelectorAll('[data-table-row]').forEach(el=>el.oninput=()=>{remember();currentTable().rows[Number(el.dataset.tableRow)][el.dataset.tableCol]=el.value;updateTotals();touched();});
  $('#table-new-type').onchange=e=>{$('#new-column-formula').hidden=e.target.value!=='product';};
  tableRoot().querySelectorAll('[data-column-type]').forEach(el=>el.onchange=()=>{const next=structuredClone(currentTable()),column=next.columns.find(c=>c.id===el.dataset.columnType);column.type=el.value;if(!['number','money'].includes(column.type))column.sum=false;try{validateTable(next);}catch(error){el.value=currentTable().columns.find(c=>c.id===el.dataset.columnType).type;toast('无法转换：'+error.message);return;}remember(true);setCurrentTable(next);refreshTableSettings();touched();});
  tableRoot().querySelectorAll('[data-formula]').forEach(el=>{if(el.dataset.formula==='new')return;el.onchange=()=>{remember(true);const c=currentTable().columns.find(c=>c.id===el.dataset.formula);c.factors=[...el.querySelectorAll('[data-factor]')].map(x=>x.value);c.operator=el.querySelector('[data-operator]').value;refreshTableSettings();touched();};});
  tableRoot().querySelectorAll('[data-column-name]').forEach(el=>el.oninput=()=>{remember();currentTable().columns.find(c=>c.id===el.dataset.columnName).name=el.value;tableRoot().querySelectorAll('[data-column-caption]').forEach(caption=>{if(caption.dataset.columnCaption===el.dataset.columnName)caption.textContent=el.value||'未命名列';});const index=currentTable().columns.findIndex(c=>c.id===el.dataset.columnName);gridRoot().querySelectorAll('[data-configure-column]')[index].textContent=el.value;tableRoot().querySelectorAll('[data-factor] option').forEach(option=>{option.textContent=currentTable().columns.find(c=>c.id===option.value)?.name||'未命名列';});currentTable().columns.forEach((c,i)=>{if(c.type==='product')gridRoot().querySelectorAll('[data-configure-column]')[i].innerHTML=esc(c.name)+'<small>'+esc(formulaLabel(currentTable(),c))+'</small>';});gridRoot().querySelectorAll('.table-totals [data-table-total]').forEach(output=>{output.parentElement.firstChild.textContent=currentTable().columns.find(c=>c.id===output.dataset.tableTotal).name+'合计 ';});touched();});

  tableRoot().querySelectorAll('[data-column-sum]').forEach(el=>el.onchange=()=>{remember();currentTable().columns.find(c=>c.id===el.dataset.columnSum).sum=el.checked;refreshTableSettings();touched();});
  tableRoot().querySelectorAll('[data-remove-row],[data-remove-column]').forEach(el=>el.onclick=()=>void run(async()=>{
   const id=el.dataset.removeColumn;
   if(id&&currentTable().columns.length===1)throw Error('至少保留一列。');
   if(id&&currentTable().columns.some(c=>c.factors?.includes(id)))throw Error('这列被计算列引用，请先修改计算方式或删除对应计算列。');
   if(!await ask(id?'删除这一列？':'删除这一行？','其中的内容也会移除，可在当前编辑过程撤销。',{accept:'删除',danger:true}))return;
   remember(true);if(id){currentTable().columns=currentTable().columns.filter(c=>c.id!==id);currentTable().rows.forEach(row=>delete row[id]);}else currentTable().rows.splice(Number(el.dataset.removeRow),1);renderDetail();touched();
  }));
 }

 async function manageTags(){
  if(!await settle()||!await authorize())return;
  if(editing){draft=null;editing=false;renderDetail();}
  const show=()=>{
   closeDialog();dialog.setAttribute('aria-label','管理笔记标签');dialog.removeAttribute('aria-labelledby');
   dialog.innerHTML=`<div class="dialog-heading"><h2>管理标签</h2><button type="button" class="icon-button" data-close-tags aria-label="关闭">×</button></div><p class="gate-hint">在笔记中输入标签即可新增。删除标签只解除关联，不删除笔记。</p><div class="notes-tag-list">${data().tags.map(t=>`<div class="notes-tag-row"><span>${esc(t.name)}<small>${data().notes.filter(n=>n.tagIds.includes(t.id)).length} 篇笔记</small></span><button type="button" class="button secondary" data-rename-tag="${esc(t.id)}">重命名</button><button type="button" class="button secondary" data-delete-tag="${esc(t.id)}">删除</button></div>`).join('')||'<p>还没有标签。</p>'}</div>`;
   dialog.showModal();dialog.querySelector('[data-close-tags]').onclick=()=>closeDialog();
   dialog.querySelectorAll('[data-rename-tag],[data-delete-tag]').forEach(el=>el.onclick=async()=>{
    const id=el.dataset.renameTag||el.dataset.deleteTag,t=data().tags.find(t=>t.id===id);const removing=Boolean(el.dataset.deleteTag);
    const result=await ask(removing?'删除标签':'重命名标签',removing?`将从 ${data().notes.filter(n=>n.tagIds.includes(id)).length} 篇笔记中移除「${t.name}」，笔记内容保留。`:'名称最多 20 字，不可与已有标签重复。',removing?{danger:true,accept:'删除标签'}:{input:t.name,accept:'保存'});
    if(!session.unlocked||!active)return;
    if(result){try{await session.changeNoteTag(id,removing?null:result);changed();tag='';draft=null;render();}catch(error){onError(error);}}
    if(session.unlocked&&active)show();
   });
  };show();
 }
 async function action(name){
  if(name==='edit'){textCaret=null;if(!await authorize())return;const n=data().notes.find(n=>n.id===selected);if(!n)return;draft={...structuredClone(n),tagNames:names(n).join(', ')};editing=true;dirty=false;history=[];future=[];renderDetail();return;}
  if(name==='done'){await flush();if(dirty)return;expandedTable=false;tableSelected=false;document.body.classList.remove('table-expanded');editing=false;draft=null;history=[];future=[];renderList();renderDetail();return;}
  if(['undo','redo','add-row','add-column','retry'].includes(name)&&!editing)return;

  if(name==='previous-cell'||name==='next-cell'){moveCell(name==='previous-cell'?-1:1);return;}
  if(name==='quick-column'){if(currentTable().columns.length>=12)throw Error('最多 12 列。');remember(true);const c={id:crypto.randomUUID(),name:'列 '+(currentTable().columns.length+1),type:'text'};currentTable().columns.push(c);renderDetail();touched();gridRoot()?.querySelector(`[data-table-col="${c.id}"]`)?.focus();return;}
  if(name==='remove-current-table'){await sectionAction({dataset:{removePart:activeTableId}});expandedTable=false;tableSelected=false;document.body.classList.remove('table-expanded');syncTools();return;}
  if(name==='remove-current-row'){if(cellCursor===null||!currentTable().rows[cellCursor.row]){toast('请先点选要删除的行中的单元格。');return;}if(!await ask('删除当前行？','可在编辑过程撤销。',{accept:'删除',danger:true}))return;remember(true);currentTable().rows.splice(cellCursor.row,1);cellCursor=null;renderDetail();touched();return;}
  if(name==='new'){await chooseNew();return;}
  if(name==='add-row'){if(currentTable().rows.length>=500)throw Error('最多 500 行。');remember(true);currentTable().rows.push({});renderDetail();touched();gridRoot()?.querySelectorAll('[data-table-row]')[ (currentTable().rows.length-1)*currentTable().columns.filter(c=>c.type!=='product').length ]?.focus();return;}
  if(name==='columns'||name==='calculate'){showSettings(name==='calculate');return;}
  if(name==='add-column'){if(currentTable().columns.length>=12)throw Error('最多 12 列。');const type=$('#table-new-type').value,column={id:crypto.randomUUID(),name:$('#table-new-name').value.trim()||'新列',type,sum:false};if(type==='product'){const controls=$('#new-column-formula');column.factors=[...controls.querySelectorAll('[data-factor]')].map(el=>el.value);column.operator=controls.querySelector('[data-operator]').value;if(column.factors.some(id=>!id))throw Error('请先添加数字或金额列，再选择参与计算的列。');}validateTable({...currentTable(),columns:[...currentTable().columns,column]});remember(true);currentTable().columns.push(column);refreshTableSettings();touched();return;}
  if(name==='retry'){await flush();return;}
  if(name==='back'){if(await settle()){expandedTable=false;tableSelected=false;document.body.classList.remove('table-expanded');draft=null;selected=null;editing=false;dirty=false;render();}return;}
  if(name==='undo'||name==='redo'){
   const source=name==='undo'?history:future,target=name==='undo'?future:history;
   if(!source.length)return;target.push(snapshot());draft=source.pop();textCaret=null;lastHistory=0;renderDetail();touched();$('#note-body')?.focus();return;
  }
  if(name==='tags'){await manageTags();return;}
  if(name==='clear-filter'){listPage=1;query='';tag='';render();return;}
  if(!await settle()||!await authorize())return;
  const n=data().notes.find(n=>n.id===selected);if(!n)return;
  if(name==='copy'){
   closeDialog();dialog.innerHTML=`<h2>复制文档</h2><p class="gate-hint">内容将进入系统剪贴板。</p><div class="form-footer"><button class="button secondary" data-close-copy>取消</button><button class="button primary" data-copy-note>复制全文</button></div>`;dialog.removeAttribute('aria-labelledby');dialog.setAttribute('aria-label','复制文档');dialog.showModal();
   dialog.querySelector('[data-close-copy]').onclick=()=>closeDialog();
   dialog.querySelector('[data-copy-note]').onclick=()=>{const generation=session.generation;navigator.clipboard?.writeText(`${noteTitle(n)}\n${documentText(n)}`).then(()=>{if(generation===session.generation){closeDialog();toast('文档已复制。');}}).catch(()=>toast('浏览器未允许复制，请手动选择文字。'));};return;
  }
  if(name==='delete'){
   if(!await ask('删除这篇文档？',`「${noteTitle(n)}」将直接删除，应用内无法恢复。之前导出的备份不受影响。`,{danger:true,accept:'确认删除'}))return;
   await session.deleteNote(n.id);changed();selected=null;draft=null;editing=false;dirty=false;render();toast('文档已删除。');
  }
 }
 async function run(work){if(working||!active||!session.unlocked)return;working=true;const generation=session.generation;try{await work();}catch(error){if(generation===session.generation||(!session.unlocked&&active))onError(error);}finally{working=false;}}
 root.addEventListener('pointerdown',e=>{if(editing&&e.target.closest('.document-writing-tools button'))e.preventDefault();});
 root.addEventListener('click',e=>{
  if(!active)return;
  const pager=e.target.closest('[data-list-kind="notes"][data-list-page]');if(pager){void run(async()=>{if(!await settle())return;listPage=Number(pager.dataset.listPage);renderList();$('.notes-list .list-toolbar').scrollIntoView({block:'start'});});return;}
  const readingExpand=e.target.closest('[data-expand-reading]');if(readingExpand){const block=readingExpand.closest('.reading-table-block'),opening=!block.classList.contains('expanded-reading-table');if(opening)returnScroll=window.scrollY;block.classList.toggle('expanded-reading-table',opening);document.body.classList.toggle('reading-table-expanded',opening);readingExpand.textContent=opening?'收起表格':'展开表格';if(!opening)window.scrollTo(0,returnScroll);return;}
  const sectionEl=e.target.closest('[data-insert-part],[data-remove-part],[data-edit-table]');if(sectionEl){void run(()=>sectionAction(sectionEl));return;}
  const actionEl=e.target.closest('[data-note-action]'),row=e.target.closest('[data-note-id]');
  if(actionEl)void run(()=>action(actionEl.dataset.noteAction));else if(row)void run(()=>open(row.dataset.noteId));
 });
 root.addEventListener('compositionstart',()=>{if(active)composing=true;});
 root.addEventListener('compositionend',()=>{if(active){composing=false;if(dirty)touched();}});
 let editorWidth=Math.round(root.clientWidth);
 const resizeEditor=()=>{
  if(!active||!editing)return;syncViewport();
  const width=Math.round(root.clientWidth);if(width===editorWidth)return;editorWidth=width;
  if($('#note-body'))resize($('#note-body'));
  root.querySelectorAll('.mixed-text').forEach(el=>resize(el,48));
 };
 const scrollViewport=()=>{if(active&&editing)syncViewport();};
 window.addEventListener('resize',resizeEditor,{passive:true});window.visualViewport?.addEventListener('resize',resizeEditor,{passive:true});window.visualViewport?.addEventListener('scroll',scrollViewport,{passive:true});
 window.addEventListener('beforeunload',e=>{if(active&&(dirty||saving||rowDraftDirty)){e.preventDefault();e.returnValue='';}});
 return {render,leave,reset,flush,new:()=>run(async()=>chooseNew()),get active(){return active;}};
}