const { Client, utils } = require('ssh2');
const { randomUUID } = require('node:crypto');
const { english } = require('../i18n/index.cjs');

function validateProfile(p, t = english) {
  if (!p || typeof p.host !== 'string' || !p.host.trim() || p.host.length > 253 || /[\s\x00-\x1f]/.test(p.host)) throw Error(t('ssh.invalidHost'));
  if (typeof p.username !== 'string' || !p.username.trim() || p.username.length > 128 || /[\x00-\x1f]/.test(p.username)) throw Error(t('ssh.invalidUsername'));
  if (!Number.isInteger(p.port) || p.port < 1 || p.port > 65535) throw Error(t('ssh.invalidPort'));
  return { host: p.host.trim(), port: p.port, username: p.username.trim() };
}
function dimensions(cols, rows, t = english) {
  if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 2 || cols > 1000 || rows < 1 || rows > 1000) throw Error(t('terminal.invalidDimensions'));
  return { cols, rows };
}

class Sessions {
  constructor({ send, verify, readKey, agent, requestAuth, t = english }) {
    this.items = new Map(); this.send = send; this.verify = verify; this.readKey = readKey; this.agent = agent;this.requestAuth=requestAuth;
    this.t = t;
  }
  async connect(p, size) {
    const t = this.t;
    const profile = validateProfile(p, t); dimensions(size.cols, size.rows, t);
    if (this.items.size >= 24) throw Error(t('terminal.sessionLimit'));
    const id = randomUUID(), client = new Client();
    const s = { id, client, clients:[client], channel: null, pending: 0, bytes: 0, closed: false, seq: 0 };
    this.items.set(id, s);
    const emit = (type, extra = {}) => this.send({ id, type, ...extra });
    const failure = e => e.level === 'client-authentication' ? t('auth.failed', {
      host: s.authHost || `${profile.username}@${profile.host}`, hint: s.authHint || t('auth.rejected')
    }) : e.message;
    client.on('error', e => { if(e.level==='agent' && s.authFallback){s.authHint=t('auth.agentFallback');return;}emit('error', { message: failure(e) }); this.close(id); });
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
        const hop=plan[i], hopProfile=validateProfile(hop,t), final=i===plan.length-1;
        const connection=final?client:new Client();if(!final){s.clients.push(connection);connection.on('error',e=>{if(e.level==='agent' && hop.auth==='config')return;emit('error',{message:t('ssh.jumpError',{reason:failure(e)})});this.close(id);});}
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
            connection.once('close',()=>{reject(Error(t('ssh.jumpClosed')));this.close(id);});connection.connect(config);
          });
          const next=validateProfile(plan[i+1],t);
          socket=await new Promise((resolve,reject)=>connection.forwardOut('127.0.0.1',0,next.host,next.port,(err,stream)=>err?reject(err):resolve(stream)));
        }
      }
    } catch(e) { emit('error',{message:e.message});this.close(id); } });
    return id;
  }
  async authOptions(p, session) {
      const t = this.t;
      const auth = {};
      if(p.auth==='config') {
        const methods=[], keyErrors=[];
        for(const file of p.keyPaths) {
          let data;
          try {
            data = await this.readKey(file, true);
          } catch (e) {
            if (e.code !== 'ENOENT') keyErrors.push(e.message);
            continue;
          }
          let key = utils.parseKey(data, p.passphrase || undefined);
          if (key instanceof Error && this.requestAuth && session && /encrypted|passphrase/i.test(key.message)) {
            const [passphrase] = await this.requestAuth({
              id: session.id, kind: 'passphrase', host: p.host, alias: p.alias, username: p.username,
              instructions: t('auth.unlockKey', { file }), prompts: [{ prompt: t('auth.passphrase'), echo: false }]
            });
            if (session.closed) throw Error(t('auth.sessionClosed'));
            key = utils.parseKey(data, passphrase);
          }
          if (key instanceof Error) { keyErrors.push(key.message); continue; }
          methods.push({type:'publickey',username:p.username,key:Array.isArray(key)?key[0]:key});
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
        if (session) session.authHint = keyErrors.length ? t('auth.keyErrors', { errors: keyErrors.join(', ') }) : t('auth.rejected');
        if(!this.requestAuth || !session) {
          if (!methods.length) throw Error(t('auth.configUnavailable', { hint: keyErrors[0] || t('auth.configureCredentials') }));
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
              instructions:t(passwordPrompts===1?'auth.enterPassword':'auth.retryPassword'),prompts:[{prompt:t('ssh.password'),echo:false}]}).then(answers=>{
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
        if (!this.agent) throw Error(t('auth.agentUnavailable'));
        auth.agent = this.agent;
      } else if (p.auth === 'password') auth.password = String(p.password || '');
      else throw Error(t('auth.unknownMethod'));
      return auth;
  }
  ack(id, seq) {
    const s = this.items.get(id);
    if (!s || !s.channel || !s.pending || seq !== s.pending) return;
    s.pending = 0; s.channel.resume();
  }
  input(id, data, binary = false) {
    const s = this.items.get(id);
    if (typeof data !== 'string' || Buffer.byteLength(data) > 1024 * 1024) throw Error(this.t('terminal.inputLimit'));
    if (!s?.channel || s.closed) return;
    if (s.channel.writableLength > 2 * 1024 * 1024) {
      this.send({ id, type: 'notice', message: this.t('ssh.inputBlocked') }); return;
    }
    s.channel.write(binary === true ? Buffer.from(data, 'latin1') : data);
  }
  resize(id, cols, rows) { dimensions(cols, rows, this.t); this.items.get(id)?.channel?.setWindow(rows, cols, 0, 0); }
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
