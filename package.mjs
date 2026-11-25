import { cp, mkdir, readFile, writeFile, rename, stat } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { rcedit } from 'rcedit';
const require = createRequire(import.meta.url);
const pkg = JSON.parse(await readFile('package.json','utf8'));
const exe = require('electron');
const target = path.resolve(`release/Terminal-${pkg.version}`);
await mkdir(target, {recursive:true});
await cp(path.dirname(exe),target,{recursive:true});
const appDir = path.join(target,'resources/app');
await mkdir(appDir,{recursive:true});
for (const name of ['electron','dist','i18n']) await cp(name,path.join(appDir,name),{recursive:true});
await writeFile(path.join(appDir,'package.json'),JSON.stringify({name:pkg.name,productName:'Terminal',version:pkg.version,main:pkg.main}));
// Frontend dependencies are bundled. Copy main-process packages and native PTY binaries.
const copied=new Set();
async function copyPackage(name, parentRequire=require) {
  if(copied.has(name))return;
  let file;
  try {file=parentRequire.resolve(`${name}/package.json`);}catch(e){if(e.code!=='ERR_PACKAGE_PATH_NOT_EXPORTED')throw e;file=path.resolve('node_modules',name,'package.json');}
  const info=JSON.parse(await readFile(file,'utf8'));
  copied.add(name);
  const directory = path.dirname(file);
  await cp(directory,path.join(appDir,'node_modules',name),{recursive:true,filter:src=>{
    const [root, platform] = path.relative(directory, src).split(path.sep);
    if (name === 'node-pty' && root === 'prebuilds' && platform && platform !== `win32-${process.arch}`) return false;
    return !src.includes(`${path.sep}test${path.sep}`) && !src.includes(`${path.sep}tests${path.sep}`) && path.extname(src) !== '.pdb';
  }});
  const nested=createRequire(file);
  for(const dep of Object.keys(info.dependencies||{}))await copyPackage(dep,nested);
}
await copyPackage('ssh2');
await copyPackage('ssh-config');
await copyPackage('node-pty');
const branded=path.join(target,'Terminal.exe');
await rename(path.join(target,'electron.exe'),branded);
await rcedit(branded, {icon:path.resolve('assets/terminal.ico'),'file-version':pkg.version,'product-version':pkg.version,
  'version-string':{ProductName:'Terminal',FileDescription:'Terminal',InternalName:'Terminal',OriginalFilename:'Terminal.exe',CompanyName:'Terminal'}});
await cp('assets/terminal.ico',path.join(target,'Terminal.ico'));
await cp('README.md',path.join(target,'README.md'));
await cp('VALIDATION.md',path.join(target,'VALIDATION.md'));
let notices='Terminal — third-party notices\n\nElectron runtime notices are also included in LICENSE and LICENSES.chromium.html.\n';
for(const name of Object.keys(pkg.dependencies)) {
  const directory=path.resolve('node_modules',name);
  const info=JSON.parse(await readFile(path.join(directory,'package.json'),'utf8'));
  notices+=`\n\n=== ${name} ${info.version} ===\n`;
  for(const file of ['LICENSE','LICENSE.md','LICENSE.txt','LICENSE-MIT','COPYING']) {
    try { notices+=await readFile(path.join(directory,file),'utf8');break; } catch(e) { if(e.code!=='ENOENT')throw e; }
  }
}
await writeFile(path.join(target,'THIRD_PARTY_NOTICES.txt'),notices);
console.log(`Ready: ${branded}`);
if(process.argv.includes('--zip')) {
  const zip=path.resolve(`release/Terminal-${pkg.version}-win-x64.zip`);
  const result=spawnSync('tar.exe',['-a','-c','-f',zip,'-C',path.dirname(target),path.basename(target)],{stdio:'inherit'});
  if(result.status!==0)throw Error('ZIP creation failed');
  console.log(`ZIP: ${zip} (${Math.round((await stat(zip)).size/1024/1024)} MiB)`);
}
