import {VaultSession,IndexedVaultStore,parseEncryptedFile,MAX_FILE_BYTES,ConflictError,LockedError,DEFAULT_PASSWORD} from './vault.mjs';
import {installAutoLock} from './lifecycle.mjs';
const paths = {
 trash:'<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>',
 grid:'<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
 key:'<circle cx="8" cy="8" r="5"/><path d="m11.5 11.5 9 9m-3-3 3-3m-6 0 3-3"/>',
 note:'<rect x="4" y="3" width="16" height="18" rx="3"/><path d="M8 8h8M8 12h8M8 16h5"/>',
 card:'<rect x="2" y="5" width="20" height="14" rx="3"/><path d="M2 10h20M6 15h4"/>',
 folder:'<path d="M3 7V5a2 2 0 0 1 2-2h5l3 3h6a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/>',
 shield:'<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Z"/><path d="m8 12 3 3 5-6"/>',
 settings:'<path d="m9 3-1 3-3 1-1 3 2 2-2 3 2 3h3l2 3 3-1 1-3 3-1 1-3-2-2 1-3-2-2h-3l-2-3Z"/><circle cx="12" cy="12" r="3"/>',
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
let accounts=[];
const session=new VaultSession(new IndexedVaultStore());
let page='accounts',filter='全部',query='',selected=null,sort='recent',editId=null,showPassword=false,pendingImport=null;
let existing=false,ready=false,busy=false,authAction=null,authorization=null,revealTimer,authTimer,pendingDelete=null,optionKind='categories',pendingOptionDelete=null;
const channel=typeof BroadcastChannel==='function'?new BroadcastChannel('memo-vault-updates'):null;
const content=document.getElementById('page-content');
const platform = a => `<span class="platform-icon" style="background:${a.color};color:${a.ink}">${a.logo ? icon(a.logo) : escapeHTML(a.letter)}</span>`;
const banner=()=>`<div class="demo-banner secure-banner">${icon('shield')}<span>${session.settings.usesInitialPassword?'正在使用公开初始密码，请在设置中修改。':'本地与导出文件始终加密。'} · ${session.settings.verifyBeforeActions?'操作前再次验证已开启':'解锁后无需重复验证'}</span><button data-action="explain">安全说明 →</button></div>`;
const footer=()=>`<div class="page-footer">${icon('lock')} 把琐碎交给秩序，把空间留给自己。 <span>·</span> Memo Vault</div>`;
function stats(){return `<div class="stats">${[
 ['key','全部账号',accounts.length,'个','重要账号，一个地方收好'],
 ['star','常用账号',accounts.filter(a=>a.favorite).length,'个','日常所需，随手可得'],
 ['folder','账号分类',new Set(accounts.map(a=>a.category)).size,'类','各有归属，查找更轻松']
 ].map(([i,l,n,u,d])=>`<div class="stat"><div class="stat-label">${icon(i)}${l}</div><div class="stat-number">${n}<small>${u}</small></div><div class="stat-foot">${d}</div><div class="stat-decoration">${icon(i)}</div></div>`).join('')}</div>`;}
function render(){
 if(!session.unlocked)return;
 document.getElementById('nav-count').textContent=accounts.length;
 document.getElementById('crumb').textContent=({accounts:'账号管理',overview:'空间概览',settings:'设置与备份'})[page];
 document.querySelectorAll('[data-page]').forEach(el=>{el.classList.toggle('active',el.dataset.page===page);el.setAttribute('aria-current',el.dataset.page===page?'page':'false');});
 if(page==='accounts') renderAccounts();
 if(page==='overview') renderOverview();
 if(page==='settings') renderSettings();
}
function renderAccounts(){
 content.innerHTML=`<div class="page-heading"><div><span class="eyebrow">A PLACE FOR YOUR DIGITAL LIFE</span><h1>账号管理<span style="color:#a4a4c9">.</span></h1><p>收好每一个数字身份，让生活少一点忘记。</p></div><button class="button primary" data-action="add">${icon('plus')}添加账号</button></div><div class="accounts-layout"><section class="list-panel" aria-label="账号列表"><div class="list-toolbar"><div class="list-title"><h2>我的账号<span id="list-count"></span></h2><select class="sort-select" id="sort" aria-label="账号排序"><option value="recent">最近更新 ↓</option><option value="name">名称排序 ↓</option></select></div><div class="search-box">${icon('search')}<input id="search" type="search" aria-label="搜索账号" placeholder="搜索平台、账号或备注…" value="${escapeHTML(query)}"><kbd>⌘ / Ctrl K</kbd></div><div class="filters">${['全部','常用','开发工具','日常生活','工作效率','社交娱乐'].map(f=>`<button class="filter ${filter===f?'active':''}" data-filter="${f}" aria-pressed="${filter===f}">${f==='常用'?'☆ ':''}${f}</button>`).join('')}</div></div><div class="table-head"><span>平台 / 登录账号</span><span>分类</span><span>常用</span></div><div id="account-rows"></div><div class="list-footer"><span id="result-count"></span><span>${icon('clock')}仅本次会话</span></div></section><aside class="detail-panel" id="detail" aria-label="账号详情"></aside></div>${footer()}`;
 document.querySelector('.list-footer span:last-child').innerHTML=`${icon('shield')}本地已加密`;
 document.querySelector('.filters').innerHTML=[['全部','全部'],['常用','☆ 常用'],...session.options.categories.map(name=>[`category:${name}`,name])].map(([key,label])=>`<button class="filter ${filter===key?'active':''}" data-filter="${escapeHTML(key)}" aria-pressed="${filter===key}">${escapeHTML(label)}</button>`).join('');
 document.getElementById('sort').value=sort;
 document.getElementById('search').oninput=e=>{showPassword=false;clearTimeout(revealTimer);query=e.target.value;renderRows();};
 document.getElementById('sort').onchange=e=>{hidePassword();sort=e.target.value;renderRows();};
 renderRows(); renderDetail();
}
function renderRows(){
 const list=accounts.filter(a=>(filter==='全部'||(filter==='常用'?a.favorite:a.category===filter.slice(9)))&&[a.name,a.username,a.note].some(s=>s.toLowerCase().includes(query.toLowerCase()))).sort((a,b)=>sort==='name'?a.name.localeCompare(b.name,'zh-CN'):b.date.localeCompare(a.date)||b.id-a.id);
 document.getElementById('list-count').textContent=`${list.length}`;
 document.getElementById('result-count').textContent=`共 ${list.length} 个账号`;
 document.getElementById('account-rows').innerHTML=list.length ? list.map(a=>`<button class="account-row ${a.id===selected?'selected':''}" data-account="${a.id}" aria-label="查看 ${escapeHTML(a.name)} 的详情" aria-pressed="${a.id===selected}"><span class="account-identity">${platform(a)}<span class="account-text"><strong>${escapeHTML(a.name)}</strong><small>${escapeHTML(a.username)}</small></span></span><span class="category-tag">${escapeHTML(a.category||'未分类')}</span><span class="star-icon ${a.favorite?'on':''}" aria-label="${a.favorite?'常用账号':'普通账号'}">${icon('star')}</span></button>`).join('') : `<div class="empty">${accounts.length?'没有找到对应账号':'信息库还是空的，添加你的第一个账号吧。'}<br><button class="button secondary" data-action="${accounts.length?'reset':'add'}">${accounts.length?'清除筛选':'添加账号'}</button></div>`;
 if(list.length&&!list.some(a=>a.id===selected)){selected=list[0].id;renderRows();return;}
 if(!list.length){selected=null;}
 renderDetail();
}
function renderDetail(){
 const a=accounts.find(a=>a.id===selected);const detail=document.getElementById('detail');if(!detail)return;
 if(!a){detail.innerHTML='<div class="empty">选择一个账号，查看详细信息。</div>';return;}
 const safeUrl=(()=>{try{const u=new URL(a.url);return ['https:','http:'].includes(u.protocol)?u.href:'';}catch{return '';}})();
 detail.innerHTML=`<div class="detail-topline"><span class="detail-heading">账号详情</span><button class="mobile-back" data-action="back">${icon('back')}账号列表</button><div class="detail-actions"><button class="icon-button" data-action="favorite" aria-label="${a.favorite?'取消常用':'设为常用'}" title="${a.favorite?'取消常用':'设为常用'}"><span class="star-icon ${a.favorite?'on':''}">${icon('star')}</span></button><button class="icon-button" data-action="edit" aria-label="编辑账号" title="编辑账号">${icon('edit')}</button><button class="icon-button delete-action" data-action="delete" aria-label="删除账号" title="删除账号">${icon('trash')}</button></div></div><div class="detail-hero">${platform(a)}<h2>${escapeHTML(a.name)}</h2><p>${safeUrl?escapeHTML(new URL(safeUrl).hostname):'自定义账号'}</p><span class="category-tag">${escapeHTML(a.category||'未分类')}</span></div><div class="detail-fields"><div class="field"><span class="field-label">登录账号</span><div class="field-value"><span>${escapeHTML(a.username)}</span><button class="icon-button" data-copy="username" aria-label="复制登录账号">${icon('copy')}</button></div></div><div class="field"><span class="field-label">登录方式</span><div class="field-value"><span>${escapeHTML(a.method||'未设置')}</span></div></div><div class="field"><span class="field-label">密码</span><div class="field-value"><span class="${a.password&&!showPassword?'password-text':''}">${a.password?(showPassword?escapeHTML(a.password):'••••••••••••'):'无需保存密码'}</span>${a.password?`<div class="field-buttons"><button class="icon-button" data-action="reveal" aria-label="${showPassword?'隐藏':'显示'}密码" aria-pressed="${showPassword}">${icon('eye')}</button><button class="icon-button" data-copy="password" aria-label="复制密码">${icon('copy')}</button></div>`:''}</div></div><div class="field"><span class="field-label">网站地址</span><div class="field-value">${safeUrl?`<a href="${escapeHTML(safeUrl)}" target="_blank" rel="noopener noreferrer">${escapeHTML(new URL(safeUrl).hostname)}${icon('arrow')}</a>`:'<span>未填写</span>'}</div></div><div class="field"><span class="field-label">备注</span><div class="note-box">${escapeHTML(a.note||'暂无备注')}</div></div></div><div class="detail-footer"><span>最近更新</span><span>${escapeHTML(a.date)}</span></div>`;
}
function renderOverview(){content.innerHTML=`<div class="page-heading"><div><span class="eyebrow">YOUR PERSONAL WORKSPACE</span><h1>生活有序，心有余地。</h1><p>这里是你的私人信息空间，从收好账号开始。</p></div></div>${banner()}${stats()}<div class="settings-grid"><section class="setting-card">${icon('key')}<h2>重要的账号，随时找得到</h2><p>按平台、分类和备注快速查找数字身份。常用账号可以收藏，跨平台登录方式也能一并记录。</p><button class="button primary" data-page="accounts">进入账号管理 →</button></section><section class="setting-card">${icon('grid')}<h2>留出位置，慢慢生长</h2><div class="roadmap">${icon('key')}<span>账号管理<small>账号、登录方式、分类与备注</small></span><span>本期设计</span></div><div class="roadmap">${icon('note')}<span>安全笔记<small>值得妥善收好的私人记录</small></span><span>后续规划</span></div><div class="roadmap">${icon('card')}<span>订阅管理<small>费用、周期与到期提醒</small></span><span>后续规划</span></div><div class="roadmap">${icon('folder')}<span>个人资料<small>让常用资料各有归处</small></span><span>后续规划</span></div></section></div>${footer()}`;}
function renderSettings(){content.innerHTML=`<div class="page-heading"><div><span class="eyebrow">MAKE IT YOUR OWN</span><h1>设置与备份</h1><p>程序在线发布，数据随你迁移。</p></div></div>${banner()}<div class="settings-grid"><section class="setting-card">${icon('shield')}<h2>按你的习惯，选择验证方式</h2><label class="setting-toggle"><span>操作前再次验证<small>查看、复制、编辑及删除账号时验证主密码</small></span><input id="verify-actions" type="checkbox" role="switch" ${session.settings.verifyBeforeActions?'checked':''}></label><p>${session.settings.verifyBeforeActions?'已开启：每次敏感操作前重新验证。':'已关闭：解锁一次后可以直接操作。'}本地数据和导出文件始终加密，开关不会关闭加密。</p><p>切后台立即锁定，闲置 5 分钟自动锁定。显示出的密码 30 秒后隐藏。</p><button class="button secondary" data-action="lock">${icon('lock')}立即锁定</button></section><section class="setting-card">${icon('key')}<h2>修改主密码</h2><p>${session.settings.usesInitialPassword?'当前使用公开初始密码 a12345678，请在录入个人信息前修改。':'已设置个人主密码。公开初始密码不能解锁已修改的信息库。'}</p><p>新主密码只输入一次，至少 8 个字符。修改后本设备的数据会重新加密。以前导出的文件仍使用当时的密码，请重新导出备份。</p><button class="button primary" data-action="change-password">${icon('key')}修改主密码</button></section><section class="setting-card">${icon('download')}<h2>导出加密文件，换设备继续</h2><p>电脑导出 → 传到手机“文件” → 手机导入并输入文件的主密码。无论是否开启操作验证，导出的都只有密文。</p><div class="backup-actions"><button class="button primary" data-action="import">${icon('folder')}导入加密数据</button><button class="button secondary" data-action="export">${icon('download')}导出加密数据</button></div><p>导入会预览数量并确认整库替换，不自动合并或同步。已有库保留本设备主密码，新设备使用文件主密码；操作验证设置随文件迁移。</p></section><section class="setting-card">${icon('note')}<h2>你的数据，由你保管</h2><p>发布到 GitHub Pages 的只有程序和公开的初始密码，不附带个人账号数据。首次为空库，测试数据单独导入。</p><p>网站数据被清理后，需要备份文件及其密码恢复。尚未发布 Pages 或启用离线安装。</p><button class="button secondary" data-action="explain">查看安全说明</button></section></div>${footer()}`;}

let toastTimer,operation=0,pendingFile=null;
const $=id=>document.getElementById(id);
function toast(message){const el=$('toast');el.textContent=message;el.classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('visible'),4000);}
function errorText(error){return error instanceof Error?error.message:'操作失败，请重试。';}
function hidePassword(){showPassword=false;clearTimeout(revealTimer);renderDetail();}
function syncButtons(){
 document.querySelectorAll('form button[type="submit"],#gate-submit,#reauth-submit,#decrypt-import').forEach(el=>el.disabled=busy);
 $('gate-submit').disabled=busy||!ready;
 $('gate-import').disabled=busy||!ready||existing;
 $('confirm-import').disabled=busy||!pendingImport||!$('import-confirm').checked;
 if($('verify-actions'))$('verify-actions').disabled=busy;
 $('confirm-delete').disabled=busy||!pendingDelete;
 $('cancel-delete').disabled=busy;$('close-delete').disabled=busy;
 document.querySelectorAll('#options-dialog button,#options-dialog input,#options-dialog select').forEach(el=>el.disabled=busy);
}
async function perform(work,errorTarget=null){
 if(busy)return;
 busy=true;const id=++operation;syncButtons();
 try{await work();}
 catch(error){
  if(error instanceof ConflictError||(!session.unlocked&&document.body.classList.contains('is-locked')===false))lock(errorText(error));
  if(error instanceof LockedError){if(!session.unlocked)void refreshGate();return;}
  if(errorTarget)$(errorTarget).textContent=errorText(error);else toast(errorText(error));
 }
 finally{if(operation===id){busy=false;syncButtons();}}
}
async function refreshGate(){
 const generation=session.generation;
 try{
  if(!globalThis.isSecureContext||!crypto.subtle)throw new Error('需要 HTTPS 或 localhost 才能使用加密功能。');
  const found=await session.exists();if(generation!==session.generation)return;
  existing=found;ready=true;
  $('gate-title').textContent='解锁你的信息库';
  $('gate-note').textContent=existing?'输入当前主密码，解锁本设备的加密数据。':'首次使用的初始密码为 a12345678，进入后可在设置中修改。';
  $('master-password').disabled=false;
  $('master-password').autocomplete='current-password';
  $('master-password').minLength=1;
  $('gate-submit').textContent='解锁信息库';syncButtons();
 }catch(error){ready=false;$('gate-title').textContent='无法读取本地信息库';$('gate-error').textContent=errorText(error);syncButtons();}
}
function enterVault(){
 if(document.hidden){lock();return;}
 accounts=session.accounts;selected=accounts[0]?.id??null;existing=true;
 $('gate-form').reset();$('gate-error').textContent='';document.body.classList.remove('is-locked');
 render();autoLock.resume();navigator.storage?.persist?.().catch(()=>{});
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
 session.lock();operation++;busy=false;accounts=[];query='';selected=null;editId=null;showPassword=false;clearDelete();clearOptions();
 clearTimeout(revealTimer);clearAuth();clearImport();
 for(const dialog of document.querySelectorAll('dialog[open]'))dialog.close();
 $('account-form').reset();$('account-form').elements.category.replaceChildren();$('account-form').elements.method.replaceChildren();$('gate-form').reset();$('change-password-form').reset();$('change-password-error').textContent='';$('save-error').textContent='';
 content.replaceChildren();$('nav-count').textContent='';$('toast').textContent='';$('toast').classList.remove('visible');
 document.body.classList.add('is-locked');$('gate-error').textContent=message;
 ready=false;syncButtons();void refreshGate();
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
function explain(){toast('操作验证可在设置中开关；本地和导出文件始终加密；切后台或闲置 5 分钟自动锁定。');}
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
 if(!session.unlocked)throw new LockedError();
 const generation=session.generation;const text=await session.exportFile();
 if(generation!==session.generation||document.hidden)throw new LockedError();
 const blob=new Blob([text],{type:'application/json'});const url=URL.createObjectURL(blob);const link=document.createElement('a');
 link.href=url;link.download=`memo-vault-encrypted-${new Date().toISOString().replace(/[:.]/g,'-')}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 toast('已发起加密文件导出，请妥善保存文件与主密码。');
}
$('gate-form').onsubmit=e=>{
 e.preventDefault();let password=$('master-password').value;
 $('gate-form').reset();$('gate-error').textContent='';
 void perform(async()=>{
  if(!ready)throw new Error('本地存储尚未就绪。');
  if(!existing&&password!==DEFAULT_PASSWORD)throw new Error('首次使用请输入初始密码 a12345678，进入后可修改。');
  try{if(existing)await session.unlock(password);else{await session.create(password);changed();}}
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
 if(e.target.id!=='verify-actions')return;
 const value=e.target.checked;
 if(busy||!session.unlocked){e.target.checked=session.unlocked&&session.settings.verifyBeforeActions;return;}
 hidePassword();clearAuth();
 void perform(async()=>{await session.updateSettings(value);changed();renderSettings();toast(value?'已开启操作前再次验证。':'已关闭重复验证，数据与导出仍然加密。');}).then(()=>{if(session.unlocked&&page==='settings')renderSettings();});
});
$('change-password-form').onsubmit=e=>{
 e.preventDefault();let password=$('new-master-password').value;$('new-master-password').value='';$('change-password-error').textContent='';
 void perform(async()=>{
  try{await session.changePassword(password);}finally{password='';}
  hidePassword();clearAuth();changed();$('change-password-form').reset();$('change-password-dialog').close();render();toast('主密码已修改，请用新密码重新导出加密备份。');
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
document.addEventListener('click',e=>{
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

document.addEventListener('click',e=>{
 const action=e.target.closest('[data-action]')?.dataset.action;
 if(action==='import'){
  if(busy||!ready)return;
  if(existing&&!session.unlocked){toast('请先解锁当前信息库，再导入替换。');return;}
  hidePassword();$('import-file').click();return;
 }
 if(!session.unlocked)return;
 if(busy&&action!=='lock')return;
 const nav=e.target.closest('[data-page]');if(nav){hidePassword();page=nav.dataset.page;render();window.scrollTo(0,0);return;}
 const f=e.target.closest('[data-filter]');if(f){hidePassword();filter=f.dataset.filter;renderAccounts();return;}
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
 if(action==='reset'){hidePassword();filter='全部';query='';renderAccounts();}
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
  if(file.size>MAX_FILE_BYTES)throw new Error('加密文件不能超过 8 MB。');
  const parsed=parseEncryptedFile(await file.text());if(generation!==session.generation)return;
  clearImport();pendingFile=parsed;$('import-dialog').showModal();
 }catch(error){toast(errorText(error));}
};
$('import-decrypt-form').onsubmit=e=>{
 e.preventDefault();let password=$('import-password').value;$('import-password').value='';$('import-error').textContent='';
 const file=pendingFile;
 void perform(async()=>{
  if(!file)throw new Error('请重新选择加密文件。');
  let staged;try{staged=await session.stageImport(file,password);}finally{password='';}
  if(file!==pendingFile||document.hidden)throw new LockedError();
  pendingImport=staged;$('import-decrypt-form').hidden=true;$('import-preview').hidden=false;
  $('import-summary').textContent=`即将导入 ${staged.accounts.length} 个账号。${session.unlocked?`替换本设备当前 ${accounts.length} 个账号。`:'在本设备创建信息库。'}`;
  $('import-policy').textContent=session.unlocked?'整库替换，不自动合并。当前设备主密码保持不变；文件仍使用导出时的主密码。':'导入后使用这份文件的主密码解锁。不会更改原设备数据。';
  $('export-before-import').hidden=!session.unlocked;$('import-confirm').checked=false;syncButtons();
 },'import-error');
};
$('close-import').onclick=closeImport;$('import-dialog').addEventListener('cancel',clearImport);
$('import-confirm').onchange=syncButtons;
$('confirm-import').onclick=()=>void perform(async()=>{
 if(!pendingImport||!$('import-confirm').checked)return;
 const staged=pendingImport;await session.importPrepared(staged);changed();closeImport();
 page='accounts';filter='全部';query='';enterVault();toast('加密数据已导入并保存到本设备。');
},'import-error');
$('account-form').onsubmit=e=>{
 e.preventDefault();if(busy||!session.unlocked)return;
 const data=new FormData(e.target);const prior=accounts.find(a=>a.id===editId);
 const record={id:editId||Math.max(Date.now(),...accounts.map(a=>a.id+1)),color:prior?.color||'#efefff',ink:prior?.ink||'#7a77ca',letter:prior?.letter||String(data.get('name')).slice(0,1).toUpperCase(),...(prior?.logo?{logo:prior.logo}:{}),
  ...Object.fromEntries(['name','username','category','method','password','url','note'].map(k=>[k,k==='password'?String(data.get(k)):String(data.get(k)).trim()])),favorite:data.has('favorite'),date:new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai'}).format(new Date()).replaceAll('-','.')};
 $('save-error').textContent='';
 void perform(async()=>{
  const next=editId?accounts.map(a=>a.id===editId?record:a):[...accounts,record];await session.save(next);
  accounts=session.accounts;selected=record.id;filter='全部';query='';page='accounts';$('account-form').reset();$('account-dialog').close();changed();render();toast('已加密保存到本设备。');
 },'save-error');
};
const closeAccount=()=>{$('account-form').reset();$('account-dialog').close();editId=null;};
for(const id of ['close-form','cancel-form'])$(id).onclick=closeAccount;
$('account-dialog').addEventListener('cancel',()=>{$('account-form').reset();editId=null;});
$('lock').onclick=()=>lock();$('mobile-lock').onclick=()=>lock();$('help').onclick=explain;
const autoLock=installAutoLock({document,window,lock,isUnlocked:()=>session.unlocked});
channel?.addEventListener('message',()=>lock('另一页面已修改信息库，请重新解锁。'));
document.addEventListener('keydown',e=>{
 if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='k'&&session.unlocked){e.preventDefault();if(document.querySelector('dialog[open]'))return;if(page!=='accounts'){page='accounts';render();}$('search').focus();}
});
hydrateIcons();void refreshGate();
