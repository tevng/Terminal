const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const SSHConfig = require('ssh-config');
const values = value => (Array.isArray(value) ? value : [value]).map(v => typeof v === 'object' ? v.val : v).filter(v => typeof v === 'string');
function matches(patterns, host) {
  let yes = false;
  for (const p of patterns) {
    const negative = p.startsWith('!'), raw = negative ? p.slice(1) : p;
    const re = new RegExp(`^${raw.replace(/[.+^${}()|[\]\\]/g,'\\$&').replace(/\*/g,'.*').replace(/\?/g,'.')}$`,'i');
    if (re.test(host)) { if (negative) return false; yes = true; }
  }
  return yes;
}
class ConfigStore {
  constructor({home=os.homedir(), file=path.join(home,'.ssh','config')}={}) { this.home=home;this.file=file;this.root=path.join(home,'.ssh'); }
  expand(value, tokens={}) {
    let result = value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g,(_m,key)=>process.env[key] || '');
    if (/^~[\\/]/.test(result)) result=path.join(this.home,result.slice(2));
    result=result.replace(/%([%dhnpr])/g,(_m,key)=>key==='%'?'%':key==='d'?this.home:(tokens[key] ?? `%${key}`));
    return result;
  }
  async load() {
    const budget={bytes:0,files:0};
    const read=async(file,stack=[])=>{
      if (stack.length>=8) throw Error('SSH Include 嵌套超过 8 层');
      let real;try {real=await fs.realpath(file);}catch(e){if(e.code==='ENOENT')return [];throw e;}
      if(stack.includes(real.toLowerCase()))throw Error('SSH Include 出现循环引用');
      const stat=await fs.stat(real);budget.bytes+=stat.size;
      if(++budget.files>128 || budget.bytes>1024*1024)throw Error('SSH 配置超过 128 个文件或 1 MiB');
      const ast=SSHConfig.parse(await fs.readFile(real,'utf8')), rows=[];
      const flatten=async nodes=>{
        for(const node of nodes) {
          if(!node.param)continue;
          const record={key:node.param.toLowerCase(),values:values(node.value),criteria:node.criteria};
          rows.push(record);
          if(record.key==='include') {
            record.children=[];
            for(const pattern of record.values) {
              const expanded=this.expand(pattern).replace(/\\/g,'/');
              const files=[];
              for await(const entry of fs.glob(expanded,{cwd:this.root}))files.push(path.resolve(this.root,entry));
              for(const entry of files.sort())record.children.push(...await read(entry,[...stack,real.toLowerCase()]));
            }
          }
          if(node.config)await flatten(node.config);
        }
      };
      await flatten(ast);return rows;
    };
    this.rows=await read(this.file);return this;
  }
  aliases() {
    const names=new Set();
    const visit=rows=>{for(const row of rows){if(row.key==='host')for(const name of row.values)if(!/[*!?]/.test(name))names.add(name);if(row.children)visit(row.children);}};
    visit(this.rows||[]);return [...names];
  }
  compute(alias) {
    const options={}, warnings=[], state={active:true};
    const visit=rows=>{
      for(const row of rows) {
        if(row.key==='host') {state.active=matches(row.values,alias);continue;}
        if(row.key==='match') {
          const criteria=row.criteria||{};
          const supported=Object.keys(criteria).every(k=>['all','host','originalhost','user','localuser'].includes(k));
          if(!supported) {state.active=false;warnings.push('存在暂不支持的 Match 条件（不会执行 Match exec）');continue;}
          state.active=Object.entries(criteria).every(([k,v])=>k==='all'||matches(values(v).flatMap(x=>x.split(',')),k==='user'?(options.user||os.userInfo().username):k==='localuser'?os.userInfo().username:k==='host'?(options.hostname||alias):alias));
          continue;
        }
        if(!state.active)continue;
        if(row.key==='include') {visit(row.children||[]);continue;}
        if(row.key==='identityfile') (options.identityfile ||= []).push(...row.values);
        else if(options[row.key]===undefined)options[row.key]=row.values.join(' ');
      }
    };visit(this.rows||[]);
    const username=options.user||os.userInfo().username, port=Number(options.port||22);
    const tokens={n:alias,h:alias,p:String(port),r:username};
    const host=this.expand(options.hostname||alias,tokens);tokens.h=host;
    const keyPaths=(options.identityfile||['~/.ssh/id_ed25519','~/.ssh/id_ecdsa','~/.ssh/id_rsa']).filter(x=>x!=='none').map(x=>path.resolve(this.home,this.expand(x,tokens)));
    return {host,port,username,keyPaths,alias,agent:options.identityagent==='none'?null:options.identityagent && options.identityagent!=='SSH_AUTH_SOCK'?this.expand(options.identityagent,tokens):undefined,
      identitiesOnly:options.identitiesonly==='yes',preferredAuthentications:options.preferredauthentications,
      proxyJump:options.proxyjump==='none'?null:options.proxyjump, proxyCommand:options.proxycommand==='none'?null:options.proxycommand,
      keepaliveInterval:options.serveraliveinterval===undefined?15000:Number(options.serveraliveinterval)*1000,
      readyTimeout:options.connecttimeout===undefined?30000:Number(options.connecttimeout)*1000,
      warnings:[...new Set(warnings)]};
  }
  plan(alias, chain=[]) {
    if(chain.includes(alias) || chain.length>=8)throw Error('ProxyJump 循环或超过 8 层');
    const p=this.compute(alias);
    if(p.proxyCommand && !p.proxyJump)throw Error('此主机使用 ProxyCommand；当前支持 ProxyJump，请在 SSH config 中改用 ProxyJump');
    if(p.warnings.length)throw Error(p.warnings.join('；'));
    const hops=[];
    if(p.proxyJump)for(const jump of p.proxyJump.split(',')) {
      const m=/^(?:([^@]+)@)?(\[[^\]]+\]|[^:]+)(?::(\d+))?$/.exec(jump.trim());
      if(!m)throw Error('无效 ProxyJump');
      const parts=this.plan(m[2].replace(/^\[|\]$/g,''),[...chain,alias]);
      const last=parts.at(-1);if(m[1])last.username=m[1];if(m[3])last.port=Number(m[3]);hops.push(...parts);
    }
    return [...hops,p];
  }
  async list() {
    await this.load();
    return {file:this.file,hosts:this.aliases().map(alias=>{const p=this.compute(alias);return {alias,host:p.host,port:p.port,username:p.username,hasIdentity:p.keyPaths.length>0,proxyJump:p.proxyJump,warnings:p.warnings};})};
  }
}
module.exports={ConfigStore,matches};
