const { Client, utils } = require('ssh2');
const { randomUUID } = require('node:crypto');

function validateProfile(p) {
  if (!p || typeof p.host !== 'string' || !p.host.trim() || p.host.length > 253 || /[\s\x00-\x1f]/.test(p.host)) throw Error('请输入有效主机名');
  if (typeof p.username !== 'string' || !p.username.trim() || p.username.length > 128 || /[\x00-\x1f]/.test(p.username)) throw Error('请输入用户名');
  if (!Number.isInteger(p.port) || p.port < 1 || p.port > 65535) throw Error('端口必须为 1–65535');
  return { host: p.host.trim(), port: p.port, username: p.username.trim() };
}
function dimensions(cols, rows) {
  if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 2 || cols > 1000 || rows < 1 || rows > 1000) throw Error('无效终端尺寸');
  return { cols, rows };
}

class Sessions {
  constructor({ send, verify, readKey, agent, requestAuth }) {
    this.items = new Map(); this.send = send; this.verify = verify; this.readKey = readKey; this.agent = agent;this.requestAuth=requestAuth;
  }
  async connect(p, size) {
    const profile = validateProfile(p); dimensions(size.cols, size.rows);
    if (this.items.size >= 24) throw Error('最多同时打开 24 个会话');
    const id = randomUUID(), client = new Client();
    const s = { id, client, clients:[client], channel: null, pending: 0, bytes: 0, closed: false, seq: 0 };
    this.items.set(id, s);
    const emit = (type, extra = {}) => this.send({ id, type, ...extra });
    const failure=e=>e.level==='client-authentication' ? `SSH 认证失败：${s.authHost||profile.username+'@'+profile.host}。${s.authHint||'密钥或密码未被服务器接受。'}` : e.message;
    client.on('error', e => { if(e.level==='agent' && s.authFallback){s.authHint='SSH Agent 不可用，已继续尝试其他认证方式。';return;}emit('error', { message: failure(e) }); this.close(id); });
    client.on('close', () => this.close(id));
    client.on('ready', () => {
      client.shell({ term: 'xterm-256color', cols: size.cols, rows: size.rows, modes: { IUTF8: 1 } }, { env: { COLORTERM: 'truecolor', TERM_PROGRAM: 'SilkTerminal' } }, (err, channel) => {
        if (err) { emit('error', { message: err.message }); return this.close(id); }
        if (s.closed) { channel.close(); return; }
        s.channel = channel;
        channel.on('data', data => {
          // A single SSH packet is in flight to the renderer. Resume only after xterm parsed it.
          channel.pause();
          s.pending = ++s.seq; s.bytes += data.length;
          emit('data', { data: new Uint8Array(data), seq: s.pending });
        });
        channel.on('error', e => { emit('error', { message: e.message }); this.close(id); });
        channel.stderr.on('data', () => {}); // PTY merges stdout/stderr; drain nonconforming server extended data.
        channel.on('close', () => this.close(id));
        channel.once('end', () => this.close(id));
        emit('ready');
      });
    });
    setImmediate(async () => { try {
      const plan=p.plan || [p]; let socket;
      for(let i=0;i<plan.length;i++) {
        const hop=plan[i], hopProfile=validateProfile(hop), final=i===plan.length-1;
        const connection=final?client:new Client();if(!final){s.clients.push(connection);connection.on('error',e=>{if(e.level==='agent' && hop.auth==='config')return;emit('error',{message:`跳板 SSH: ${failure(e)}`});this.close(id);});}
        s.authHost=`${hop.username}@${hop.alias||hop.host}`;
        s.authFallback=hop.auth==='config';
        const auth=await this.authOptions(hop,s);
        if(s.closed)return;
        const config={...hopProfile,...auth,readyTimeout:Math.max(this.requestAuth?120000:1000,Math.min(hop.readyTimeout||30000,120000)),
          keepaliveInterval:Math.max(0,Math.min(hop.keepaliveInterval??15000,300000)),keepaliveCountMax:3,hostHash:'sha256',
          hostVerifier:(hash,done)=>{Promise.resolve(this.verify(hopProfile,hash)).then(ok=>done(!s.closed && ok),()=>done(false));}
        };
        if(socket)config.sock=socket;
        if(final)connection.connect(config);
        else {
          await new Promise((resolve,reject)=>{
            connection.on('error',e=>{if(e.level!=='agent'||hop.auth!=='config')reject(e);});connection.once('ready',resolve);
            connection.once('close',()=>{reject(Error('跳板连接已关闭'));this.close(id);});connection.connect(config);
          });
          const next=validateProfile(plan[i+1]);
          socket=await new Promise((resolve,reject)=>connection.forwardOut('127.0.0.1',0,next.host,next.port,(err,stream)=>err?reject(err):resolve(stream)));
        }
      }
    } catch(e) { emit('error',{message:e.message});this.close(id); } });
    return id;
  }
  async authOptions(p, session) {
      const auth = {};
      if(p.auth==='config') {
        const methods=[], keyErrors=[];
        for(const file of p.keyPaths) {
          try {
            const data=await this.readKey(file,true), key=utils.parseKey(data,p.passphrase||undefined);
            if(key instanceof Error) {
              if(this.requestAuth && session && /encrypted|passphrase/i.test(key.message)) {
                const answer=await this.requestAuth({id:session.id,kind:'passphrase',host:p.host,alias:p.alias,username:p.username,instructions:`解锁私钥：${file}`,prompts:[{prompt:'私钥口令',echo:false}]});
                if(session.closed)throw Error('会话已关闭');
                const unlocked=utils.parseKey(data,answer[0]);if(unlocked instanceof Error){keyErrors.push(unlocked.message);continue;}
                methods.push({type:'publickey',username:p.username,key:Array.isArray(unlocked)?unlocked[0]:unlocked});continue;
              }
              keyErrors.push(key.message);continue;
            }
            methods.push({type:'publickey',username:p.username,key:Array.isArray(key)?key[0]:key});
          } catch(e) {if(/用户取消|会话已关闭/.test(e.message))throw e;if(e.code!=='ENOENT')keyErrors.push(e.message);}
        }
        const agent=p.agent===null?null:p.agent||this.agent;
        if(agent && !p.identitiesOnly)methods.push({type:'agent',username:p.username,agent});
        if(p.password)methods.push({type:'password',username:p.username,password:p.password});
        if(p.preferredAuthentications) {
          const order=p.preferredAuthentications.split(',');
          const method=m=>m.type==='agent'?'publickey':m.type;
          methods.sort((a,b)=>order.indexOf(method(a))-order.indexOf(method(b)));
          for(let i=methods.length-1;i>=0;i--)if(!order.includes(method(methods[i])))methods.splice(i,1);
        }
        if(session)session.authHint=keyErrors.length?`部分私钥无法加载：${keyErrors.join('；')}`:'服务器未接受已尝试的密钥或密码。';
        if(!this.requestAuth || !session) {
          if(!methods.length)throw Error(`SSH config 未提供可用认证。${keyErrors[0]||'请配置 IdentityFile/Agent 或输入密码。'}`);
          return {authHandler:['none',...methods]};
        }
        const queue=['none',...methods];let passwordPrompts=0,interactiveTried=false;
        const allowed=type=>!p.preferredAuthentications || p.preferredAuthentications.split(',').includes(type);
        return {authHandler:(offered,partial,callback)=>{
          if(session.closed)return callback(false);
          let next;
          while(queue.length) {
            next=queue.shift();const type=typeof next==='string'?next:next.type==='agent'?'publickey':next.type;
            if(!offered || offered.includes(type)){callback(next);return;}
          }
          if(offered?.includes('password') && allowed('password') && passwordPrompts<3) {
            passwordPrompts++;
            this.requestAuth({id:session.id,kind:'password',host:p.host,alias:p.alias,username:p.username,
              instructions:passwordPrompts===1?'密钥未完成认证，请输入此主机的登录密码。':'上一次密码未通过，请重试。',prompts:[{prompt:'登录密码',echo:false}]}).then(answers=>{
              callback(session.closed?false:{type:'password',username:p.username,password:answers[0]});
            },e=>{session.authHint=e.message;callback(false);});return;
          }
          if(offered?.includes('keyboard-interactive') && allowed('keyboard-interactive') && !interactiveTried) {
            interactiveTried=true;
            callback({type:'keyboard-interactive',username:p.username,prompt:(name,instructions,lang,prompts,finish)=>{
              if(!prompts.length){finish([]);return;}
              this.requestAuth({id:session.id,kind:'keyboard-interactive',host:p.host,alias:p.alias,username:p.username,instructions:[name,instructions].filter(Boolean).join('\n'),prompts}).then(answers=>{if(!session.closed)finish(answers);},()=>this.close(session.id));
            }});return;
          }
          callback(false);
        }};
      } else if (p.auth === 'key') {
        auth.privateKey = await this.readKey(p.keyPath);
        if (p.passphrase) auth.passphrase = p.passphrase;
      } else if (p.auth === 'agent') {
        if (!this.agent) throw Error('未检测到 SSH agent；请选择私钥或密码');
        auth.agent = this.agent;
      } else if (p.auth === 'password') auth.password = String(p.password || '');
      else throw Error('未知认证方式');
      return auth;
  }
  ack(id, seq) {
    const s = this.items.get(id);
    if (!s || !s.channel || !s.pending || seq !== s.pending) return;
    s.pending = 0; s.channel.resume();
  }
  input(id, data, binary = false) {
    const s = this.items.get(id);
    if (typeof data !== 'string' || Buffer.byteLength(data) > 1024 * 1024) throw Error('输入超过 1 MiB 限制');
    if (!s?.channel || s.closed) return;
    if (s.channel.writableLength > 2 * 1024 * 1024) {
      this.send({ id, type: 'notice', message: '远端输入阻塞，本次输入未发送，请等待后重试。' }); return;
    }
    s.channel.write(binary === true ? Buffer.from(data, 'latin1') : data);
  }
  resize(id, cols, rows) { dimensions(cols, rows); this.items.get(id)?.channel?.setWindow(rows, cols, 0, 0); }
  close(id) {
    const s = this.items.get(id); if (!s || s.closed) return;
    s.closed = true; s.channel?.destroy(); s.clients.forEach(c=>c.end());
    this.items.delete(id);
    this.send({ id, type: 'closed' });
    const timer = setTimeout(() => s.clients.forEach(c=>c.destroy()), 1000); timer.unref();
  }
  closeAll() { for (const id of this.items.keys()) this.close(id); }
}
module.exports = { Sessions, validateProfile, dimensions };
