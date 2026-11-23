const { app, BrowserWindow, ipcMain, dialog, session, clipboard } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const { pathToFileURL } = require('node:url');
const { Sessions, validateProfile } = require('./ssh.cjs');
const { ConfigStore } = require('./config.cjs');
const {existsSync}=require('node:fs');
const legacyData=['Silk Terminal','silk-ssh-terminal'].map(name=>path.join(app.getPath('appData'),name)).find(existsSync);
app.setPath('userData',process.env.SILK_USER_DATA || legacyData || path.join(app.getPath('appData'),'Terminal'));
app.setName('Terminal');
if(process.platform==='win32')app.setAppUserModelId('local.terminal.ssh');
let win, ssh;
const authRequests=new Map();
function requestAuth(details) {
  return new Promise((resolve,reject)=>{
    if(!win || win.isDestroyed())return reject(Error('认证窗口已关闭'));
    const requestId=require('node:crypto').randomUUID();
    const timer=setTimeout(()=>{authRequests.delete(requestId);win.webContents.send('ssh:event',{id:details.id,type:'auth-cancel',requestId});reject(Error('等待认证输入超时'));},120000);
    authRequests.set(requestId,{id:details.id,resolve,reject,timer});
    win.webContents.send('ssh:event',{...details,type:'auth',requestId});
  });
}
const keyGrants = new Set();
const configStore = new ConfigStore(process.env.SILK_SSH_HOME ? {home:process.env.SILK_SSH_HOME} : {});
const indexURL = pathToFileURL(path.join(__dirname, '../dist/index.html')).href;
const storePath = () => path.join(app.getPath('userData'), 'settings.json');
const hostsPath = () => path.join(app.getPath('userData'), 'known-hosts.json');
async function readJSON(file, fallback) { try { return JSON.parse(await fs.readFile(file, 'utf8')); } catch (e) { if (e.code === 'ENOENT') return fallback; throw Error(`无法读取设置: ${e.message}`); } }
async function writeJSON(file, data) { await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file + '.tmp', JSON.stringify(data, null, 2), { mode: 0o600 }); await fs.rename(file + '.tmp', file); }
function trusted(event) { if (!win || event.sender !== win.webContents || event.senderFrame?.url !== indexURL) throw Error('拒绝未知 IPC 来源'); }
function handle(name, fn) { ipcMain.handle(name, (event, ...args) => { trusted(event); return fn(...args); }); }
let verification = Promise.resolve();
function verify(profile, fingerprint) {
  const next = verification.then(async () => {
    if (!win || win.isDestroyed()) return false;
    const hosts = await readJSON(hostsPath(), {}), host = `[${profile.host}]:${profile.port}`;
    if (hosts[host] === fingerprint) return true;
    const changed = Boolean(hosts[host]);
    const result = await dialog.showMessageBox(win, {
      type: changed ? 'warning' : 'question', title: changed ? 'SSH 主机密钥已改变' : '验证 SSH 主机',
      message: `${host}\nSHA256:${Buffer.from(fingerprint, 'hex').toString('base64').replace(/=+$/, '')}`,
      detail: changed ? '与本地记录不一致。请向管理员核实；确认更换服务器后才更新密钥。' : '首次连接，请通过可信渠道核对服务器指纹。',
      buttons: ['取消连接', changed ? '确认并更新密钥' : '信任并保存'], defaultId: 0, cancelId: 0, noLink: true
    });
    if (result.response !== 1) return false;
    hosts[host] = fingerprint; await writeJSON(hostsPath(), hosts); return true;
  });
  verification = next.catch(() => {}); return next;
}
app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  win = new BrowserWindow({ width: 1360, height: 880, minWidth: 860, minHeight: 560, backgroundColor: '#101318', title: 'Terminal', icon:path.join(__dirname,'../dist/terminal.ico'),
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: false } });
  win.setMenuBarVisibility(false);
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', event => event.preventDefault());
  ssh = new Sessions({ send: payload => {
    if(payload.type==='closed')for(const [requestId,request]of authRequests)if(request.id===payload.id){clearTimeout(request.timer);authRequests.delete(requestId);request.reject(Error('会话已关闭'));}
    if (!win.isDestroyed()) win.webContents.send('ssh:event', payload);
  }, verify,requestAuth,
    agent: process.env.SSH_AUTH_SOCK || (process.platform === 'win32' ? '\\\\.\\pipe\\openssh-ssh-agent' : undefined),
    readKey: async (file, fromConfig=false) => { if (!fromConfig && !keyGrants.has(file)) throw Error('请通过文件选择器授权私钥文件'); const stat = await fs.stat(file); if (!stat.isFile() || stat.size > 1024 * 1024) throw Error('私钥文件过大或无效'); return fs.readFile(file); }
  });
  handle('config:list',()=>configStore.list());
  handle('input:restore-focus',async()=>{
    if(!win.isFocused())return false;
    const contents=win.webContents;
    // A DOM textarea may be focused while the Windows text input client still
    // carries the previous password field's IME-disabled state. Reattach the
    // native view after Blink has focused a regular text input.
    win.blurWebView();
    await new Promise(resolve=>setImmediate(resolve));
    if(win.isDestroyed() || !win.isFocused() || contents.isDestroyed())return false;
    win.focusOnWebView();return true;
  });
  handle('ssh:auth-response',(requestId,answers)=>{
    const request=authRequests.get(requestId);if(!request)return;
    if(answers!==null && (!Array.isArray(answers)||answers.length>16||answers.some(s=>typeof s!=='string'||s.length>4096)))throw Error('无效认证响应');
    clearTimeout(request.timer);authRequests.delete(requestId);
    if(answers===null)request.reject(Error('用户取消认证'));else request.resolve(answers);
  });
  handle('ssh:connect', async (p, size) => {
    if(p?.auth==='config') {
      if(typeof p.host!=='string' || p.host.length>253)throw Error('无效 SSH config 别名');
      await configStore.load();
      const plan=configStore.plan(p.host).map(hop=>({...hop,auth:'config',password:String(p.password||''),passphrase:String(p.passphrase||'')}));
      return ssh.connect({...plan.at(-1),plan},size);
    }
    // Renderer cannot submit arbitrary key grants, agents, or a connection plan.
    return ssh.connect({host:p.host,port:p.port,username:p.username,auth:p.auth,keyPath:p.keyPath,password:p.password,passphrase:p.passphrase},size);
  });
  handle('ssh:close', id => ssh.close(id));
  for (const action of ['input', 'resize', 'ack']) ipcMain.on(`ssh:${action}`, (event, ...args) => { try { trusted(event); ssh[action](...args); } catch {} });
  handle('key:choose', async () => {
    const r = await dialog.showOpenDialog(win, { title: '选择 SSH 私钥', properties: ['openFile'] });
    if (r.canceled) return null; keyGrants.add(r.filePaths[0]); return r.filePaths[0];
  });
  handle('clipboard:read', async () => { const text=await clipboard.readText(); if (Buffer.byteLength(text)>1024*1024) throw Error('粘贴内容超过 1 MiB'); return text; });
  handle('clipboard:write', async text => { if (typeof text !== 'string' || Buffer.byteLength(text)>1024*1024) throw Error('复制内容超过 1 MiB'); await clipboard.writeText(text); });
  handle('settings:load', () => readJSON(storePath(), { profiles: [], appearance: {} }));
  let saving = Promise.resolve();
  handle('settings:save', data => {
    if (!data || !Array.isArray(data.profiles) || data.profiles.length > 100) throw Error('无效设置');
    const profiles = data.profiles.map(p => ({ ...validateProfile(p), name: String(p.name || '').slice(0, 80), auth: ['key', 'agent', 'password','config'].includes(p.auth) ? p.auth : 'key' }));
    const appearance = data.appearance || {};
    if (JSON.stringify(appearance).length > 20000) throw Error('设置过大');
    saving = saving.catch(() => {}).then(() => writeJSON(storePath(), { profiles, appearance })); return saving;
  });
  win.on('closed', () => ssh.closeAll());
  win.loadURL(indexURL);
});
app.on('window-all-closed', () => app.quit());
