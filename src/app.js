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
import { installTabs } from './tabs.js';
import { installPanes } from './panes.js';
import { defaultLocale, locales, normalizeLocale, translate } from '../i18n/index.cjs';
import { cjkSample } from '../i18n/samples.json';
import '@xterm/xterm/css/xterm.css';
import './style.css';
import './themes.css';
import './workspace.css';
const $ = id => document.getElementById(id), api = window.silk;
let settings = { profiles: [], appearance: defaults, locale: defaultLocale };
let options = defaults, active = null, counter = 0, configResult, configError;
let locale = defaultLocale;
const t = (key, values) => translate(locale, key, values);
const sessions = new Map(), bySessionId = new Map();
const tabStrip = installTabs($('tabs'), t);
const paneLayout = installPanes($('panes'), t, requestFit);
let split = null, resizeTimer;
const splitDialog = $('split-dialog'), splitChoices = $('split-tabs');
const localizedAttributes = [['title', 'title'], ['placeholder', 'placeholder'], ['label', 'aria-label']];
function applyLocale(next) {
  const markdownSource = $('markdown-source');
  const isDefaultMarkdown = markdownSource.value === t('reader.empty');
  locale = normalizeLocale(next);
  document.documentElement.lang = locale;
  for (const node of document.querySelectorAll('[data-i18n]')) node.textContent = t(node.dataset.i18n);
  for (const [suffix, attribute] of localizedAttributes) {
    const key = `data-i18n-${suffix}`;
    for (const node of document.querySelectorAll(`[${key}]`)) node.setAttribute(attribute, t(node.getAttribute(key)));
  }
  showConfig();
  status();
  if (isDefaultMarkdown) markdownSource.value = t('reader.empty');
  if (!$('markdown-panel').hidden) void renderMarkdown();
}
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
authDialog.innerHTML = `<form id="auth-form">
  <div class="eyebrow" data-i18n="auth.title"></div>
  <h2 id="auth-title"></h2>
  <p id="auth-instructions" class="muted"></p>
  <div id="auth-fields"></div>
  <p class="muted" data-i18n="auth.sessionOnly"></p>
  <div class="dialog-actions">
    <button type="button" id="auth-cancel" data-i18n="ssh.cancelConnection"></button>
    <button class="primary" type="submit" data-i18n="auth.continue"></button>
  </div>
</form>`;
authDialog.setAttribute('aria-labelledby', 'auth-title');
document.body.append(authDialog);
const authQueue=[];let currentAuth=null;
function showNextAuth(){
  if(currentAuth || !authQueue.length)return;
  currentAuth=authQueue.shift();const {session:s,event}=currentAuth;
  if(!sessions.has(s.key)||s.state==='closed'){currentAuth=null;showNextAuth();return;}
  activate(s.key);$('auth-title').textContent=`${event.username}@${event.alias||event.host}`;
  $('auth-instructions').textContent=String(event.instructions||t('auth.serverRequested')).slice(0,2000);$('auth-fields').replaceChildren();
  for(const prompt of event.prompts.slice(0,16)){
    const label=document.createElement('label');label.textContent=String(prompt.prompt||t('auth.response')).slice(0,300);
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
for (const choice of locales) $('language').add(new Option(translate(choice, 'language.name'), choice));
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
const appearance=installAppearance({t,getOptions:()=>options,getFont:()=>fontFamily||'monospace',onClose:()=>current()?.term.focus(),save:async choice=>{
  const next=sanitizeOptions({...options,...choice});await api.saveSettings({...settings,appearance:next});options=next;settings.appearance=next;applyAppearance();
}});
$('appearance-open').onclick = () => appearance.open();
function toast(message) { $('toast').textContent = message; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').hidden = true, 4000); }
function report(e) { toast(e.message || String(e)); }
async function applyFonts() {
  const result = await calibrateFonts(options, fontStyle); fontFamily = result.family;
  $('font-preview').style.fontFamily = fontFamily; $('markdown-content').style.fontFamily = fontFamily;
  $('markdown-content').style.setProperty('--terminal-font',fontFamily);
  $('markdown-source').style.fontFamily=fontFamily;
  $('font-preview').style.fontSize = `${options.fontSize}px`;
  $('font-preview').replaceChildren();
  const cjkCells = [...cjkSample].map(text => [text, 2]);
  for (const [text, cols] of [['A',1],['B',1],...cjkCells,['🥳',2],['🧑‍💻',2],['α',1],['∑',1]]) {
    const span = document.createElement('span'); span.textContent = text; span.dataset.columns = cols;
    span.style.cssText = `display:inline-block;width:${result.cellWidth * cols}px;text-align:center;border-bottom:1px solid #527b6c;vertical-align:middle;overflow:hidden;`; $('font-preview').append(span);
  }
  const missing = [['SilkLatin0',options.latin.split(',')[0]],['SilkCJK0',options.cjk.split(',')[0]],['SilkEmoji0',options.emoji.split(',')[0]],['SilkMath0',options.math.split(',')[0]]].filter(([alias]) => !result.loaded[alias]).map(([,name])=>name);
  const fontStatus = missing.length ? t('settings.missingFonts', { fonts: missing.join(', ') }) : t('settings.fontsLoaded');
  $('font-info').textContent = `${t('settings.widths', { width: result.cellWidth.toFixed(2) })} ${fontStatus}`;
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
function fitVisible() {
  for (const s of sessions.values()) {
    if (!s.element.hidden) { try { s.fit.fit(); } catch {} }
  }
}
function requestFit() {
  if (resizeTimer) return;
  resizeTimer = setTimeout(() => { resizeTimer = null; fitVisible(); status(); }, 48);
}
function status() {
  const s = current();
  $('reconnect').hidden = !s || Boolean(s.profile.shell);
  $('split-open').hidden = sessions.size < 2;
  $('split-open').setAttribute('aria-pressed', String(Boolean(split)));
  if (!s) {
    $('connection-state').textContent = `○ ${t('terminal.ready')}`;
    $('session-info').textContent = t('home.localAndSsh');
    $('resource-info').textContent = 'Terminal 0.3';
    return;
  }
  const symbol = s.state === 'ready' ? '●' : s.state === 'connecting' ? '◌' : '○';
  const state = s.state === 'ready' ? 'terminal.connected' : s.state === 'connecting' ? 'terminal.connecting' : 'terminal.disconnected';
  const label = s.profile.shell ? t('local.status', { shell: s.profile.name }) : `${t(state)}  ${s.profile.username}@${s.profile.host}`;
  $('connection-state').textContent = `${symbol} ${label}`;
  const buffer = t(s.term.buffer.active.type === 'alternate' ? 'terminal.alternate' : 'terminal.normal');
  $('session-info').textContent = `${s.term.cols} × ${s.term.rows}  ·  xterm-256color  ·  ${buffer}`;
  $('resource-info').textContent = t('terminal.resources', {
    renderer: s.gpu ? 'WebGL' : 'DOM', scrollback: options.scrollback.toLocaleString(locale), tabs: sessions.size
  });
}
function renderWorkspace(focus) {
  const s = current();
  const visible = split?.keys || (s ? [active] : []);
  const newlyVisible = [];
  for (const session of sessions.values()) {
    const shown = visible.includes(session.key), focused = session.key === active;
    if (shown && session.element.hidden) newlyVisible.push(session);
    session.element.hidden = !shown;
    session.element.classList.toggle('active-pane', focused);
    session.tab.classList.toggle('is-visible', shown);
    session.tab.classList.toggle('active', focused);
    session.label.setAttribute('aria-selected', String(focused));
  }
  $('welcome').hidden = Boolean(visible.length);
  if (paneLayout.show(visible.map(key => sessions.get(key).element), split?.direction)) fitVisible();
  attachGPU(s);
  for (const session of newlyVisible) session.term.refresh(0, session.term.rows - 1);
  if (s && focus) {
    s.tab.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    s.element.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    s.term.focus();
  }
  status();
}
function activate(key, focus = true) {
  if (active !== key) releaseGPU(current());
  if (split && key !== null && !split.keys.includes(key)) {
    const index = Math.max(0, split.keys.indexOf(active));
    split.keys[index] = key;
  }
  active = key;
  renderWorkspace(focus);
}
function removeSession(s,{closeBackend=true}={}) {
  if(!sessions.has(s.key))return;
  const keys = tabStrip.order(), index = keys.indexOf(s.key);
  let neighbor = keys[index - 1] ?? keys[index + 1] ?? null;
  const paneIndex = split?.keys.indexOf(s.key) ?? -1;
  if (paneIndex >= 0) {
    split.keys.splice(paneIndex, 1);
    neighbor = split.keys[Math.min(paneIndex, split.keys.length - 1)] ?? neighbor;
    if (split.keys.length < 2) split = null;
  }
  s.state='closed';
  cancelSessionAuth(s);
  if (s.sessionId) { bySessionId.delete(s.sessionId);if(closeBackend)api.close(s.sessionId).catch(report); }
  releaseGPU(s); s.term.dispose(); s.element.remove(); tabStrip.remove(s.tab); sessions.delete(s.key);
  if (active === s.key) activate(neighbor);
  else renderWorkspace(false);
  if (splitDialog.open) {
    if (sessions.size < 2) splitDialog.close();
    else renderSplitChoices(checkedSplitKeys());
  }
  if(!sessions.size){$('find-bar').hidden=true;$('markdown-panel').hidden=true;}
}
function newSession(profile) {
  const key = ++counter, element = document.createElement('div'); element.className = 'terminal-host'; element.hidden = true; $('panes').append(element);
  const tab = document.createElement('div'); tab.className = 'tab';
  const label = document.createElement('button'); label.className = 'tab-label'; label.textContent = profile.name || `${profile.username}@${profile.host}`; label.onclick = () => activate(key);
  label.setAttribute('role', 'tab');
  label.id = `terminal-tab-${key}`;
  element.id = `terminal-pane-${key}`;
  element.setAttribute('role', 'tabpanel');
  element.setAttribute('aria-labelledby', label.id);
  label.setAttribute('aria-controls', element.id);
  const close = document.createElement('button'); close.className = 'tab-close'; close.textContent = '×';
  close.dataset.i18nTitle = close.dataset.i18nLabel = 'terminal.closeTab';
  close.title = t('terminal.closeTab'); close.setAttribute('aria-label', close.title);
  tab.append(label,close); tabStrip.add(tab, key);
  const term = new Terminal({ fontFamily, fontSize: options.fontSize, lineHeight: options.lineHeight, scrollback: options.scrollback,
    theme:{...theme}, cursorBlink: options.cursorBlink, cursorStyle: 'block', allowProposedApi: true,
    allowTransparency: false, rescaleOverlappingGlyphs: true, minimumContrastRatio: 1, altClickMovesCursor: false, scrollOnUserInput: true, smoothScrollDuration: 0,
    linkHandler: { activate: () => {} } });
  const fitter = new FitAddon(), search = new SearchAddon(); term.loadAddon(fitter); term.loadAddon(search); term.loadAddon(new Unicode11Addon()); term.loadAddon(new UnicodeGraphemesAddon()); term.unicode.activeVersion = options.unicode === '11' ? '11' : '15-graphemes';
  const s = { key, profile: { name: profile.name, host: profile.host, port: profile.port, username: profile.username, auth: profile.auth, shell: profile.shell }, term, fit: fitter, search, element, tab, label, state: 'connecting', sessionId: null, gpu: null };
  sessions.set(key,s); close.onclick = () => {
    const message = t(s.profile.shell ? 'local.closeConfirm' : 'ssh.closeConfirm');
    if (s.state !== 'closed' && !confirm(message)) return;
    removeSession(s);
  };
  $('panes').hidden = false;
  element.hidden = false; term.open(element); activate(key);
  function focusPane() { if (active !== key && !element.hidden) activate(key, false); }
  element.addEventListener('pointerdown', event => {
    focusPane();
    if (event.button === 0 && !event.target.closest('.xterm')) {
      event.preventDefault();
      term.focus();
    }
  }, true);
  element.addEventListener('focusin', focusPane);
  s.clipboard=wireClipboard({element,term,api,t,ready:()=>s.state==='ready',notify:toast,error:report});
  term.onData(data => { if (s.state === 'ready') api.input(s.sessionId, data); });
  term.onBinary(data => { if (s.state === 'ready') api.input(s.sessionId, data, true); });
  term.onResize(({cols, rows}) => { if (s.sessionId) api.resize(s.sessionId,cols,rows); });
  term.onTitleChange(title => { label.textContent = title.slice(0,100) || s.profile.name || s.profile.host; });
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
async function startSession(profile) {
  const s = newSession(profile);
  const size = { cols: s.term.cols, rows: s.term.rows };
  try {
    if (profile.shell) {
      // Register before spawning so even an immediate prompt or exit can be routed.
      s.sessionId = `local:${crypto.randomUUID()}`;
      bySessionId.set(s.sessionId, s);
      await api.startLocal(s.sessionId, profile.shell, size);
      return;
    }
    const id = await api.connect(profile, size);
    if (!sessions.has(s.key)) { await api.close(id); return; }
    s.sessionId = id;
    bySessionId.set(id, s);
    api.resize(id, s.term.cols, s.term.rows);
  } catch (e) {
    removeSession(s, { closeBackend: false });
    toast(t(profile.shell ? 'local.startFailed' : 'ssh.connectFailed', { reason: e.message }));
  }
}
api.onEvent(event => {
  const s = bySessionId.get(event.id); if (!s) return;
  if(event.type==='auth'){queueAuth(s,event);return;}
  if(event.type==='auth-cancel'){cancelAuth(event.requestId);return;}
  if (event.type === 'notice') toast(event.message);
  else if (event.type === 'data') s.term.write(typeof event.data === 'string' ? event.data : new Uint8Array(event.data), () => { api.ack(event.id,event.seq); });
  else if (event.type === 'ready') { s.state = 'ready'; api.resize(s.sessionId,s.term.cols,s.term.rows); status();if(s.key===active && !s.profile.shell)requestInputRecovery(); }
  else if (event.type === 'error') { s.state = 'closed';toast(t('terminal.sessionError', { name: s.profile.name || s.profile.host, reason: event.message }));status(); }
  else if (event.type === 'closed') {removeSession(s,{closeBackend:false});}
});
function profilesList() {
  const select = $('saved-profile'); select.replaceChildren(new Option(t('ssh.new'), ''));
  const configHosts = configResult?.hosts || [];
  if(configHosts.length) {
    const group=document.createElement('optgroup');group.label='~/.ssh/config';
    configHosts.forEach(p=>group.append(new Option(`${p.alias} → ${p.username}@${p.host}:${p.port}${p.proxyJump ? ' ' + t('ssh.configJump') : ''}`,`config:${p.alias}`)));select.append(group);
  }
  const group=document.createElement('optgroup');group.label=t('ssh.savedGroup');
  settings.profiles.forEach((p,i) => group.append(new Option(p.name || `${p.username}@${p.host}`,String(i))));select.append(group);
}
function showConfig() {
  $('config-info').textContent = configError ? t('ssh.configReadFailed', { reason: configError.message }) :
    configResult ? t('ssh.configLoaded', { file: configResult.file, count: configResult.hosts.length }) : '';
  profilesList();
}
async function loadConfig() {
  try { configResult = await api.listConfig(); configError = null; }
  catch (e) { configResult = null; configError = e; }
  showConfig();
}
$('config-refresh').onclick = loadConfig;
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
  if(value.startsWith('config:')) {const p=configResult?.hosts.find(p=>p.alias===value.slice(7));if(p)fillProfile({name:p.alias,host:p.alias,port:p.port,username:p.username,auth:'config'});}
  else {const p=settings.profiles[Number(value)];if(value!=='' && p)fillProfile(p);}
};
$('auth').onchange = authFields;
$('key-choose').onclick = async () => { try { const file = await api.chooseKey(); if (file) $('key-path').value = file; } catch(e) { report(e); } };
$('connect-form').onsubmit = async e => {
  e.preventDefault(); const p = { name:$('profile-name').value.trim(), host:$('host').value.trim(), port:Number($('port').value), username:$('username').value.trim(), auth:$('auth').value, keyPath:$('key-path').value, password:$('password').value, passphrase:$('passphrase').value };
  if (p.auth === 'key' && !p.keyPath) { $('connect-error').textContent = t('ssh.requireKey'); return; }
  $('connect-submit').disabled = true;
  try {
    if ($('save-profile').checked && p.auth!=='config') {
      const clean = { name:p.name,host:p.host,port:p.port,username:p.username,auth:p.auth };
      const i = settings.profiles.findIndex(x => x.host === p.host && x.port === p.port && x.username === p.username);
      if (i >= 0) settings.profiles[i] = clean; else settings.profiles.push(clean);
      await persist();
    }
    closeCredentialDialog($('connect-dialog'));await startSession(p);
  } catch (err) { $('connect-error').textContent = err.message; } finally { $('connect-submit').disabled = false; }
};
$('delete-profile').onclick = async () => { const value = $('saved-profile').value; if (!value || value.startsWith('config:')) return; settings.profiles.splice(Number(value),1); try { await persist(); profilesList(); } catch(e) { report(e); } };
for (const id of ['new-tab','welcome-connect']) $(id).onclick = () => openConnect();
const localDialog = $('local-dialog');
for (const id of ['new-local', 'welcome-local']) $(id).onclick = () => localDialog.showModal();
localDialog.addEventListener('close', () => current()?.term.focus());
$('local-form').onsubmit = event => {
  event.preventDefault();
  const shell = event.submitter.value;
  localDialog.close();
  void startSession({ shell, name: event.submitter.textContent });
};
$('reconnect').onclick = () => { const s = current(); if (s && !s.profile.shell) openConnect(s.profile); };
function checkedSplitKeys() {
  return [...splitChoices.querySelectorAll('input:checked')].map(input => Number(input.value));
}
function updateSplitApply() { $('split-apply').disabled = checkedSplitKeys().length < 2; }
function renderSplitChoices(selected) {
  $('split-end').hidden = !split;
  for (const label of splitChoices.querySelectorAll('label')) label.remove();
  for (const key of tabStrip.order()) {
    const session = sessions.get(key);
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox'; checkbox.value = String(key); checkbox.checked = selected.includes(key);
    const label = document.createElement('label');
    label.className = 'checkbox';
    label.append(checkbox, session.label.textContent);
    splitChoices.append(label);
  }
  updateSplitApply();
}
$('split-open').onclick = () => {
  const order = tabStrip.order(), activeIndex = order.indexOf(active);
  $('split-direction').value = split?.direction || 'columns';
  renderSplitChoices(split?.keys || [active, order[activeIndex + 1] ?? order[activeIndex - 1]]);
  splitDialog.showModal();
};
splitChoices.onchange = updateSplitApply;
$('split-form').onsubmit = event => {
  event.preventDefault();
  const selected = checkedSplitKeys().filter(key => sessions.has(key));
  if (selected.length < 2) return;
  const retained = (split?.keys || []).filter(key => selected.includes(key));
  split = {
    keys: [...retained, ...selected.filter(key => !retained.includes(key))],
    direction: $('split-direction').value === 'rows' ? 'rows' : 'columns'
  };
  splitDialog.close();
  activate(selected.includes(active) ? active : split.keys[0]);
};
$('split-end').onclick = () => {
  split = null;
  splitDialog.close();
  activate(active);
};
document.querySelectorAll('[data-close]').forEach(button => button.onclick = () => {const dialog=$(button.dataset.close);if(dialog.id==='connect-dialog'){closeCredentialDialog(dialog);requestInputRecovery();}else dialog.close();});
$('connect-dialog').addEventListener('cancel',event=>{event.preventDefault();closeCredentialDialog($('connect-dialog'));requestInputRecovery();});
function settingsFields(o) { for (const [id,key] of [['font-latin','latin'],['font-cjk','cjk'],['font-math','math'],['font-emoji','emoji'],['font-fallback','fallback'],['font-size','fontSize'],['line-height','lineHeight'],['scrollback','scrollback'],['renderer','renderer'],['unicode','unicode']]) $(id).value = o[key]; $('cursor-blink').checked = o.cursorBlink; }
function readFields() { return sanitizeOptions({ ...options,fontPresetVersion:2,latin:$('font-latin').value,cjk:$('font-cjk').value,math:$('font-math').value,emoji:$('font-emoji').value,fallback:$('font-fallback').value,fontSize:$('font-size').value,lineHeight:$('line-height').value,scrollback:$('scrollback').value,renderer:$('renderer').value,unicode:$('unicode').value,cursorBlink:$('cursor-blink').checked }); }
$('settings-open').onclick = () => { settingsFields(options); $('language').value = locale; $('settings-error').textContent = ''; $('settings-dialog').showModal(); };
$('settings-reset').onclick = () => { settingsFields(defaults); };
$('settings-form').onsubmit = async e => {
  e.preventDefault(); const next = readFields();
  try {
    const nextLocale = normalizeLocale($('language').value);
    const updated = { ...settings, appearance: next, locale: nextLocale };
    await api.saveSettings(updated);
    settings = updated; options = next;
    if (locale !== nextLocale) applyLocale(nextLocale);
    applyAppearance(); await applyFonts();
    // Load local font aliases before measuring xterm's cell width.
    await document.fonts.load(`${options.fontSize}px ${fontFamily}`, `A${cjkSample}🥳`).catch(() => {}); await document.fonts.ready;
    for (const s of sessions.values()) { releaseGPU(s); s.gpuFailed = false; Object.assign(s.term.options, {fontFamily,fontSize:options.fontSize,lineHeight:options.lineHeight,scrollback:options.scrollback,cursorBlink:options.cursorBlink}); s.term.unicode.activeVersion = options.unicode === '11' ? '11' : '15-graphemes'; }
    $('settings-dialog').close(); fitVisible(); attachGPU(current()); status();
  } catch(e) { $('settings-error').textContent = e.message; }
};
new ResizeObserver(requestFit).observe($('workspace'));
function search(back = false) {
  const s = current(); if (!s) return;
  const query = $('find-input').value, result = $('find-result');
  if (!query) { s.search.clearDecorations(); delete result.dataset.i18n; result.textContent = ''; return; }
  const found = s.search[back ? 'findPrevious' : 'findNext'](query, { incremental: false });
  result.dataset.i18n = found ? 'search.found' : 'search.notFound';
  result.textContent = t(result.dataset.i18n);
}
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
  try { const { render } = await import('./markdown.js'); if (version === markdownVersion) render(source, $('markdown-content'), t); } catch(e) { report(e); }
}
function snapshot() {
  const s = current(); if (!s) { $('markdown-source').value = t('reader.empty'); renderMarkdown(); return; }
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
  if (e.ctrlKey && e.key === 'Tab') { e.preventDefault(); const keys = tabStrip.order(); if (keys.length) activate(keys[(keys.indexOf(active) + (e.shiftKey ? keys.length - 1 : 1)) % keys.length]); return; }
  if (!e.ctrlKey || !e.shiftKey) return;
  const k = e.key.toUpperCase();
  const commands = { T:'new-tab', W:null, F:'find-open', M:'markdown-open', C:'copy-output' };
  if (k in commands) { e.preventDefault(); if (k === 'W') current()?.tab.querySelector('.tab-close').click(); else $(commands[k]).click(); }
  if (k === 'V' && current()?.state === 'ready') {
    e.preventDefault(); await current().clipboard.paste();
  }
});
try { settings = await api.loadSettings(); } catch (e) { report(e); }
options = sanitizeOptions(settings.appearance); settings.appearance = options;
applyLocale(settings.locale);
applyAppearance();
await applyFonts();
await loadConfig();
status();
