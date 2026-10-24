import {newNote,noteTitle,noteText,hasContent,normalizeDocuments,documentText,documentBlocks} from './notes-model.mjs';

const esc=(value='')=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const button=(action,label,style='secondary')=>`<button type="button" class="button ${style}" data-note-action="${action}">${label}</button>`;
const dateLabel=value=>new Date(value).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});

export function createNotes({session,root,changed,toast,onError}){
 let active=false,selected=null,draft=null,editing=false,dirty=false,version=0,timer,maxTimer,saving=null,composing=false,working=false;
 let query='',tag='',sort='recent',history=[],future=[],lastHistory=0;
 const dialog=document.createElement('dialog');dialog.className='notes-dialog';document.body.append(dialog);
 let dialogResolve=null;
 const $=selector=>root.querySelector(selector);
 const data=()=>normalizeDocuments(session.noteData);
 const names=n=>{const tags=data().tags;return n.tagIds.map(id=>tags.find(t=>t.id===id)?.name).filter(Boolean);};
 const snapshot=()=>structuredClone(draft);
 function closeDialog(result=false){dialog.close();dialog.replaceChildren();const resolve=dialogResolve;dialogResolve=null;resolve?.(result);}
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
 function remember(){const now=Date.now();if(now-lastHistory>600){history.push(snapshot());if(history.length>80)history.shift();lastHistory=now;}future=[];}
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
 function clear(){stopTimers();active=false;selected=null;draft=null;editing=false;dirty=false;saving=null;version++;history=[];future=[];composing=false;closeDialog();document.body.classList.remove('note-focus');}
 function reset(){clear();query='';tag='';sort='recent';}
 function render(){
  active=true;
  root.innerHTML=`<div class="page-heading notes-heading"><div><span class="eyebrow">YOUR DOCUMENTS</span><h1>我的文档</h1><p>打开就写，让想法自然成篇。</p></div>${button('new','＋ 新建文档','primary')}</div><div class="notes-layout document-layout"><section class="list-panel notes-list" aria-label="文档列表"><div class="list-toolbar"><div class="list-title"><h2>全部文档 <span id="note-count"></span></h2>${button('tags','标签')}</div><div class="search-box"><input id="note-search" type="search" aria-label="搜索文档" placeholder="搜索标题、正文或标签…" value="${esc(query)}"></div><div class="notes-filters"><select id="note-tag-filter" aria-label="按标签筛选"><option value="">所有标签</option>${data().tags.map(t=>`<option value="${esc(t.id)}" ${tag===t.id?'selected':''}>${esc(t.name)}</option>`).join('')}</select><select id="note-sort" aria-label="文档排序"><option value="recent">最近编辑</option><option value="date">记录日期</option></select></div></div><div id="note-rows"></div><div class="list-footer">${session.settings.moduleLocks.notes?'本地加密保存':'自动保存到本机'}</div></section><section class="notes-detail document-detail" id="note-detail" aria-label="文档内容"></section></div>`;
  $('#note-sort').value=sort;
  $('#note-search').oninput=e=>{query=e.target.value;renderList();};
  $('#note-tag-filter').onchange=e=>{tag=e.target.value;renderList();};
  $('#note-sort').onchange=e=>{sort=e.target.value;renderList();};
  renderList();renderDetail();
 }
 function renderList(){
  if(!active||!$('#note-rows'))return;
  const store=data(),q=query.trim().toLocaleLowerCase();
  const list=store.notes.filter(n=>(!tag||n.tagIds.includes(tag))&&(!q||[n.title,noteText(n),...names(n)].some(s=>s.toLocaleLowerCase().includes(q)))).sort((a,b)=>sort==='date'?b.recordDate.localeCompare(a.recordDate)||b.updatedAt.localeCompare(a.updatedAt):b.updatedAt.localeCompare(a.updatedAt));
  $('#note-count').textContent=list.length;
  $('#note-rows').innerHTML=list.length?list.map(n=>`<button class="note-row ${n.id===selected?'selected':''}" data-note-id="${esc(n.id)}" aria-pressed="${n.id===selected}"><span class="note-row-title">${esc(noteTitle(n))}</span><span class="note-preview">${esc(noteText(n)||'暂无正文')}</span><span class="note-row-meta"><time>${esc(dateLabel(n.updatedAt))}</time><span>${documentText(n).length} 字</span></span><span class="note-tags">${names(n).slice(0,2).map(t=>`<span>${esc(t)}</span>`).join('')}</span></button>`).join(''):`<div class="empty">${query||tag?'没有找到对应文档':'从一张空白文档开始。'}<br>${query||tag?button('clear-filter','清除筛选'):button('new','新建文档')}</div>`;
 }
 function renderDetail(){
  const el=$('#note-detail');if(!el)return;
  const n=draft??data().notes.find(n=>n.id===selected);
  document.body.classList.toggle('note-focus',Boolean(n));
  if(!n){editing=false;el.innerHTML='<div class="notes-welcome"><span>✎</span><h2>写下一篇新文档</h2><p>选择左侧文档继续写，或从空白开始。</p>'+button('new','＋ 新建文档','primary')+'</div>';return;}
  if(!draft)draft={...n,tagNames:names(n).join(', ')};
  editing=true;
  el.innerHTML=`<div class="note-detail-toolbar document-toolbar">${button('back','‹ 所有文档')}<button type="button" id="note-save-status" class="note-save-status" aria-live="polite" data-note-action="retry">${dirty?'待保存':hasContent(draft)?'已保存到本机':'自动保存'}</button><details class="notes-more"><summary aria-label="文档操作">•••</summary><div>${button('copy','复制全文')}${button('delete','删除文档','danger')}</div></details></div><div class="document-paper"><input id="note-title" class="document-title" aria-label="文档标题" maxlength="100" placeholder="无标题文档" value="${esc(draft.title)}"><div class="document-writing-tools">${button('undo','撤销')}${button('redo','重做')}<span>直接输入正文，按回车换行</span></div><textarea id="note-body" class="document-body" aria-label="文档正文" placeholder="从这里开始写…" rows="12" spellcheck="false">${esc(documentText(draft))}</textarea><div class="document-foot"><span id="document-word-count">${documentText(draft).length} 字</span><span>${session.settings.moduleLocks.notes?'自动加密保存':'自动保存到本机'}</span></div><details class="document-properties"><summary>文档信息</summary><div class="note-meta-inputs"><label>记录日期<input id="note-date" type="date" value="${esc(draft.recordDate)}" required></label><label>标签<input id="note-tags" list="note-tag-suggestions" placeholder="可选，用逗号分隔" value="${esc(draft.tagNames)}" maxlength="210"></label><datalist id="note-tag-suggestions">${data().tags.map(t=>`<option value="${esc(t.name)}"></option>`).join('')}</datalist></div></details></div>`;
  for(const [id,key] of [['note-title','title'],['note-date','recordDate'],['note-tags','tagNames']])$('#'+id).oninput=e=>{remember();draft[key]=e.target.value;touched();};
  const body=$('#note-body');resize(body);
  body.oninput=()=>{remember();draft.blocks=documentBlocks(body.value);$('#document-word-count').textContent=`${body.value.length} 字`;resize(body);touched();};
 }
 function resize(el){el.style.height='auto';el.style.height=`${Math.max(360,el.scrollHeight+2)}px`;}
 async function open(id=null){
  if(!await settle()||id&&!await authorize())return;
  const n=id?data().notes.find(n=>n.id===id):newNote();if(!n)return;
  selected=n.id;draft={...n,tagNames:id?names(n).join(', '):''};editing=true;
  dirty=false;history=[];future=[];renderList();renderDetail();
  if(!id)$('#note-title')?.focus();window.scrollTo(0,0);
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
  if(name==='new'){await open();return;}
  if(name==='retry'){await flush();return;}
  if(name==='back'){if(await settle()){draft=null;selected=null;editing=false;dirty=false;render();}return;}
  if(name==='undo'||name==='redo'){
   const source=name==='undo'?history:future,target=name==='undo'?future:history;
   if(!source.length)return;target.push(snapshot());draft=source.pop();lastHistory=0;renderDetail();touched();$('#note-body')?.focus();return;
  }
  if(name==='tags'){await manageTags();return;}
  if(name==='clear-filter'){query='';tag='';render();return;}
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
 root.addEventListener('click',e=>{
  if(!active)return;
  const actionEl=e.target.closest('[data-note-action]'),row=e.target.closest('[data-note-id]');
  if(actionEl)void run(()=>action(actionEl.dataset.noteAction));else if(row)void run(()=>open(row.dataset.noteId));
 });
 root.addEventListener('compositionstart',()=>{if(active)composing=true;});
 root.addEventListener('compositionend',()=>{if(active){composing=false;if(dirty)touched();}});
 const resizeEditor=()=>{if(active&&editing&&$('#note-body'))resize($('#note-body'));};
 window.addEventListener('resize',resizeEditor,{passive:true});window.visualViewport?.addEventListener('resize',resizeEditor,{passive:true});
 window.addEventListener('beforeunload',e=>{if(active&&(dirty||saving)){e.preventDefault();e.returnValue='';}});
 return {render,leave,reset,flush,new:()=>run(()=>open()),get active(){return active;}};
}