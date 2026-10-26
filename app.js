import {paginate,paginationControls} from './notes-model.mjs';
import {createNotes} from './notes.js';
import {mountOfflineSettings} from './offline.js';
import {ConflictError,LockedError} from './vault.mjs';
import {ModuleVault,parseBackupFile,MAX_BACKUP_BYTES} from './module-vault.mjs';
import {installAutoLock} from './lifecycle.mjs';
const paths = {
 trash:'<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>',
 grid:'<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
 key:'<circle cx="8" cy="8" r="5"/><path d="m11.5 11.5 9 9m-3-3 3-3m-6 0 3-3"/>',
 note:'<rect x="4" y="3" width="16" height="18" rx="3"/><path d="M8 8h8M8 12h8M8 16h5"/>',
 card:'<rect x="2" y="5" width="20" height="14" rx="3"/><path d="M2 10h20M6 15h4"/>',
 folder:'<path d="M3 7V5a2 2 0 0 1 2-2h5l3 3h6a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>',
 shield:'<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Z"/><path d="m8 12 3 3 5-6"/>',
 settings:'<path d="M10.186 4.723L10.678 2.592L13.322 2.592L13.814 4.723L15.863 5.571L17.717 4.413L19.587 6.283L18.429 8.137L19.277 10.186L21.408 10.678L21.408 13.322L19.277 13.814L18.429 15.863L19.587 17.717L17.717 19.587L15.863 18.429L13.814 19.277L13.322 21.408L10.678 21.408L10.186 19.277L8.137 18.429L6.283 19.587L4.413 17.717L5.571 15.863L4.723 13.814L2.592 13.322L2.592 10.678L4.723 10.186L5.571 8.137L4.413 6.283L6.283 4.413L8.137 5.571Z"/><circle cx="12" cy="12" r="3"/>',
 lock:'<rect x="5" y="10" width="14" height="11" rx="3"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2"/>',
 help:'<circle cx="12" cy="12" r="9"/><path d="M9.5 8.5a2.5 2.5 0 1 1 4 2c-1 .5-1.5 1-1.5 2.5m0 3h.01"/>',
 plus:'<path d="M12 5v14M5 12h14"/>',
 search:'<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>',
 star:'<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-2.9-5.6 2.9 1.1-6.2L3 9.6l6.2-.9Z"/>',
 clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
 copy:'<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
 eye:'<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
 edit:'<path d="m15 4 5 5M4 20l5-1L21 7a2 2 0 0 0-5-5L4 14Zm0 0h16"/>',
 arrow:'<path d="M7 17 17 7M7 7h10v10"/>',
 back:'<path d="m14 5-7 7 7 7"/>',
 download:'<path d="M12 3v12m-4-4 4 4 4-4M4 16v5h16v-5"/>',
 github:'<path fill="currentColor" stroke="none" d="M12 2a10 10 0 0 0-3.2 19.5v-2.6c-2.5.5-3-1-3-1-.4-1-1-1.3-1-1.3-.8-.6 0-.6 0-.6.9 0 1.4.9 1.4.9.8 1.4 2.1 1 2.7.8.1-.6.3-1 .6-1.3-2-.2-4.2-1-4.2-4.5 0-1 .3-1.8 1-2.5-.1-.3-.5-1.2.1-2.5 0 0 .8-.3 2.7 1a9 9 0 0 1 4.9 0c1.9-1.3 2.7-1 2.7-1 .6 1.3.2 2.2.1 2.5.7.7 1 1.5 1 2.5 0 3.5-2.2 4.3-4.2 4.5.3.3.6.9.6 1.7v3.4A10 10 0 0 0 12 2Z"/>'
};
const icon = (name) => `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.key}</svg>`;
function hydrateIcons(){document.querySelectorAll('[data-icon]').forEach(el=>el.outerHTML=icon(el.dataset.icon));}
const escapeHTML = (value='') => String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let accounts=[],accountPage=1;
const session=new ModuleVault();
let page='overview',filter='全部',query='',selected=null,sort='recent',editId=null,showPassword=false,pendingImport=null;
let existing=false,ready=false,busy=false,authAction=null,authorization=null,revealTimer,authTimer,pendingDelete=null,optionKind='categories',pendingOptionDelete=null;
const channel=typeof BroadcastChannel==='function'?new BroadcastChannel('memo-vault-updates'):null;
const content=document.getElementById('page-content');
const notesSession=new Proxy(session,{get(target,key){if(key==='generation')return target.notesGeneration;if(key==='unlocked')return target.isOpen('notes');if(key==='settings')return {...target.settings,verifyBeforeActions:target.policy.notes&&target.settings.verifyBeforeActions};const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});
const notes=createNotes({session:notesSession,root:content,changed,toast,onError:error=>{
 if(error instanceof ConflictError||!session.isOpen('notes')){lock(errorText(error));return;}
 toast(errorText(error));
}});
const platform = a => `<span class="platform-icon" style="background:${a.color};color:${a.ink}">${a.logo ? icon(a.logo) : escapeHTML(a.letter)}</span>`;
const banner=()=>`<div class="demo-banner secure-banner">${icon('shield')}<span>${session.settings.usesInitialPassword?'正在使用公开初始密码，请在设置中修改。':'账号本地与导出始终加密。'} · ${session.settings.verifyBeforeActions?'操作前再次验证已开启':'解锁后无需重复验证'}</span><button data-action="explain">安全说明 →</button></div>`;
const footer=()=>`<div class="page-footer">${icon('lock')} 把琐碎交给秩序，把空间留给自己。 <span>·</span> Memo Vault</div>`;
function stats(){return `<div class="stats">${[
 ['key','全部账号',accounts.length,'个','重要账号，一个地方收好'],
 ['star','常用账号',accounts.filter(a=>a.favorite).length,'个','日常所需，随手可得'],
 ['folder','账号分类',new Set(accounts.map(a=>a.category)).size,'类','各有归属，查找更轻松']
 ].map(([i,l,n,u,d])=>`<div class="stat"><div class="stat-label">${icon(i)}${l}</div><div class="stat-number">${n}<small>${u}</small></div><div class="stat-foot">${d}</div><div class="stat-decoration">${icon(i)}</div></div>`).join('')}</div>`;}
function render(){
 parkGate();
 accounts=session.isOpen('accounts')?session.accounts:[];
 document.getElementById('nav-count').textContent=session.isOpen('accounts')?accounts.length:'';
 document.getElementById('crumb').textContent=({notes:'日常笔记',accounts:'账号管理',overview:'空间概览',settings:'设置与备份'})[page];
 document.querySelectorAll('[data-page]').forEach(el=>{el.classList.toggle('active',el.dataset.page===page);el.setAttribute('aria-current',el.dataset.page===page?'page':'false');});
 if(['accounts','notes'].includes(page)&&!session.isOpen(page)){
  content.replaceChildren();$('gate').hidden=false;content.append($('gate'));void refreshGate();return;
 }
 if(page==='accounts') renderAccounts();
 if(page==='overview') renderOverview();
 if(page==='settings') renderSettings();
 if(page==='notes') notes.render();
}
function renderAccounts(){
 content.innerHTML=`<div class="page-heading"><div><span class="eyebrow">A PLACE FOR YOUR DIGITAL LIFE</span><h1>账号管理</h1><p>收好每一个数字身份，让生活少一点忘记。</p></div><button class="button primary" data-action="add">${icon('plus')}添加账号</button></div><div class="accounts-layout"><section class="list-panel" aria-label="账号列表"><div class="list-toolbar"><div class="list-title"><h2>我的账号<span id="list-count"></span></h2><select class="sort-select" id="sort" aria-label="账号排序"><option value="recent">最近更新 ↓</option><option value="name">名称排序 ↓</option></select></div><div class="search-box">${icon('search')}<input id="search" type="search" aria-label="搜索账号" placeholder="搜索平台、账号或备注…" value="${escapeHTML(query)}"><kbd>⌘ / Ctrl K</kbd></div><div class="filters account-filters"></div></div><div class="table-head"><span>平台 / 登录账号</span><span>分类</span><span>常用</span></div><div id="account-rows"></div><div id="account-pagination"></div><div class="list-footer"><span id="result-count"></span><span>${icon('clock')}仅本次会话</span></div></section><aside class="detail-panel" id="detail" aria-label="账号详情"></aside></div>${footer()}`;
 document.querySelector('.list-footer span:last-child').innerHTML=`${icon('shield')}本地已加密`;
 document.querySelector('.account-filters').innerHTML=[['全部','全部'],['常用','☆ 常用']].map(([key,label])=>`<button class="filter ${filter===key?'active':''}" data-filter="${escapeHTML(key)}" aria-pressed="${filter===key}">${escapeHTML(label)}</button>`).join('');
 const categorySelect=document.createElement('select');categorySelect.id='account-category-filter';categorySelect.className='account-category-filter';categorySelect.setAttribute('aria-label','按账号分类筛选');
 categorySelect.innerHTML='<option value="全部">选择分类</option>'+session.options.categories.map(name=>`<option value="${escapeHTML('category:'+name)}">${escapeHTML(name)}</option>`).join('');
 categorySelect.value=filter.startsWith('category:')?filter:'全部';categorySelect.classList.toggle('active',filter.startsWith('category:'));
 categorySelect.onchange=e=>{
  hidePassword();accountPage=1;filter=e.target.value;
  // Keep the native select mounted: replacing and refocusing it can reopen mobile pickers.
  categorySelect.classList.toggle('active',filter.startsWith('category:'));
  document.querySelectorAll('.account-filters [data-filter]').forEach(button=>{
   const active=button.dataset.filter===filter;
   button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));
  });
  renderRows();
 };
 document.querySelector('.account-filters').append(categorySelect);
 document.getElementById('sort').value=sort;
 document.getElementById('search').oninput=e=>{showPassword=false;clearTimeout(revealTimer);query=e.target.value;accountPage=1;renderRows();};
 document.getElementById('sort').onchange=e=>{hidePassword();sort=e.target.value;accountPage=1;renderRows();};
 renderRows(); renderDetail();
}
function renderRows(){
 const list=accounts.filter(a=>(filter==='全部'||(filter==='常用'?a.favorite:a.category===filter.slice(9)))&&[a.name,a.username,a.note].some(s=>s.toLowerCase().includes(query.toLowerCase()))).sort((a,b)=>sort==='name'?a.name.localeCompare(b.name,'zh-CN'):b.date.localeCompare(a.date)||b.id-a.id);
 const view=paginate(list,accountPage);accountPage=view.page;
 if(!view.items.some(a=>a.id===selected))selected=view.items[0]?.id??null;
 document.getElementById('account-pagination').innerHTML=paginationControls(view,'accounts');
 document.getElementById('list-count').textContent=`${list.length}`;
 document.getElementById('result-count').textContent=`共 ${list.length} 个账号`;
 document.getElementById('account-rows').innerHTML=list.length ? view.items.map(a=>`<button class="account-row ${a.id===selected?'selected':''}" data-account="${a.id}" aria-label="查看 ${escapeHTML(a.name)} 的详情" aria-pressed="${a.id===selected}"><span class="account-identity">${platform(a)}<span class="account-text"><strong>${escapeHTML(a.name)}</strong><small>${escapeHTML(a.username)}</small></span></span><span class="category-tag">${escapeHTML(a.category||'未分类')}</span><span class="star-icon ${a.favorite?'on':''}" aria-label="${a.favorite?'常用账号':'普通账号'}">${icon('star')}</span></button>`).join('') : `<div class="empty">${accounts.length?'没有找到对应账号':'信息库还是空的，添加你的第一个账号吧。'}<br><button class="button secondary" data-action="${accounts.length?'reset':'add'}">${accounts.length?'清除筛选':'添加账号'}</button></div>`;
 if(!list.length){selected=null;}
 renderDetail();
}
function renderDetail(){
 const a=accounts.find(a=>a.id===selected);const detail=document.getElementById('detail');if(!detail)return;
 if(!a){detail.innerHTML='<div class="empty">选择一个账号，查看详细信息。</div>';return;}
 const safeUrl=(()=>{try{const u=new URL(a.url);return ['https:','http:'].includes(u.protocol)?u.href:'';}catch{return '';}})();
 detail.innerHTML=`<div class="detail-topline"><span class="detail-heading">账号详情</span><button class="mobile-back" data-action="back">${icon('back')}账号列表</button><div class="detail-actions"><button class="icon-button" data-action="favorite" aria-label="${a.favorite?'取消常用':'设为常用'}" title="${a.favorite?'取消常用':'设为常用'}"><span class="star-icon ${a.favorite?'on':''}">${icon('star')}</span></button><button class="icon-button" data-action="edit" aria-label="编辑账号" title="编辑账号">${icon('edit')}</button><button class="icon-button delete-action" data-action="delete" aria-label="删除账号" title="删除账号">${icon('trash')}</button></div></div><div class="detail-hero">${platform(a)}<h2>${escapeHTML(a.name)}</h2><p>${safeUrl?escapeHTML(new URL(safeUrl).hostname):'自定义账号'}</p><span class="category-tag">${escapeHTML(a.category||'未分类')}</span></div><div class="detail-fields"><div class="field"><span class="field-label">登录账号</span><div class="field-value"><span>${escapeHTML(a.username)}</span><button class="icon-button" data-copy="username" aria-label="复制登录账号">${icon('copy')}</button></div></div><div class="field"><span class="field-label">登录方式</span><div class="field-value"><span>${escapeHTML(a.method||'未设置')}</span></div></div><div class="field"><span class="field-label">密码</span><div class="field-value"><span class="${a.password&&!showPassword?'password-text':''}">${a.password?(showPassword?escapeHTML(a.password):'••••••••••••'):'无需保存密码'}</span>${a.password?`<div class="field-buttons"><button class="icon-button" data-action="reveal" aria-label="${showPassword?'隐藏':'显示'}密码" aria-pressed="${showPassword}">${icon('eye')}</button><button class="icon-button" data-copy="password" aria-label="复制密码">${icon('copy')}</button></div>`:''}</div></div><div class="field"><span class="field-label">网站地址</span><div class="field-value">${safeUrl?`<a href="${escapeHTML(safeUrl)}" target="_blank" rel="noopener noreferrer">${escapeHTML(new URL(safeUrl).hostname)}${icon('arrow')}</a>`:'<span>未填写</span>'}</div></div><div class="field"><span class="field-label">备注</span><div class="note-box">${escapeHTML(a.note||'暂无备注')}</div></div></div><div class="detail-footer"><span>最近更新</span><span>${escapeHTML(a.date)}</span></div>`;
}
function renderOverview(){content.innerHTML=`<div class="page-heading"><div><span class="eyebrow">YOUR PERSONAL WORKSPACE</span><h1>生活有序，心有余地。</h1><p>这里是你的私人信息空间，收好账号，也记下生活。</p></div></div>${session.isOpen('accounts')?stats():'<p class="gate-hint">账号管理已锁定，进入时输入主密码。</p>'}<div class="settings-grid"><section class="setting-card">${icon('key')}<h2>重要的账号，随时找得到</h2><p>按平台、分类和备注快速查找数字身份。常用账号可以收藏，跨平台登录方式也能一并记录。</p><button class="button primary" data-page="accounts">进入账号管理 →</button></section><section class="setting-card">${icon('grid')}<h2>给日常留一点空间</h2><p>生活琐事、灵感和清单，都可以随手记下。</p><button class="button primary" data-page="notes" data-new-note>＋ 写一条笔记</button><div class="roadmap">${icon('key')}<span>账号管理<small>账号、登录方式、分类与备注</small></span><span>本期设计</span></div><div class="roadmap">${icon('note')}<span>日常笔记<small>连续正文、标签与自动保存</small></span><span>已可使用</span></div><div class="roadmap">${icon('card')}<span>订阅管理<small>费用、周期与到期提醒</small></span><span>后续规划</span></div><div class="roadmap">${icon('folder')}<span>个人资料<small>让常用资料各有归处</small></span><span>后续规划</span></div></section></div>${footer()}`;}
function renderSettings(){
 const policy=session.policy,authenticated=session.authenticated;
 content.innerHTML=`<div class="page-heading"><div><span class="eyebrow">MAKE IT YOUR OWN</span><h1>设置与备份</h1><p>按模块选择保护，共用一个主密码。</p></div></div><div class="settings-grid"><section class="setting-card">${icon('shield')}<h2>需要解锁的模块</h2>${[['accounts','账号管理','默认开启，账号数据始终加密。关闭后本设备会保存免解锁密钥。'],['notes','日常笔记','默认关闭，笔记直接保存在本地。开启后加密保存并验证主密码。']].map(([key,label,note])=>`<label class="setting-toggle"><span>${label}<small>${note}</small></span><input type="checkbox" role="switch" data-module-lock="${key}" ${policy[key]?'checked':''} ${ready?'':'disabled'}></label>`).join('')}<p>调整开关需要验证主密码。切后台或闲置 5 分钟后，受保护模块重新锁定，其他模块仍可使用。</p>${session.legacy?'<p class="inline-error">旧信息库需要先验证一次主密码，才能迁移笔记和启用模块设置。</p>':''}<div class="module-lock-actions"><button class="button secondary" data-action="unlock-settings">${icon('key')}${authenticated?'验证主密码':'验证主密码管理设置'}</button><button class="button secondary" data-action="lock">锁定受保护模块</button></div></section><section class="setting-card">${icon('shield')}<h2>操作前再次验证</h2><label class="setting-toggle"><span>敏感操作验证<small>账号敏感操作和受保护笔记的操作前再次验证</small></span><input id="verify-actions" type="checkbox" role="switch" ${session.settings.verifyBeforeActions?'checked':''} ${authenticated?'':'disabled'}></label><p>模块解锁与操作验证分别控制。未锁定的笔记不会要求密码；账号本地和导出始终加密；导出笔记为普通 JSON。</p><p>${authenticated?'密码显示 30 秒后自动隐藏。':'验证主密码后可查看和调整此设置。'}</p></section><section class="setting-card">${icon('key')}<h2>修改统一主密码</h2><p>账号和开启保护的笔记共用一个主密码。首次使用的初始密码为 a12345678。</p><p>新密码只输入一次，至少 8 个字符。修改后重新加密受保护数据；旧备份仍使用导出时的密码。</p><button class="button primary" data-action="change-password">修改主密码</button></section><section class="setting-card">${icon('download')}<h2>导入与导出</h2><p>导出一个 JSON 文件：账号部分加密，文档和标签为普通 JSON，可直接查看。即使笔记开启本地锁定，导出时也不加密。</p><div class="backup-actions"><button class="button primary" data-action="import">导入 JSON 备份</button><button class="button secondary" data-action="export">导出 JSON 备份</button></div><p>导入整库替换，不自动合并。支持新 JSON 和旧整库加密备份，文件最多 32 MB。保留本设备的主密码和模块锁定开关。</p></section></div>${footer()}`;
 mountOfflineSettings(content.querySelector(".settings-grid"));
}
let toastTimer,operation=0,pendingFile=null;
const $=id=>document.getElementById(id);
const masterDialog=document.createElement('dialog');
masterDialog.setAttribute('aria-labelledby','module-auth-title');
masterDialog.innerHTML='<form id="module-auth-form"><div class="dialog-heading"><h2 id="module-auth-title">验证统一主密码</h2><button class="icon-button" type="button" id="cancel-module-auth" aria-label="取消">×</button></div><p class="form-note">管理保护设置、修改主密码及整库备份前验证身份。</p><label>主密码<input type="password" id="module-auth-password" autocomplete="current-password" maxlength="1024" required></label><p class="inline-error" id="module-auth-error" role="alert"></p><button type="submit" class="button primary">验证并继续</button></form>';
document.body.append(masterDialog);
let masterRequest=null;
function cancelMaster(){if(masterRequest&&busy)session.lock();masterRequest?.resolve(false);masterRequest=null;$('module-auth-form').reset();$('module-auth-error').textContent='';masterDialog.close();}
$('cancel-module-auth').onclick=cancelMaster;masterDialog.addEventListener('cancel',cancelMaster);
async function requireMaster(work,force=false){
 if(!ready){toast('本地信息库尚未就绪。');return false;}
 if(session.authenticated&&!force){await perform(()=>work(''));return true;}
 cancelMaster();$('module-auth-error').textContent='';
 return new Promise(resolve=>{masterRequest={work,resolve,generation:session.generation};masterDialog.showModal();$('module-auth-password').focus();});
}
$('module-auth-form').onsubmit=e=>{
 e.preventDefault();const request=masterRequest;let password=$('module-auth-password').value;$('module-auth-password').value='';$('module-auth-error').textContent='';
 void perform(async()=>{
  try{
   if(!request||request.generation!==session.generation)throw new LockedError();
   const migrating=session.legacy;await session.unlock(password,'settings');if(migrating)changed();
   if(masterRequest!==request)throw new LockedError();accounts=session.accounts;autoLock.resume();
   masterDialog.close();await request.work(password);request.resolve(true);masterRequest=null;
  }catch(error){if(masterRequest===request&&!masterDialog.open)masterDialog.showModal();throw error;}
  finally{password='';}
 },'module-auth-error');
};
function parkGate(){const gate=$('gate');if(gate.parentElement!==document.body)document.body.append(gate);gate.hidden=true;}
async function reloadModules(message=''){
 ready=false;lock(message);notes.reset();session.lock();
 try{await session.load();ready=true;render();if(message)toast(message);}catch(error){content.textContent=errorText(error);}
}
function toast(message){const el=$('toast');el.textContent=message;el.classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('visible'),4000);}
function errorText(error){return error instanceof Error?error.message:'操作失败，请重试。';}
function hidePassword(){showPassword=false;clearTimeout(revealTimer);renderDetail();}
function syncButtons(){
 document.querySelectorAll('form button[type="submit"],#gate-submit,#reauth-submit,#decrypt-import').forEach(el=>el.disabled=busy);
 $('gate-submit').disabled=busy||!ready;
 $('confirm-import').disabled=busy||!pendingImport||!$('import-confirm').checked;
 if($('verify-actions'))$('verify-actions').disabled=busy;
 if($('verify-actions'))$('verify-actions').disabled=busy||!session.authenticated;
 document.querySelectorAll('[data-module-lock]').forEach(el=>el.disabled=busy||!ready);
 $('confirm-delete').disabled=busy||!pendingDelete;
 $('cancel-delete').disabled=busy;$('close-delete').disabled=busy;
 document.querySelectorAll('#options-dialog button,#options-dialog input,#options-dialog select').forEach(el=>el.disabled=busy);
}
async function perform(work,errorTarget=null){
 if(busy)return;
 busy=true;const id=++operation;syncButtons();
 try{await work();}
 catch(error){
  if(error instanceof ConflictError)void reloadModules(errorText(error));
  if(error instanceof LockedError){render();return;}
  if(errorTarget)$(errorTarget).textContent=errorText(error);else toast(errorText(error));
 }
 finally{if(operation===id){busy=false;syncButtons();}}
}
async function refreshGate(){
 try{
  $('gate-title').textContent=page==='notes'?'解锁日常笔记':'解锁账号管理';
  $('gate-note').textContent=session.legacy?'旧信息库需要验证一次主密码，迁移后笔记默认无需解锁。':'输入统一主密码进入此模块。首次使用的初始密码为 a12345678。';
  $('master-password').disabled=false;
  $('master-password').autocomplete='current-password';
  $('master-password').minLength=1;
  $('gate-submit').textContent='解锁模块';syncButtons();
 }catch(error){ready=false;$('gate-title').textContent='无法读取本地信息库';$('gate-error').textContent=errorText(error);syncButtons();}
}
function enterVault(){
 if(document.hidden){lock();return;}
 accounts=session.isOpen('accounts')?session.accounts:[];selected=accounts[0]?.id??null;existing=true;
 $('gate-form').reset();$('gate-error').textContent='';document.body.classList.remove('is-locked');
 render();autoLock.resume();navigator.storage?.persist?.().catch(()=>{});
 if(session.maintenanceWarning)toast(session.maintenanceWarning);
}
function clearAuth(){
 authAction=null;authorization=null;clearTimeout(authTimer);$('reauth-form').reset();
 $('reauth-password').disabled=false;$('reauth-submit').hidden=false;$('verified-copy').hidden=true;
 $('reauth-error').textContent='';
}
function clearImport(){
 pendingImport=null;pendingFile=null;$('import-decrypt-form').reset();$('import-password').value='';
 $('import-summary').textContent='';$('import-preview').hidden=true;$('import-decrypt-form').hidden=false;
 $('import-confirm').checked=false;$('import-error').textContent='';
}
function closeImport(){clearImport();$('import-dialog').close();}
function lock(message='已锁定。请输入主密码继续。'){
 const keepNotes=page==='notes'&&!session.policy.notes&&notes.active;
 session.lock();if(!keepNotes)notes.reset();operation++;busy=false;accounts=[];accountPage=1;query='';selected=null;editId=null;showPassword=false;clearDelete();clearOptions();
 clearTimeout(revealTimer);clearAuth();clearImport();cancelMaster();
 for(const dialog of document.querySelectorAll('dialog[open]'))if(!keepNotes||!dialog.classList.contains('notes-dialog'))dialog.close();
 $('account-form').reset();$('account-form').elements.category.replaceChildren();$('account-form').elements.method.replaceChildren();$('gate-form').reset();$('change-password-form').reset();$('change-password-error').textContent='';$('save-error').textContent='';
 $('nav-count').textContent='';$('toast').textContent='';$('toast').classList.remove('visible');
 if(!keepNotes)render();$('gate-error').textContent=message;syncButtons();
}
function changed(){channel?.postMessage('changed');}
function openForm(edit=false){
 if(!session.unlocked)return;
 hidePassword();editId=edit?selected:null;const form=$('account-form');form.reset();$('save-error').textContent='';
 $('form-title').textContent=edit?'编辑账号':'添加一个账号';
 populateAccountOptions({category:session.options.categories[0]??'',method:session.options.methods[0]??''});
 if(edit){const a=accounts.find(a=>a.id===selected);if(!a)return;for(const field of ['name','username','category','method','password','url','note'])form.elements[field].value=a[field];form.elements.favorite.checked=a.favorite;}
 refreshDialogViewport();$('account-dialog').showModal();document.querySelector('.account-form-body').scrollTop=0;
}
function refreshDialogViewport(){
 const viewport=window.visualViewport;
 document.documentElement.style.setProperty('--dialog-vp-height',`${viewport?.height??window.innerHeight}px`);
 document.documentElement.style.setProperty('--dialog-vp-top',`${viewport?.offsetTop??0}px`);
}
for(const event of ['resize','scroll'])window.visualViewport?.addEventListener(event,()=>{if($('account-dialog').open)refreshDialogViewport();},{passive:true});
window.addEventListener('resize',()=>{if($('account-dialog').open)refreshDialogViewport();},{passive:true});
function requestVerification(type){
 if(!session.unlocked||(type!=='changePassword'&&!accounts.some(a=>a.id===selected)))return;
 if(!session.settings.verifyBeforeActions){runAccountAction(type);return;}
 hidePassword();clearAuth();authAction={type,id:selected,generation:session.generation};
 $('reauth-note').textContent=({reveal:'验证后显示这一个账号的密码，30 秒后自动隐藏。',copy:'验证后再次点击“复制密码”，复制权限仅限这一次操作、30 秒内有效。',edit:'编辑可能显示现有密码，请先验证主密码。',delete:'验证后将显示删除确认，请核对要删除的账号。',changePassword:'验证当前主密码后设置新的主密码。'})[type];
 $('reauth-dialog').showModal();$('reauth-password').focus();
}
function explain(){toast('设置中选择需要解锁的模块，共用一个主密码。账号本地与导出始终加密；笔记导出为普通 JSON，本地保护单独设置。');}
function copyPassword(id){
 if(!session.unlocked||document.hidden)return;
 const account=accounts.find(a=>a.id===id);if(!account)return;
 const generation=session.generation;const result=navigator.clipboard?.writeText(account.password);
 if(!result){toast('当前浏览器不支持复制。');return;}
 result.then(()=>{if(generation===session.generation)toast('密码已复制，请注意系统剪贴板中的敏感内容。');}).catch(()=>{if(generation===session.generation)toast('浏览器未允许复制，请查看后手动输入。');});
}
function runAccountAction(type){
 if(!session.unlocked||document.hidden)return;
 if(type==='changePassword'){
  $('change-password-form').reset();$('change-password-error').textContent='';$('change-password-dialog').showModal();return;
 }
 if(type==='edit')openForm(true);
 if(type==='delete'){
  const account=accounts.find(a=>a.id===selected);if(!account)return;
  hidePassword();pendingDelete={id:account.id,generation:session.generation};
  $('delete-account-name').textContent=account.name;
  $('delete-account-username').textContent=account.username;
  $('delete-error').textContent='';syncButtons();$('delete-dialog').showModal();
 }
 if(type==='copy')copyPassword(selected);
 if(type==='reveal'){showPassword=true;renderDetail();revealTimer=setTimeout(hidePassword,30000);}
}
async function exportFile(){
 if(!session.authenticated)throw new LockedError();
 await notes.flush();const generation=session.generation;const text=await session.exportFile();
 if(generation!==session.generation||document.hidden)throw new LockedError();
 const blob=new Blob([text],{type:'application/json'});const url=URL.createObjectURL(blob);const link=document.createElement('a');
 link.href=url;link.download=`memo-vault-backup-${new Date().toISOString().replace(/[:.]/g,'-')}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 toast('已发起 JSON 备份导出：账号已加密，笔记为普通 JSON。');
}
$('gate-form').onsubmit=e=>{
 e.preventDefault();let password=$('master-password').value;
 $('gate-form').reset();$('gate-error').textContent='';
 void perform(async()=>{
  if(!ready)throw new Error('本地存储尚未就绪。');
  try{const migrating=session.legacy;await session.unlock(password,page);if(migrating)changed();}
  finally{password='';}
  enterVault();
 },'gate-error');
};
$('reauth-form').onsubmit=e=>{
 e.preventDefault();let password=$('reauth-password').value;$('reauth-password').value='';$('reauth-error').textContent='';
 const requested=authAction;
 void perform(async()=>{
  if(!requested||requested.generation!==session.generation)throw new LockedError();
  try{await session.verify(password);}finally{password='';}
  if(authAction!==requested||!session.unlocked||document.hidden)throw new LockedError();
  if(requested.type==='copy'){
   authorization={id:requested.id,generation:session.generation,expires:Date.now()+30000};
   $('reauth-password').disabled=true;$('reauth-submit').hidden=true;$('verified-copy').hidden=false;
   $('verified-copy').focus();authTimer=setTimeout(()=>{clearAuth();$('reauth-dialog').close();toast('复制授权已过期，请重新验证。');},30000);
  }else{
   $('reauth-dialog').close();clearAuth();
   if(requested.type!=='changePassword'&&selected!==requested.id)return;
   runAccountAction(requested.type);
  }
 },'reauth-error');
};
$('verified-copy').onclick=()=>{
 const grant=authorization;authorization=null;
 if(!grant||grant.generation!==session.generation||Date.now()>=grant.expires||!session.unlocked||document.hidden){clearAuth();$('reauth-dialog').close();toast('授权已失效，请重新验证。');return;}
 copyPassword(grant.id);
 clearAuth();$('reauth-dialog').close();
};
$('cancel-reauth').onclick=()=>{clearAuth();$('reauth-dialog').close();};
$('reauth-dialog').addEventListener('cancel',clearAuth);
document.addEventListener('change',e=>{
 const module=e.target.dataset.moduleLock;
 if(module){
  const value=e.target.checked;e.target.checked=session.policy[module];
  if(busy)return;
  void requireMaster(async password=>{await session.setModuleLock(module,value,password);changed();render();toast('模块锁定设置已保存。');},true);return;
 }
 if(e.target.id!=='verify-actions')return;
 const value=e.target.checked;
 if(busy||!session.authenticated){e.target.checked=session.settings.verifyBeforeActions;return;}
 hidePassword();clearAuth();
 void perform(async()=>{await session.updateSettings(value);changed();renderSettings();toast(value?'已开启操作前再次验证。':'已关闭重复验证，账号仍然加密，笔记按本地锁定设置保存。');}).then(()=>{if(session.unlocked&&page==='settings')renderSettings();});
});
$('change-password-form').onsubmit=e=>{
 e.preventDefault();let password=$('new-master-password').value;$('new-master-password').value='';$('change-password-error').textContent='';
 void perform(async()=>{
  try{await session.changePassword(password);}finally{password='';}
  hidePassword();clearAuth();changed();$('change-password-form').reset();$('change-password-dialog').close();render();toast('主密码已修改，请用新密码重新导出 JSON 备份。');
 },'change-password-error');
};
$('cancel-change-password').onclick=()=>{$('change-password-form').reset();$('change-password-dialog').close();};
$('change-password-dialog').addEventListener('cancel',()=>{$('change-password-form').reset();});
function clearDelete(){pendingDelete=null;$('delete-account-name').textContent='';$('delete-account-username').textContent='';$('delete-error').textContent='';}
const cancelDelete=()=>{clearDelete();$('delete-dialog').close();};
$('cancel-delete').onclick=cancelDelete;
$('close-delete').onclick=cancelDelete;
$('delete-dialog').addEventListener('cancel',e=>{if(busy)e.preventDefault();else clearDelete();});
function populateAccountOptions(preferred={}){
 const form=$('account-form');
 for(const [kind,field,empty] of [['categories','category','未分类'],['methods','method','未设置']]){
  const value=Object.hasOwn(preferred,field)?preferred[field]:form.elements[field].value;
  const names=session.options[kind];form.elements[field].innerHTML=`<option value="">${empty}</option>`+names.map(name=>`<option value="${escapeHTML(name)}">${escapeHTML(name)}</option>`).join('');
  form.elements[field].value=names.includes(value)?value:'';
 }
}
function clearOptions(){pendingOptionDelete=null;$('option-add-form').reset();$('option-list').replaceChildren();$('option-delete-panel').hidden=true;$('option-delete-description').textContent='';$('option-error').textContent='';}
function renderOptionManager(){
 if(!session.unlocked)return;
 const field=optionKind==='categories'?'category':'method';const names=session.options[optionKind];
 $('options-title').textContent=optionKind==='categories'?'管理所属分类':'管理登录方式';
 $('option-kind-categories').classList.toggle('active',optionKind==='categories');$('option-kind-methods').classList.toggle('active',optionKind==='methods');
 $('option-list').innerHTML=names.length?names.map((name,index)=>`<div class="option-row"><span>${escapeHTML(name)}<small>${accounts.filter(a=>a[field]===name).length} 个账号使用</small></span><button class="icon-button delete-action" type="button" data-remove-option="${index}" aria-label="删除${escapeHTML(name)}">${icon('trash')}</button></div>`).join(''):'<p class="gate-hint">暂无选项，可以添加新的。</p>';
 pendingOptionDelete=null;$('option-delete-panel').hidden=true;syncButtons();
}
function openOptionManager(kind){
 if(!session.unlocked||busy)return;optionKind=kind;clearOptions();renderOptionManager();$('options-dialog').showModal();
}
function refreshOptions(preferred={}){
 accounts=session.accounts;
 if(filter.startsWith('category:')&&!session.options.categories.includes(filter.slice(9)))filter='全部';
 render();populateAccountOptions(preferred);renderOptionManager();changed();
}
$('option-add-form').onsubmit=e=>{
 e.preventDefault();const name=$('new-option-name').value.trim(),kind=optionKind;
 $('option-error').textContent='';
 void perform(async()=>{await session.addOption(kind,name);$('option-add-form').reset();refreshOptions({[kind==='categories'?'category':'method']:name});toast('已添加选项。');},'option-error');
};
document.addEventListener('click',async e=>{
 const manage=e.target.closest('[data-manage-options]');if(manage){openOptionManager(manage.dataset.manageOptions);return;}
 const kind=e.target.closest('[data-option-kind]');if(kind&&!busy){optionKind=kind.dataset.optionKind;renderOptionManager();$('option-error').textContent='';return;}
 const remove=e.target.closest('[data-remove-option]');if(!remove||busy||!session.unlocked)return;
 const name=session.options[optionKind][Number(remove.dataset.removeOption)];if(name===undefined)return;
 const field=optionKind==='categories'?'category':'method';const count=accounts.filter(a=>a[field]===name).length;
 if(count){pendingOptionDelete=null;$('option-delete-panel').hidden=true;$('option-error').textContent=`已有 ${count} 个账号使用“${name}”，不可删除。请先修改相关账号。`;return;}
 pendingOptionDelete={kind:optionKind,name,generation:session.generation};
 $('option-delete-description').textContent=`确认删除“${name}”？删除后将不再出现在下拉选项中。`;
 $('option-delete-panel').hidden=false;$('option-error').textContent='';
});
$('cancel-option-delete').onclick=()=>{pendingOptionDelete=null;$('option-delete-panel').hidden=true;};
$('confirm-option-delete').onclick=()=>{
 const target=pendingOptionDelete;if(!target||busy)return;
 const field=target.kind==='categories'?'category':'method';
 const preferred=$('account-form').elements[field].value===target.name?{[field]:''}:{};
 $('option-error').textContent='';
 void perform(async()=>{if(target.generation!==session.generation)throw new LockedError();await session.removeOption(target.kind,target.name);refreshOptions(preferred);toast('已删除选项。');},'option-error');
};
$('close-options').onclick=()=>{clearOptions();$('options-dialog').close();};
$('options-dialog').addEventListener('cancel',e=>{if(busy)e.preventDefault();else clearOptions();});
$('confirm-delete').onclick=()=>void perform(async()=>{
 const target=pendingDelete;
 if(!target||target.generation!==session.generation||!session.unlocked)throw new LockedError();
 await session.deleteAccount(target.id);
 accounts=session.accounts;selected=null;hidePassword();clearDelete();$('delete-dialog').close();changed();render();toast('账号已删除，已加密保存。');
},'delete-error');

document.addEventListener('click',async e=>{
 const action=e.target.closest('[data-action]')?.dataset.action;
 if(busy&&action!=='lock')return;
 const nav=e.target.closest('[data-page]');if(nav){
  if(!await notes.leave())return;
  hidePassword();page=nav.dataset.page;render();if(nav.hasAttribute('data-new-note')&&session.isOpen('notes'))void notes.new();window.scrollTo(0,0);return;
 }
 if(action==='lock'){lock();return;}
 if(action==='explain'){explain();return;}
 if(action==='unlock-settings'){void requireMaster(async()=>{render();},true);return;}
 if(action==='change-password'){void requireMaster(async()=>runAccountAction('changePassword'));return;}
 if(action==='export'){void requireMaster(exportFile);return;}
 if(action==='import'){
  if(!ready)return;
  if(notes.active&&!await notes.leave())return;
  void requireMaster(async()=>{hidePassword();$('import-file').click();});return;
 }
 if(!session.unlocked)return;
 const pager=e.target.closest('[data-list-kind="accounts"][data-list-page]');if(pager){hidePassword();accountPage=Number(pager.dataset.listPage);renderRows();document.querySelector('.accounts-layout .list-toolbar').scrollIntoView({block:'start'});return;}
 const f=e.target.closest('[data-filter]');if(f){hidePassword();filter=f.dataset.filter;accountPage=1;renderAccounts();return;}
 const row=e.target.closest('[data-account]');if(row){hidePassword();selected=Number(row.dataset.account);renderRows();document.querySelector('.accounts-layout').classList.add('show-detail');window.scrollTo(0,0);return;}
 const copy=e.target.closest('[data-copy]');if(copy){
  if(copy.dataset.copy==='password')requestVerification('copy');
  else navigator.clipboard?.writeText(accounts.find(a=>a.id===selected).username).then(()=>toast('登录账号已复制。')).catch(()=>toast('浏览器未允许复制，请手动选择。'));
  return;
 }
 if(action==='add')openForm();
 if(action==='edit')requestVerification('edit');
 if(action==='delete')requestVerification('delete');
 if(action==='change-password')requestVerification('changePassword');
 if(action==='explain')explain();
 if(action==='reveal'){if(showPassword)hidePassword();else requestVerification('reveal');}
 if(action==='back'){hidePassword();document.querySelector('.accounts-layout').classList.remove('show-detail');}
 if(action==='reset'){accountPage=1;hidePassword();filter='全部';query='';renderAccounts();}
 if(action==='favorite')void perform(async()=>{
  hidePassword();const next=accounts.map(a=>a.id===selected?{...a,favorite:!a.favorite}:a);
  const mobile=document.querySelector('.accounts-layout').classList.contains('show-detail');
  await session.save(next);accounts=session.accounts;changed();renderAccounts();if(mobile)document.querySelector('.accounts-layout').classList.add('show-detail');
 });
 if(action==='lock')lock();
 if(action==='export')void perform(exportFile);
});
$('import-file').onchange=async e=>{
 const file=e.target.files[0];e.target.value='';if(!file)return;
 const generation=session.generation;
 try{
  if(file.size>MAX_BACKUP_BYTES)throw new Error('备份文件不能超过 32 MB。');
  const parsed=parseBackupFile(await file.text());if(generation!==session.generation)return;
  clearImport();pendingFile=parsed;$('import-dialog').showModal();
 }catch(error){toast(errorText(error));}
};
$('import-decrypt-form').onsubmit=e=>{
 e.preventDefault();let password=$('import-password').value;$('import-password').value='';$('import-error').textContent='';
 const file=pendingFile;
 void perform(async()=>{
  if(!file)throw new Error('请重新选择备份 JSON。');
  let staged;try{staged=await session.stageImport(file,password);}finally{password='';}
  if(file!==pendingFile||document.hidden)throw new LockedError();
  pendingImport=staged;$('import-decrypt-form').hidden=true;$('import-preview').hidden=false;
  $('import-summary').textContent=`即将导入 ${staged.accounts.length} 个账号。${session.unlocked?`替换本设备当前 ${accounts.length} 个账号。`:'在本设备创建信息库。'}`;
  $('import-summary').textContent+=` 文档：${staged.noteData.notes.length} 篇。${staged.schemaVersion===1?'这是旧版备份，不含文档。':''}${staged.noteData.notes.some(n=>n.deletedAt||n.archivedAt)?'旧归档和回收站内容将恢复为普通文档。':''} 将替换本机全部文档，不会合并。`;
  $('import-policy').textContent=session.unlocked?'整库替换，不自动合并。当前设备主密码保持不变；文件仍使用导出时的主密码。':'导入后使用这份文件的主密码解锁。不会更改原设备数据。';
  $('export-before-import').hidden=!session.unlocked;$('import-confirm').checked=false;syncButtons();
 },'import-error');
};
$('close-import').onclick=closeImport;$('import-dialog').addEventListener('cancel',clearImport);
$('import-confirm').onchange=syncButtons;
$('confirm-import').onclick=()=>void perform(async()=>{
 if(!pendingImport||!$('import-confirm').checked)return;
 const staged=pendingImport;await session.importPrepared(staged);changed();closeImport();
 page='accounts';filter='全部';query='';accountPage=1;enterVault();toast('备份已导入并保存到本设备。');
},'import-error');
$('account-form').onsubmit=e=>{
 e.preventDefault();if(busy||!session.unlocked)return;
 const data=new FormData(e.target);const prior=accounts.find(a=>a.id===editId);
 const record={id:editId||Math.max(Date.now(),...accounts.map(a=>a.id+1)),color:prior?.color||'#efefff',ink:prior?.ink||'#7a77ca',letter:prior?.letter||String(data.get('name')).slice(0,1).toUpperCase(),...(prior?.logo?{logo:prior.logo}:{}),
  ...Object.fromEntries(['name','username','category','method','password','url','note'].map(k=>[k,k==='password'?String(data.get(k)):String(data.get(k)).trim()])),favorite:data.has('favorite'),date:new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai'}).format(new Date()).replaceAll('-','.')};
 $('save-error').textContent='';
 void perform(async()=>{
  const next=editId?accounts.map(a=>a.id===editId?record:a):[...accounts,record];await session.save(next);
  accounts=session.accounts;selected=record.id;filter='全部';query='';accountPage=Math.floor([...accounts].sort((a,b)=>sort==='name'?a.name.localeCompare(b.name,'zh-CN'):b.date.localeCompare(a.date)||b.id-a.id).findIndex(a=>a.id===record.id)/10)+1;page='accounts';$('account-form').reset();$('account-dialog').close();changed();render();toast('已加密保存到本设备。');
 },'save-error');
};
const closeAccount=()=>{$('account-form').reset();$('account-dialog').close();editId=null;};
for(const id of ['close-form','cancel-form'])$(id).onclick=closeAccount;
$('account-dialog').addEventListener('cancel',()=>{$('account-form').reset();editId=null;});
$('help').onclick=explain;
const autoLock=installAutoLock({document,window,lock,isUnlocked:()=>session.hasProtectedAccess});
channel?.addEventListener('message',()=>void reloadModules('另一页面已修改信息库，已刷新本地数据并锁定受保护模块。'));
document.addEventListener('keydown',async e=>{
 if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='k'){e.preventDefault();if(document.querySelector('dialog[open]'))return;if(page==='notes'&&session.isOpen('notes')){if(!await notes.leave())return;render();document.getElementById('note-search').focus();return;}if(page!=='accounts'){page='accounts';render();}$('search')?.focus();}
});
hydrateIcons();parkGate();
void (async()=>{try{
 if(!globalThis.isSecureContext||!crypto.subtle)throw Error('需要 HTTPS 或 localhost 才能使用加密功能。');
 await session.load();ready=true;existing=true;document.body.classList.remove('is-locked');render();navigator.storage?.persist?.().catch(()=>{});
}catch(error){document.body.classList.remove('is-locked');content.textContent=errorText(error);}})();
