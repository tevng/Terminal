const { test } = require('node:test');
const assert = require('node:assert/strict');
const { generateKeyPairSync } = require('node:crypto');
const { once } = require('node:events');
const { Server } = require('ssh2');
const { Sessions, validateProfile, dimensions } = require('../electron/ssh.cjs');
const {ConfigStore}=require('../electron/config.cjs');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),net=require('node:net');
const key = generateKeyPairSync('rsa', { modulusLength:2048 }).privateKey.export({type:'pkcs1',format:'pem'});
const waitUntil = async (check, timeout=8000) => { const end=Date.now()+timeout; while (!check()) { if(Date.now()>end) throw Error('Timed out'); await new Promise(r=>setTimeout(r,10)); } };
test('reject malformed connection and size inputs', () => {
  assert.throws(()=>validateProfile({host:'host\nanything',port:22,username:'user'}));
  assert.throws(()=>validateProfile({host:'localhost',port:0,username:'user'}));
  assert.throws(()=>dimensions(1000000,24));
  assert.deepEqual(dimensions(80,24),{cols:80,rows:24});
});
test('real SSH: UTF-8, truecolor, PTY resize, input, output backpressure, cleanup', {timeout:20000}, async t => {
  let serverChannel, pty, resize, received = '';
  const connections = new Set();
  const server = new Server({hostKeys:[key]}, client => {
    connections.add(client); client.on('error',()=>{}); client.on('close',()=>connections.delete(client));
    client.on('authentication', ctx => ctx.method === 'password' && ctx.password === 'secret' ? ctx.accept() : ctx.reject());
    client.on('ready',()=>client.on('session',accept=>{
      const session=accept();
      session.on('pty',(accept,_reject,info)=>{pty=info;accept();});
      session.on('env',accept=>accept?.());
      session.on('window-change',(accept,_reject,info)=>{resize=info;accept?.();});
      session.on('shell',accept=>{serverChannel=accept();serverChannel.on('data',d=>{received+=d.toString();});serverChannel.write('你好 🥳\r\n\x1b[38;2;120;220;180mtruecolor\x1b[0m\r\n');});
    }));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  let manager, id; const events=[]; let autoAck=false, trusted=false;
  manager=new Sessions({send:event=>{events.push(event);if(autoAck && event.type==='data')setImmediate(()=>manager.ack(event.id,event.seq));}, verify:async (p,hash)=>{trusted=hash.length===64;return true;}});
  t.after(()=>{manager.closeAll();for(const c of connections)c.end();server.close();});
  id=await manager.connect({host:'127.0.0.1',port:server.address().port,username:'test',auth:'password',password:'secret'},{cols:96,rows:30});
  await waitUntil(()=>events.some(e=>e.type==='data'));
  assert.equal(trusted,true); assert.equal(pty.term,'xterm-256color');assert.equal(pty.cols,96);
  const first=events.find(e=>e.type==='data'); assert.match(Buffer.from(first.data).toString(),/你好 🥳/);
  serverChannel.write('SECOND'); await new Promise(r=>setTimeout(r,120));
  assert.equal(events.filter(e=>e.type==='data').length,1,'output stops until renderer ack');
  manager.ack(id,first.seq+1);await new Promise(r=>setTimeout(r,40));assert.equal(events.filter(e=>e.type==='data').length,1,'wrong ack cannot resume');
  autoAck=true;manager.ack(id,first.seq);
  await waitUntil(()=>events.filter(e=>e.type==='data').length===2);
  manager.resize(id,120,44);await waitUntil(()=>resize);assert.equal(resize.rows,44);assert.equal(resize.cols,120);
  manager.input(id,'echo 测试\r');await waitUntil(()=>received.includes('测试'));
  const flood=Buffer.from(('context 中文 🚀 '+'.'.repeat(80)+'\r\n').repeat(30000));
  const before=events.filter(e=>e.type==='data').reduce((n,e)=>n+e.data.length,0);
  serverChannel.write(flood);
  await waitUntil(()=>events.filter(e=>e.type==='data').reduce((n,e)=>n+e.data.length,0)>=before+flood.length,10000);
  const output=Buffer.concat(events.filter(e=>e.type==='data').map(e=>Buffer.from(e.data))).toString();
  assert.equal(output.split('context 中文 🚀').length-1,30000);
  manager.close(id);assert.equal(manager.items.size,0);
});
test('untrusted host is refused before authentication', {timeout:10000},async t=>{
  let authenticated=false; const clients=[];
  const server=new Server({hostKeys:[key]},c=>{clients.push(c);c.on('error',()=>{});c.on('authentication',ctx=>{authenticated=true;ctx.accept();});});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const events=[], manager=new Sessions({send:e=>events.push(e),verify:async()=>false});
  t.after(()=>{manager.closeAll();clients.forEach(c=>c.end());server.close();});
  await manager.connect({host:'127.0.0.1',port:server.address().port,username:'u',auth:'password',password:'p'},{cols:80,rows:24});
  await waitUntil(()=>events.some(e=>e.type==='error'));
  assert.equal(authenticated,false);assert.match(events.find(e=>e.type==='error').message,/verification/i);
});
test('SSH config connects with encrypted IdentityFile through verified ProxyJump', {timeout:15000},async t=>{
  const home=await fs.mkdtemp(path.join(os.tmpdir(),'silk-jump-'));await fs.mkdir(path.join(home,'.ssh'));
  const {createPrivateKey}=require('node:crypto'),{utils}=require('ssh2');
  await fs.writeFile(path.join(home,'.ssh','key'),createPrivateKey(key).export({type:'pkcs1',format:'pem',cipher:'aes-256-cbc',passphrase:'unlock'}));
  const allowed=utils.parseKey(key),clients=[],sockets=[],servers=[];
  let targetInput='',forwarded=false;
  function makeServer(jump) {
    const server=new Server({hostKeys:[key]},c=>{
      clients.push(c);c.on('error',()=>{});
      c.on('authentication',ctx=>{
        if(ctx.method==='publickey' && ctx.key.data.equals(allowed.getPublicSSH()) && (!ctx.signature || allowed.verify(ctx.blob,ctx.signature,ctx.hashAlgo)===true))ctx.accept();else ctx.reject();
      });
      c.on('ready',()=>{
        if(jump)c.on('tcpip',(accept,reject,info)=>{
          forwarded=true;const socket=net.connect(info.destPort,info.destIP);sockets.push(socket);
          socket.on('connect',()=>{const stream=accept();stream.pipe(socket).pipe(stream);});socket.on('error',()=>reject());
        });
        else c.on('session',accept=>{
          const session=accept();session.on('pty',accept=>accept());session.on('env',accept=>accept?.());
          session.on('shell',accept=>{const ch=accept();ch.on('data',d=>{targetInput+=d.toString();});ch.write('JUMP_OK 中文 🥳\r\n');});
        });
      });
    });servers.push(server);return server;
  }
  const jump=makeServer(true),target=makeServer(false);
  await Promise.all([jump,target].map(s=>new Promise(r=>s.listen(0,'127.0.0.1',r))));
  await fs.writeFile(path.join(home,'.ssh','config'),`Host gateway\n HostName 127.0.0.1\n Port ${jump.address().port}\nHost final\n HostName 127.0.0.1\n Port ${target.address().port}\n ProxyJump gateway\nHost *\n User tester\n IdentityFile ~/.ssh/missing\n IdentityFile ~/.ssh/key\n IdentitiesOnly yes\n`);
  const store=new ConfigStore({home});await store.load();const plan=store.plan('final').map(p=>({...p,auth:'config',passphrase:'unlock'}));
  const events=[],verified=[],manager=new Sessions({send:e=>{events.push(e);if(e.type==='data')setImmediate(()=>manager.ack(e.id,e.seq));},verify:async p=>{verified.push(p.port);return true;},readKey:async(file,fromConfig)=>{assert.equal(fromConfig,true);return fs.readFile(file);}});
  t.after(async()=>{manager.closeAll();sockets.forEach(s=>s.destroy());clients.forEach(c=>c.end());servers.forEach(s=>s.close());await fs.rm(home,{recursive:true,force:true});});
  const id=await manager.connect({...plan.at(-1),plan},{cols:80,rows:24});
  await waitUntil(()=>events.some(e=>e.type==='data'));
  assert.equal(forwarded,true);assert.deepEqual(verified,[jump.address().port,target.address().port]);
  assert.match(Buffer.concat(events.filter(e=>e.type==='data').map(e=>Buffer.from(e.data))).toString(),/JUMP_OK 中文 🥳/);
  manager.input(id,'through jump\r');await waitUntil(()=>targetInput.includes('through jump'));manager.close(id);assert.equal(manager.items.size,0);
});
for(const mode of ['password','keyboard-interactive','cancel'])test(`SSH config interactive fallback: ${mode}`,{timeout:10000},async t=>{
  const clients=[],events=[],requests=[];let authCount=0;
  const server=new Server({hostKeys:[key]},c=>{
    clients.push(c);c.on('error',()=>{});
    c.on('authentication',ctx=>{
      if(ctx.method==='password' && mode==='password' && ctx.password==='session-secret'){authCount++;ctx.accept();}
      else if(ctx.method==='keyboard-interactive' && mode==='keyboard-interactive')ctx.prompt([{prompt:'One-time code:',echo:false}],answers=>{if(answers[0]==='123456'){authCount++;ctx.accept();}else ctx.reject(['keyboard-interactive']);});
      else ctx.reject(mode==='keyboard-interactive'?['keyboard-interactive']:['publickey','password']);
    });
    c.on('ready',()=>c.on('session',accept=>{const session=accept();session.on('pty',accept=>accept());session.on('env',accept=>accept?.());session.on('shell',accept=>{accept().write('AUTH_OK\r\n');});}));
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const manager=new Sessions({send:e=>events.push(e),verify:async()=>true,readKey:async()=>{const e=Error('missing');e.code='ENOENT';throw e;},requestAuth:async request=>{requests.push(request);if(mode==='cancel')throw Error('用户取消认证');return [mode==='password'?'session-secret':'123456'];}});
  t.after(()=>{manager.closeAll();clients.forEach(c=>c.end());server.close();});
  const id=await manager.connect({host:'127.0.0.1',port:server.address().port,username:'test',alias:'desktop',auth:'config',keyPaths:['missing'],agent:mode==='password'?path.join(os.tmpdir(),'silk-agent-not-running'):null},{cols:80,rows:24});
  await waitUntil(()=>events.some(e=>e.type===(mode==='cancel'?'error':'data')));
  assert.equal(requests.length,1);assert.equal(requests[0].alias,'desktop');assert.equal(requests[0].id,id);assert.equal(requests[0].prompts[0].echo,false);
  if(mode==='cancel'){assert.equal(authCount,0);assert.match(events.find(e=>e.type==='error').message,/用户取消/);assert.equal(manager.items.size,0);}
  else{assert.equal(authCount,1);assert.equal(requests[0].kind,mode);assert.match(Buffer.from(events.find(e=>e.type==='data').data).toString(),/AUTH_OK/);}
});
test('remote shell EOF closes the SSH session once without waiting for transport close',{timeout:10000},async t=>{
  const clients=[],events=[];
  const server=new Server({hostKeys:[key]},c=>{
    clients.push(c);c.on('error',()=>{});c.on('authentication',ctx=>ctx.accept());
    c.on('ready',()=>c.on('session',accept=>{const s=accept();s.on('pty',accept=>accept());s.on('env',accept=>accept?.());s.on('shell',accept=>{const channel=accept();channel.exit(0);channel.end('bye\r\n');});}));
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const manager=new Sessions({send:e=>{events.push(e);if(e.type==='data')setImmediate(()=>manager.ack(e.id,e.seq));},verify:async()=>true});
  t.after(()=>{manager.closeAll();clients.forEach(c=>c.end());server.close();});
  const id=await manager.connect({host:'127.0.0.1',port:server.address().port,username:'test',auth:'password',password:'test'},{cols:80,rows:24});
  await waitUntil(()=>events.some(e=>e.type==='closed'));
  manager.close(id);assert.equal(manager.items.size,0);assert.equal(events.filter(e=>e.type==='closed').length,1);
});
