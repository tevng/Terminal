import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { WebglAddon } from '@xterm/addon-webgl';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { UnicodeGraphemesAddon } from '@xterm/addon-unicode-graphemes';
import { defaults, calibrateFonts, sanitizeOptions } from './fonts.js';
import {wireClipboard} from './clipboard.js';
import {resolveAppearance} from './themes.js';
import {installAppearance} from './appearance.js';
import '@xterm/xterm/css/xterm.css';
import './style.css';
import './themes.css';
const $ = id => document.getElementById(id), api = window.silk;
let settings = { profiles: [], appearance: defaults }, options = defaults, active = null, counter = 0, configHosts = [];
const sessions = new Map(), byRemote = new Map();
let inputRecoveryGeneration=0,inputRecoveryPending=false;
const nextInputFrame=()=>new Promise(resolve=>requestAnimationFrame(resolve));
function requestInputRecovery(){inputRecoveryPending=true;void restoreTerminalInput();}
async function restoreTerminalInput(){
  const generation=++inputRecoveryGeneration,s=current();
  await nextInputFrame();
  const valid=()=>generation===inputRecoveryGeneration && s && current()===s && sessions.has(s.key) && !document.querySelector('dialog[open]');
  if(!valid())return;
  // Explicitly leave the password context before focusing xterm's plain textarea.
  s.term.blur();s.term.focus();
  if(s.term.textarea)s.term.textarea.inputMode='text';
  await nextInputFrame();if(!valid())return;
  inputRecoveryPending=false;
  try{if(!await api.restoreInputFocus())inputRecoveryPending=true;}catch(e){report(e);}
}
window.addEventListener('focus',()=>{if(inputRecoveryPending)void restoreTerminalInput();});
function closeCredentialDialog(dialog){
  if(dialog.contains(document.activeElement))document.activeElement.blur();
  // Never toggle a live password input to plain text to repair IME state.
  for(const input of dialog.querySelectorAll('input[type=password]'))input.value='';
  dialog.close();
}
const authDialog=document.createElement('dialog');authDialog.id='auth-dialog';
authDialog.innerHTML='<form id="auth-form"><div class="eyebrow">SSH AUTHENTICATION</div><h2 id="auth-title"></h2><p id="auth-instructions" class="muted"></p><div id="auth-fields"></div><p class="muted">仅用于本次 SSH 认证，不保存密码、口令或验证码。</p><div class="dialog-actions"><button type="button" id="auth-cancel">取消连接</button><button class="primary" type="submit">继续连接</button></div></form>';
document.body.append(authDialog);
const authQueue=[];let currentAuth=null;
function showNextAuth(){
  if(currentAuth || !authQueue.length)return;
  currentAuth=authQueue.shift();const {session:s,event}=currentAuth;
  if(!sessions.has(s.key)||s.state==='closed'){currentAuth=null;showNextAuth();return;}
  activate(s.key);$('auth-title').textContent=`${event.username}@${event.alias||event.host}`;
  $('auth-instructions').textContent=String(event.instructions||'服务器请求认证').slice(0,2000);$('auth-fields').replaceChildren();
  for(const prompt of event.prompts.slice(0,16)){
    const label=document.createElement('label');label.textContent=String(prompt.prompt||'认证信息').slice(0,300);
    const input=document.createElement('input');input.type=prompt.echo?'text':'password';input.autocomplete='off';input.maxLength=4096;label.append(input);$('auth-fields').append(label);
  }
  authDialog.showModal();$('auth-fields').querySelector('input')?.focus();
}
function queueAuth(session,event){authQueue.push({session,event});showNextAuth();}
function cancelAuth(requestId){
  for(let i=authQueue.length-1;i>=0;i--)if(authQueue[i].event.requestId===requestId)authQueue.splice(i,1);
  if(currentAuth?.event.requestId===requestId){currentAuth=null;closeCredentialDialog(authDialog);$('auth-fields').replaceChildren();showNextAuth();requestInputRecovery();}
}
function cancelSessionAuth(s){for(const r of [currentAuth,...authQueue].filter(Boolean))if(r.session===s)cancelAuth(r.event.requestId);}
async function answerAuth(answers){
  if(!currentAuth)return;const id=currentAuth.event.requestId;currentAuth=null;closeCredentialDialog(authDialog);$('auth-fields').replaceChildren();
  try{await api.answerAuth(id,answers);}catch(e){report(e);}showNextAuth();requestInputRecovery();
}
$('auth-form').onsubmit=event=>{event.preventDefault();void answerAuth([...$('auth-fields').querySelectorAll('input')].map(input=>input.value));};
$('auth-cancel').onclick=()=>void answerAuth(null);authDialog.oncancel=event=>{event.preventDefault();void answerAuth(null);};
const fontStyle = document.createElement('style'); document.head.append(fontStyle);
const unicodeLabel = document.createElement('label'); unicodeLabel.textContent = '字符宽度 / Emoji 组合';
const unicodeSelect = document.createElement('select'); unicodeSelect.id = 'unicode';
unicodeSelect.add(new Option('Unicode 15 字素簇（实验性，支持组合 Emoji）','15-graphemes'));
unicodeSelect.add(new Option('Unicode 11（兼容传统 wcwidth）','11'));
unicodeLabel.append(unicodeSelect); $('cursor-blink').closest('label').before(unicodeLabel);
const mathLabel = document.createElement('label'); mathLabel.textContent = '希腊字母 / 数学符号字体及 fallback';
const mathInput = document.createElement('input'); mathInput.id = 'font-math'; mathLabel.append(mathInput); $('font-fallback').closest('label').before(mathLabel);
const fontInfo = document.createElement('p'); fontInfo.id = 'font-info'; fontInfo.className = 'muted'; $('font-preview').after(fontInfo);
$('auth').add(new Option('使用 ~/.ssh/config 自动认证','config'));
const configInfo = document.createElement('p'); configInfo.id = 'config-info'; configInfo.className = 'muted'; $('saved-profile').closest('label').after(configInfo);
const refreshConfig = document.createElement('button'); refreshConfig.id = 'config-refresh'; refreshConfig.type = 'button'; refreshConfig.textContent = '刷新 SSH config'; configInfo.after(refreshConfig);
let fontFamily, toastTimer;
const systemAppearance=matchMedia('(prefers-color-scheme: light)');
let theme={...resolveAppearance(defaults,systemAppearance.matches).terminal.colors};
function applyAppearance(){
  const result=resolveAppearance(options,systemAppearance.matches),root=document.documentElement;
  root.dataset.uiTheme=result.uiKey;root.dataset.terminalScheme=result.schemeKey;root.style.colorScheme=result.ui.mode;
  for(const [key,value]of Object.entries(result.ui.tokens))root.style.setProperty('--'+key,value);
  theme={...result.terminal.colors};root.style.setProperty('--terminal-bg',theme.background);
  for(const s of sessions.values())s.term.options.theme={...theme};
}
systemAppearance.addEventListener('change',()=>{if(options.uiTheme==='system')applyAppearance();});
const appearance=installAppearance({getOptions:()=>options,getFont:()=>fontFamily||'monospace',onClose:()=>current()?.term.focus(),save:async choice=>{
  const next=sanitizeOptions({...options,...choice});await api.saveSettings({...settings,appearance:next});options=next;settings.appearance=next;applyAppearance();
}});
const appearanceButton=document.createElement('button');appearanceButton.id='appearance-open';appearanceButton.textContent='◐ 外观';appearanceButton.title='界面主题与终端配色';appearanceButton.onclick=()=>appearance.open();$('settings-open').before(appearanceButton);
function toast(message) { $('toast').textContent = message; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').hidden = true, 4000); }
function report(e) { toast(e.message || String(e)); }
async function applyFonts() {
  const result = await calibrateFonts(options, fontStyle); fontFamily = result.family;
  $('font-preview').style.fontFamily = fontFamily; $('markdown-content').style.fontFamily = fontFamily;
  $('markdown-content').style.setProperty('--terminal-font',fontFamily);
  $('markdown-source').style.fontFamily=fontFamily;
  $('font-preview').style.fontSize = `${options.fontSize}px`;
  $('font-preview').replaceChildren();
  for (const [text, cols] of [['A',1],['B',1],['中',2],['文',2],['🥳',2],['🧑‍💻',2],['α',1],['∑',1]]) {
    const span = document.createElement('span'); span.textContent = text; span.dataset.columns = cols;
    span.style.cssText = `display:inline-block;width:${result.cellWidth * cols}px;text-align:center;border-bottom:1px solid #527b6c;vertical-align:middle;overflow:hidden;`; $('font-preview').append(span);
  }
  const missing = [['SilkLatin0',options.latin.split(',')[0]],['SilkCJK0',options.cjk.split(',')[0]],['SilkEmoji0',options.emoji.split(',')[0]],['SilkMath0',options.math.split(',')[0]]].filter(([alias]) => !result.loaded[alias]).map(([,name])=>name);
  fontInfo.textContent = `英文 1 列 · 中文 2 列 · Emoji 2 列 · 希腊字母 1 列；基准 ${result.cellWidth.toFixed(2)} px。${missing.length ? `未加载首选字体：${missing.join('、')}，已回退。` : '首选字体均已加载。'}`;
}
async function persist() { await api.saveSettings(settings); }
function current() { return sessions.get(active); }
function releaseGPU(s) {
  if (!s?.gpu) return;
  const addon = s.gpu; s.gpu = null;
  const contexts = [...s.element.querySelectorAll('canvas')].map(canvas => canvas.getContext('webgl2')).filter(Boolean);
  addon.dispose();
  // Removing a canvas alone leaves Chromium's GL context alive until GC.
  // Explicitly lose detached contexts so repeated tab switches don't accumulate GPU allocations.
  contexts.forEach(gl => gl.getExtension('WEBGL_lose_context')?.loseContext());
}
function attachGPU(s) {
  if (!s || options.renderer !== 'webgl' || s.gpu || s.gpuFailed) return;
  let addon;
  try { addon = new WebglAddon(); s.term.loadAddon(addon); s.gpu = addon; addon.onContextLoss(() => { if (s.gpu !== addon) return; releaseGPU(s); s.gpuFailed = true; status(); }); }
  catch { addon?.dispose(); s.gpuFailed = true; }
}
function fit(s = current()) { if (!s || s.key !== active) return; try { s.fit.fit(); } catch {} status(); }
function status() {
  const s = current();
  $('connection-state').textContent = s ? `${s.state === 'ready' ? '● 已连接' : s.state === 'connecting' ? '◌ 连接中' : '○ 已断开'}  ${s.profile.username}@${s.profile.host}` : '○ 就绪';
  $('session-info').textContent = s ? `${s.term.cols} × ${s.term.rows}  ·  xterm-256color  ·  ${s.term.buffer.active.type === 'alternate' ? '全屏 / TUI' : '标准缓冲区'}` : 'SSH ONLY · 不含远程文件管理';
  $('resource-info').textContent = s ? `${s.gpu ? 'WebGL' : 'DOM'} · ${options.scrollback.toLocaleString()} 行历史上限 · ${sessions.size} 个标签` : 'Terminal 0.3';
}
function activate(key) {
  if (active !== key) { const old = current(); releaseGPU(old); if (old) { old.element.hidden = true; old.tab.classList.remove('active'); } }
  active = key; const s = current();
  $('welcome').hidden = Boolean(s);
  if (s) { s.element.hidden = false; s.tab.classList.add('active'); fit(s); attachGPU(s); s.term.refresh(0, s.term.rows - 1); s.term.focus(); }
  status();
}
function removeSession(s,{closeRemote=true}={}) {
  if(!sessions.has(s.key))return;
  const keys=[...sessions.keys()],index=keys.indexOf(s.key),neighbor=keys[index-1]??keys[index+1]??null;
  s.state='closed';
  cancelSessionAuth(s);
  if (s.remote) { byRemote.delete(s.remote);if(closeRemote)api.close(s.remote).catch(report); }
  releaseGPU(s); s.term.dispose(); s.element.remove(); s.tab.remove(); sessions.delete(s.key);
  if (active === s.key) { active = null; activate(neighbor); }else status();
  if(!sessions.size){$('find-bar').hidden=true;$('markdown-panel').hidden=true;}
}
function newSession(profile) {
  const key = ++counter, element = document.createElement('div'); element.className = 'terminal-host'; element.hidden = true; $('workspace').append(element);
  const tab = document.createElement('div'); tab.className = 'tab'; tab.setAttribute('role','tab');
  const label = document.createElement('button'); label.className = 'tab-label'; label.textContent = profile.name || `${profile.username}@${profile.host}`; label.onclick = () => activate(key);
  const close = document.createElement('button'); close.className = 'tab-close'; close.textContent = '×'; close.title = '关闭会话';
  tab.append(label,close); $('tabs').append(tab);
  const term = new Terminal({ fontFamily, fontSize: options.fontSize, lineHeight: options.lineHeight, scrollback: options.scrollback,
    theme:{...theme}, cursorBlink: options.cursorBlink, cursorStyle: 'block', allowProposedApi: true,
    allowTransparency: false, rescaleOverlappingGlyphs: true, minimumContrastRatio: 1, altClickMovesCursor: false, scrollOnUserInput: true, smoothScrollDuration: 0,
    linkHandler: { activate: () => {} } });
  const fitter = new FitAddon(), search = new SearchAddon(); term.loadAddon(fitter); term.loadAddon(search); term.loadAddon(new Unicode11Addon()); term.loadAddon(new UnicodeGraphemesAddon()); term.unicode.activeVersion = options.unicode === '11' ? '11' : '15-graphemes';
  const s = { key, profile: { name: profile.name, host: profile.host, port: profile.port, username: profile.username, auth: profile.auth }, term, fit: fitter, search, element, tab, state: 'connecting', remote: null, gpu: null };
  sessions.set(key,s); close.onclick = () => {
    if (s.state !== 'closed' && !confirm('关闭此 SSH 会话？远程前台任务可能会退出；需要保留任务时请先使用 tmux。')) return;
    removeSession(s);
  };
  element.hidden = false; term.open(element); activate(key);
  s.clipboard=wireClipboard({element,term,api,ready:()=>s.state==='ready',notify:toast,error:report});
  term.onData(data => { if (s.state === 'ready') api.input(s.remote, data); });
  term.onBinary(data => { if (s.state === 'ready') api.input(s.remote, data, true); });
  term.onResize(({cols, rows}) => { if (s.remote) api.resize(s.remote,cols,rows); });
  term.onTitleChange(title => { label.textContent = title.slice(0,100) || s.profile.host; });
  let bufferType = term.buffer.active.type;
  term.onWriteParsed(() => { if (term.buffer.active.type !== bufferType) { bufferType = term.buffer.active.type; if (active === s.key) status(); } });
  term.attachCustomKeyEventHandler(event => {
    if(event.isComposing || event.keyCode===229)return true;
    if (event.type !== 'keydown') return true;
    if ((event.ctrlKey && event.shiftKey && ['T','W','F','M','C','V'].includes(event.key.toUpperCase())) || (event.ctrlKey && event.key === 'Tab')) return false;
    return true;
  });
  return s;
}
async function connect(profile) {
  const s = newSession(profile);
  try {
    const remote=await api.connect(profile,{cols:s.term.cols,rows:s.term.rows});
    if(!sessions.has(s.key)){await api.close(remote);return;}
    s.remote=remote;byRemote.set(remote,s);api.resize(remote,s.term.cols,s.term.rows);
  }
  catch (e) { removeSession(s,{closeRemote:false});toast(`连接失败：${e.message}`); }
}
api.onEvent(event => {
  const s = byRemote.get(event.id); if (!s) return;
  if(event.type==='auth'){queueAuth(s,event);return;}
  if(event.type==='auth-cancel'){cancelAuth(event.requestId);return;}
  if (event.type === 'notice') toast(event.message);
  else if (event.type === 'data') s.term.write(new Uint8Array(event.data), () => { api.ack(event.id,event.seq); });
  else if (event.type === 'ready') { s.state = 'ready'; api.resize(s.remote,s.term.cols,s.term.rows); status();if(s.key===active)requestInputRecovery(); }
  else if (event.type === 'error') { s.state = 'closed';toast(`${s.profile.name||s.profile.host}：${event.message}`);status(); }
  else if (event.type === 'closed') {removeSession(s,{closeRemote:false});}
});
function profilesList() {
  const select = $('saved-profile'); select.replaceChildren(new Option('新建连接',''));
  if(configHosts.length) {
    const group=document.createElement('optgroup');group.label='~/.ssh/config';
    configHosts.forEach(p=>group.append(new Option(`${p.alias} → ${p.username}@${p.host}:${p.port}${p.proxyJump?'（跳板）':''}`,`config:${p.alias}`)));select.append(group);
  }
  const group=document.createElement('optgroup');group.label='应用内保存';
  settings.profiles.forEach((p,i) => group.append(new Option(p.name || `${p.username}@${p.host}`,String(i))));select.append(group);
}
async function loadConfig() {
  try {const result=await api.listConfig();configHosts=result.hosts;configInfo.textContent=`已读取 ${result.file} · ${result.hosts.length} 个主机别名。Host 通配规则也可用于手动输入的别名。`;profilesList();}
  catch(e){configHosts=[];configInfo.textContent=`SSH config 读取失败：${e.message}`;profilesList();}
}
refreshConfig.onclick=loadConfig;
function authFields() {
  const fromConfig=$('auth').value==='config';
  $('key-fields').hidden = !['key','config'].includes($('auth').value); $('key-path').closest('label').hidden=fromConfig;
  $('password-field').hidden = !['password','config'].includes($('auth').value);
  $('username').required=!fromConfig;$('username').readOnly=fromConfig;$('port').readOnly=fromConfig;
}
async function openConnect(profile) {
  profilesList(); $('connect-error').textContent = ''; $('password').value = ''; $('passphrase').value = ''; $('key-path').value = '';
  $('connect-form').reset();
  if (profile) fillProfile(profile);
  authFields(); $('connect-dialog').showModal();
  await loadConfig();
}
function fillProfile(p) { for (const [id,key] of [['profile-name','name'],['host','host'],['port','port'],['username','username'],['auth','auth']]) $(id).value = p[key] || ''; authFields(); }
$('saved-profile').onchange = () => {
  const value=$('saved-profile').value;
  if(value.startsWith('config:')) {const p=configHosts.find(p=>p.alias===value.slice(7));if(p)fillProfile({name:p.alias,host:p.alias,port:p.port,username:p.username,auth:'config'});}
  else {const p=settings.profiles[Number(value)];if(value!=='' && p)fillProfile(p);}
};
$('auth').onchange = authFields;
$('key-choose').onclick = async () => { try { const file = await api.chooseKey(); if (file) $('key-path').value = file; } catch(e) { report(e); } };
$('connect-form').onsubmit = async e => {
  e.preventDefault(); const p = { name:$('profile-name').value.trim(), host:$('host').value.trim(), port:Number($('port').value), username:$('username').value.trim(), auth:$('auth').value, keyPath:$('key-path').value, password:$('password').value, passphrase:$('passphrase').value };
  if (p.auth === 'key' && !p.keyPath) { $('connect-error').textContent = '请选择私钥文件'; return; }
  $('connect-submit').disabled = true;
  try {
    if ($('save-profile').checked && p.auth!=='config') {
      const clean = { name:p.name,host:p.host,port:p.port,username:p.username,auth:p.auth };
      const i = settings.profiles.findIndex(x => x.host === p.host && x.port === p.port && x.username === p.username);
      if (i >= 0) settings.profiles[i] = clean; else settings.profiles.push(clean);
      await persist();
    }
    closeCredentialDialog($('connect-dialog'));await connect(p);
  } catch (err) { $('connect-error').textContent = err.message; } finally { $('connect-submit').disabled = false; }
};
$('delete-profile').onclick = async () => { const value = $('saved-profile').value; if (!value || value.startsWith('config:')) return; settings.profiles.splice(Number(value),1); try { await persist(); profilesList(); } catch(e) { report(e); } };
for (const id of ['new-tab','welcome-connect']) $(id).onclick = () => openConnect();
$('reconnect').onclick = () => { const s = current(); if (s) openConnect(s.profile); };
document.querySelectorAll('[data-close]').forEach(button => button.onclick = () => {const dialog=$(button.dataset.close);if(dialog.id==='connect-dialog'){closeCredentialDialog(dialog);requestInputRecovery();}else dialog.close();});
$('connect-dialog').addEventListener('cancel',event=>{event.preventDefault();closeCredentialDialog($('connect-dialog'));requestInputRecovery();});
function settingsFields(o) { for (const [id,key] of [['font-latin','latin'],['font-cjk','cjk'],['font-math','math'],['font-emoji','emoji'],['font-fallback','fallback'],['font-size','fontSize'],['line-height','lineHeight'],['scrollback','scrollback'],['renderer','renderer'],['unicode','unicode']]) $(id).value = o[key]; $('cursor-blink').checked = o.cursorBlink; }
function readFields() { return sanitizeOptions({ ...options,fontPresetVersion:2,latin:$('font-latin').value,cjk:$('font-cjk').value,math:$('font-math').value,emoji:$('font-emoji').value,fallback:$('font-fallback').value,fontSize:$('font-size').value,lineHeight:$('line-height').value,scrollback:$('scrollback').value,renderer:$('renderer').value,unicode:$('unicode').value,cursorBlink:$('cursor-blink').checked }); }
$('settings-open').onclick = () => { settingsFields(options); $('settings-error').textContent = ''; $('settings-dialog').showModal(); };
$('settings-reset').onclick = () => { settingsFields(defaults); };
$('settings-form').onsubmit = async e => {
  e.preventDefault(); const next = readFields();
  try {
    await api.saveSettings({ ...settings, appearance: next }); options = next; settings.appearance = next;applyAppearance();await applyFonts();
    // Load local font aliases before measuring xterm's cell width.
    await document.fonts.load(`${options.fontSize}px ${fontFamily}`, 'A中🥳').catch(() => {}); await document.fonts.ready;
    for (const s of sessions.values()) { releaseGPU(s); s.gpuFailed = false; Object.assign(s.term.options, {fontFamily,fontSize:options.fontSize,lineHeight:options.lineHeight,scrollback:options.scrollback,cursorBlink:options.cursorBlink}); s.term.unicode.activeVersion = options.unicode === '11' ? '11' : '15-graphemes'; }
    $('settings-dialog').close(); fit(); attachGPU(current()); status();
  } catch(e) { $('settings-error').textContent = e.message; }
};
let resizing;
new ResizeObserver(() => { clearTimeout(resizing); resizing = setTimeout(() => fit(), 60); }).observe($('workspace'));
function search(back = false) { const s = current(); if (!s) return; const query = $('find-input').value; if (!query) { s.search.clearDecorations(); return; } const found = s.search[back ? 'findPrevious' : 'findNext'](query, { incremental:false }); $('find-result').textContent = found ? '已找到' : '无匹配'; }
$('find-open').onclick = () => { $('find-bar').hidden = false; $('find-input').focus(); };
$('find-close').onclick = () => { $('find-bar').hidden = true; current()?.search.clearDecorations(); current()?.term.focus(); };
$('find-input').onkeydown = e => { if (e.key === 'Enter') search(e.shiftKey); if (e.key === 'Escape') $('find-close').click(); };
$('find-next').onclick = () => search(); $('find-prev').onclick = () => search(true);
async function copy() { await current()?.clipboard.copy(); }
$('copy-output').onclick = copy;
$('copy-output').onmousedown=event=>event.preventDefault();
let markdownVersion = 0;
async function renderMarkdown() {
  const version = ++markdownVersion, source = $('markdown-source').value.slice(0,500000);
  try { const { render } = await import('./markdown.js'); if (version === markdownVersion) render(source, $('markdown-content')); } catch(e) { report(e); }
}
function snapshot() {
  const s = current(); if (!s) { $('markdown-source').value = '# Markdown 阅读\n\n连接后选择终端文本，或点击“编辑源文本”粘贴 Markdown。'; renderMarkdown(); return; }
  let text = s.term.getSelection();
  if (!text) {
    const buffer = s.term.buffer.active, lines = []; let chunk = '', total = 0;
    for (let i = buffer.length - 1; i >= Math.max(0,buffer.length - 4000); i--) {
      const line = buffer.getLine(i); const value = line.translateToString(true); total += value.length;
      if (total > 500000) break;
      chunk = value + chunk;
      if (!line.isWrapped) { lines.push(chunk); chunk = ''; }
    }
    if (chunk) lines.push(chunk); text = lines.reverse().join('\n');
  }
  $('markdown-source').value = text.slice(0,500000); renderMarkdown();
}
$('markdown-open').onclick = () => { $('markdown-panel').hidden = !$('markdown-panel').hidden; if (!$('markdown-panel').hidden) snapshot(); };
$('markdown-close').onclick = () => $('markdown-panel').hidden = true;
$('markdown-refresh').onclick = snapshot;
$('markdown-edit').onclick = () => { $('markdown-source').hidden = !$('markdown-source').hidden; };
let mdTimer; $('markdown-source').oninput = () => { clearTimeout(mdTimer); mdTimer = setTimeout(renderMarkdown,180); };
document.addEventListener('keydown', async e => {
  if(e.isComposing || e.keyCode===229)return;
  if (document.querySelector('dialog[open]')) return;
  if (e.ctrlKey && e.key === 'Tab') { e.preventDefault(); const keys = [...sessions.keys()]; if (keys.length) activate(keys[(keys.indexOf(active) + (e.shiftKey ? keys.length - 1 : 1)) % keys.length]); return; }
  if (!e.ctrlKey || !e.shiftKey) return;
  const k = e.key.toUpperCase();
  const commands = { T:'new-tab', W:null, F:'find-open', M:'markdown-open', C:'copy-output' };
  if (k in commands) { e.preventDefault(); if (k === 'W') current()?.tab.querySelector('.tab-close').click(); else $(commands[k]).click(); }
  if (k === 'V' && current()?.state === 'ready') {
    e.preventDefault(); await current().clipboard.paste();
  }
});
try { settings = await api.loadSettings(); options = sanitizeOptions(settings.appearance); settings.appearance = options;applyAppearance();await applyFonts(); }
catch(e) {applyAppearance();await applyFonts(); report(e); }
profilesList();
await loadConfig();
status();
