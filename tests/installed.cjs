const {_electron:electron}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
async function main(){
  const exe=process.env.TERMINAL_INSTALLED_EXE;if(!exe)throw Error('Set TERMINAL_INSTALLED_EXE');
  const root=path.resolve(__dirname,'..'),data=await fs.mkdtemp(path.join(root,'test-results','installed-'));
  await fs.mkdir(path.join(data,'.ssh'));await fs.writeFile(path.join(data,'.ssh','config'),'');
  const env={...process.env,SILK_USER_DATA:data,SILK_SSH_HOME:data};delete env.ELECTRON_RUN_AS_NODE;
  let app;
  try{
    app=await electron.launch({executablePath:exe,args:[],env,timeout:30000});
    const page=await app.firstWindow();await page.locator('#welcome h1').waitFor();
    assert.equal(await page.title(),'Terminal');
    assert.ok(await page.locator('.brand-icon').evaluate(img=>img.complete && img.naturalWidth>0));
    const result=await app.evaluate(({app,shell},{exe,cwd,shortcuts})=>{
      const verified=[];
      for(const shortcutPath of shortcuts){
        if(!shell.writeShortcutLink(shortcutPath,'update',{target:exe,cwd,icon:exe,iconIndex:0,description:'Terminal - SSH terminal',appUserModelId:'local.terminal.ssh'}))throw Error('Shortcut update failed');
        const details=shell.readShortcutLink(shortcutPath);
        if(details.target!==exe || details.appUserModelId!=='local.terminal.ssh')throw Error('Shortcut verification failed');
        verified.push({path:shortcutPath,target:details.target,icon:details.icon,appUserModelId:details.appUserModelId});
      }
      return {name:app.getName(),isPackaged:app.isPackaged,appPath:app.getAppPath(),shortcuts:verified};
    },{exe,cwd:path.dirname(exe),shortcuts:[process.env.TERMINAL_DESKTOP_SHORTCUT,process.env.TERMINAL_START_SHORTCUT]});
    assert.equal(result.name,'Terminal');assert.equal(result.isPackaged,true);
    assert.equal(result.appPath,path.join(path.dirname(exe),'resources','app'));
    await page.screenshot({path:path.join(root,'test-results','installed.png')});
    await fs.writeFile(path.join(root,'test-results','installed.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
  }finally{if(app)await app.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
