const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const { Server } = require('ssh2');
const { generateKeyPairSync } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const root = path.resolve(__dirname,'..');
async function run() {
  const results=path.join(root,'test-results');await fs.mkdir(results,{recursive:true});
  const userData=await fs.mkdtemp(path.join(results,'profile-'));
  const sshHome=await fs.mkdtemp(path.join(results,'ssh-home-'));await fs.mkdir(path.join(sshHome,'.ssh'));
  const key=generateKeyPairSync('rsa',{modulusLength:2048}).privateKey.export({type:'pkcs1',format:'pem'});
  const channels=[], clients=[];let input='';let app;
  const server=new Server({hostKeys:[key]},c=>{
    clients.push(c);c.on('error',()=>{});c.on('authentication',ctx=>ctx.method==='password' && ctx.password==='secret'?ctx.accept():ctx.reject(['password']));
    c.on('ready',()=>c.on('session',accept=>{const s=accept();s.on('pty',accept=>accept());s.on('env',accept=>accept?.());s.on('window-change',accept=>accept?.());s.on('shell',accept=>{const ch=accept();channels.push(ch);ch.on('data',d=>{input+=d.toString();});ch.write('# 你好 Silk 🥳\r\n\r\n**Connected** via SSH.\r\n\x1b[38;2;130;220;190mTruecolor ✓\x1b[0m\r\n');});}));
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  await fs.writeFile(path.join(sshHome,'.ssh','config'),`Host fixture-config\n HostName 127.0.0.1\n User test\n Port ${server.address().port}\n IdentityAgent none\n IdentityFile none\n`);
  const errors=[];
  try {
    const launchEnv={...process.env,SILK_USER_DATA:userData,SILK_SSH_HOME:sshHome};delete launchEnv.ELECTRON_RUN_AS_NODE;
    app=await electron.launch({executablePath:process.env.SILK_TEST_EXE || undefined,args:process.env.SILK_TEST_EXE ? [] : [root],env:launchEnv,timeout:120000});
    // Only this test process auto-accepts the fixture server's host key.
    await app.evaluate(async({dialog,clipboard,ClipboardItem})=>{dialog.showMessageBox=async()=>({response:1});globalThis.__terminalClipboardBackup=await Promise.all((await clipboard.read()).map(async item=>new ClipboardItem(Object.fromEntries(await Promise.all(item.types.map(async type=>[type,await item.getType(type)]))))));});
    const page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));
    await page.locator('#welcome h1').waitFor();
    await page.screenshot({path:path.join(results,'welcome.png')});
    await page.locator('#settings-open').click();
    assert.match(await page.locator('#font-latin').inputValue(),/^Comic Mono/);
    assert.match(await page.locator('#font-cjk').inputValue(),/^NSimSun/);
    await page.locator('#font-latin').fill('Comic Mono, Consolas');
    await page.locator('#font-cjk').fill('NSimSun, SimSun');
    await page.locator('#font-emoji').fill('Segoe UI Emoji');
    await page.locator('#renderer').selectOption(process.env.SILK_TEST_RENDERER || 'webgl');
    await page.locator('#settings-form button[type=submit]').click();
    await page.locator('#settings-dialog').waitFor({state:'hidden'});
    const css=await page.evaluate(()=>[...document.querySelectorAll('style')].map(x=>x.textContent).join('\n'));
    assert.match(css,/unicode-range:U\+2E80/);assert.match(css,/local\("NSimSun"\)/);assert.match(css,/size-adjust:/);
    await page.locator('#markdown-open').click();await page.locator('#markdown-edit').click();
    await page.locator('#markdown-source').fill('# 安全阅读\n\n| A | B |\n|---|---|\n| 中文 | 🥳 |\n\n<script>window.compromised=true</script><img src=x onerror="alert(1)">');
    await page.waitForTimeout(300);
    assert.equal(await page.locator('#markdown-content table').count(),1);
    assert.equal(await page.locator('#markdown-content script, #markdown-content img').count(),0);
    const math=String.raw`Inline $\alpha+\beta=\gamma$ and \(e^{i\pi}+1=0\).

$$
\int_0^\infty e^{-x}\,dx=1 \quad \frac{a}{b}\quad \begin{pmatrix}a&b\\c&d\end{pmatrix}
$$

\[\sum_{n=1}^{\infty}\frac{1}{n^2}=\frac{\pi^2}{6}\]

Code: `+'`$not_math$`'+String.raw`

$\href{javascript:alert(1)}{bad}$

$\includegraphics{https://example.com/no.png}$

<span style="background:url(https://example.com/no)">unsafe style</span>`;
    await page.locator('#markdown-source').fill(math);
    await page.waitForFunction(()=>document.querySelectorAll('#markdown-content .katex').length>=4);
    assert.equal(await page.locator('#markdown-content .katex-display').count(),2);
    assert.equal(await page.locator('#markdown-content code .katex').count(),0);
    assert.equal(await page.locator('#markdown-content img, #markdown-content a[href], #markdown-content script').count(),0);
    await page.screenshot({path:path.join(results,'math.png')});
    await page.locator('#markdown-close').click();
    const connect=async name=>{
      await page.locator('#new-tab').click();await page.locator('#profile-name').fill(name);
      await page.locator('#host').fill('127.0.0.1');await page.locator('#port').fill(String(server.address().port));await page.locator('#username').fill('test');
      await page.locator('#auth').selectOption('password');await page.locator('#password').fill('secret');await page.locator('#connect-submit').click();
      await page.waitForFunction(()=>document.getElementById('connection-state').textContent.includes('已连接'));
    };
    await connect('开发服务器');
    await page.locator('.terminal-host:not([hidden]) .xterm-helper-textarea').focus();
    await page.keyboard.type('echo hello');await page.keyboard.press('Enter');await page.waitForTimeout(100);assert.match(input,/echo hello\r/);
    const ime=await page.context().newCDPSession(page);
    const beforeIme=input.length;
    await ime.send('Input.imeSetComposition',{text:'nihao',selectionStart:5,selectionEnd:5});
    assert.equal(input.length,beforeIme,'uncommitted IME preedit must stay local');
    await ime.send('Input.insertText',{text:'你好，中文输入'});
    for(let i=0;i<100 && !input.slice(beforeIme).includes('你好，中文输入');i++)await page.waitForTimeout(20);
    assert.equal(input.slice(beforeIme),'你好，中文输入','IME commit reaches SSH once without pinyin');
    await ime.send('Input.imeSetComposition',{text:'ceshi',selectionStart:5,selectionEnd:5});
    await ime.send('Input.imeSetComposition',{text:'',selectionStart:0,selectionEnd:0});
    await page.waitForTimeout(50);assert.equal(input.slice(beforeIme),'你好，中文输入','cancelled composition sends no text');
    const beforeTsf=input.length;
    await page.evaluate(async()=>{
      const textarea=document.querySelector('.terminal-host:not([hidden]) .xterm-helper-textarea');
      textarea.value='   ';textarea.setSelectionRange(3,3);
      textarea.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true,data:''}));
      textarea.dispatchEvent(new CompositionEvent('compositionupdate',{bubbles:true,data:'n'}));textarea.value='   n';
      await new Promise(r=>setTimeout(r,0));
      textarea.dispatchEvent(new CompositionEvent('compositionupdate',{bubbles:true,data:'ni'}));textarea.value='ni';
      await new Promise(r=>setTimeout(r,0));
      textarea.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:'你是'}));textarea.value='你是';
    });
    for(let i=0;i<100 && !input.slice(beforeTsf).includes('你是');i++)await page.waitForTimeout(20);
    assert.equal(input.slice(beforeTsf),'你是','Microsoft Pinyin whole-value replacement must not lose committed Chinese');
    for(const sample of [
      {prefix:' ',commit:'中文'},
      {prefix:'already-sent-ascii',commit:'连续输入，🚀'},
      {prefix:'previous',commit:'nihao'},
      {prefix:'already-sent',commit:''}
    ]){
      const before=input.length;
      await page.evaluate(async({prefix,commit})=>{
        const t=document.querySelector('.terminal-host:not([hidden]) .xterm-helper-textarea');
        t.value=prefix;t.setSelectionRange(prefix.length,prefix.length);
        t.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true,data:''}));
        t.dispatchEvent(new CompositionEvent('compositionupdate',{bubbles:true,data:'ni'}));t.value='ni';
        await new Promise(r=>setTimeout(r,0));
        t.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:commit}));t.value=commit;
      },sample);
      if(sample.commit)for(let i=0;i<100 && input.length===before;i++)await page.waitForTimeout(20);
      await page.waitForTimeout(30);assert.equal(input.slice(before),sample.commit,'TSF commit/cancel must send exactly the committed string');
    }
    await page.keyboard.press('Enter');
    await page.keyboard.type('English-after-IME');
    for(let i=0;i<100 && !input.endsWith('English-after-IME');i++)await page.waitForTimeout(20);
    assert.equal(input.endsWith('\rEnglish-after-IME'),true,'normal Enter and English remain usable after IME');
    const beforePunctuation=input.length;
    await page.evaluate(()=>{
      const t=document.querySelector('.terminal-host:not([hidden]) .xterm-helper-textarea');t.value='';
      t.dispatchEvent(new KeyboardEvent('keydown',{key:'Process',code:'Comma',keyCode:229,which:229,bubbles:true,cancelable:true}));
      t.dispatchEvent(new KeyboardEvent('keyup',{key:'Process',code:'Comma',keyCode:229,which:229,bubbles:true}));
      t.value='，';t.dispatchEvent(new InputEvent('input',{inputType:'insertText',data:'，',bubbles:true,composed:true}));
    });
    await page.waitForTimeout(100);assert.equal(input.slice(beforePunctuation),'，','one full-width comma must not be sent by both input and deferred textarea diff');
    for(const shape of ['keydown-first','keyup-before-input','input-first','rollover','composition-and-input','keypress-and-input']){
      const symbols=shape==='rollover'?'，，。。！！':'，。！？：；（）“”《》、';
      const before=input.length;
      await page.evaluate(async({shape,symbols})=>{
        const t=document.querySelector('.terminal-host:not([hidden]) .xterm-helper-textarea');t.value='';
        const key=(type,char,code=229)=>t.dispatchEvent(new KeyboardEvent(type,{key:code===229?'Process':char,keyCode:code,which:code,charCode:type==='keypress'?code:0,code:'Comma',bubbles:true,cancelable:true}));
        const insert=char=>{t.value+=char;t.dispatchEvent(new InputEvent('input',{inputType:'insertText',data:char,bubbles:true,composed:true}));};
        key('keyup','',229);
        for(const char of symbols){
          if(shape==='input-first'){insert(char);key('keydown',char);key('keyup',char);}
          else if(shape==='keyup-before-input'){key('keydown',char);key('keyup',char);insert(char);}
          else if(shape==='composition-and-input'){
            t.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true,data:''}));
            t.dispatchEvent(new CompositionEvent('compositionupdate',{bubbles:true,data:char}));
            t.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:char}));insert(char);
          }
          else if(shape==='keypress-and-input'){key('keypress',char,char.charCodeAt(0));insert(char);key('keyup',char);}
          else{key('keydown',char);insert(char);if(shape!=='rollover')key('keyup',char);}
          if(shape!=='rollover')await new Promise(r=>setTimeout(r,10));
        }
        key('keyup','',229);
      },{shape,symbols});
      for(let i=0;i<100 && input.slice(before).length<symbols.length;i++)await page.waitForTimeout(20);
      await page.waitForTimeout(30);assert.equal(input.slice(before),symbols,`punctuation is sent exactly once per input transaction: ${shape}`);
    }
    for(const followup of ['，','。']){
      const before=input.length;
      await page.evaluate(char=>{
        const t=document.querySelector('.terminal-host:not([hidden]) .xterm-helper-textarea');t.value='';
        t.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true,data:''}));
        t.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:'，'}));t.value='，';
        t.dispatchEvent(new InputEvent('input',{inputType:'insertText',data:'，',composed:true,bubbles:true}));
        t.dispatchEvent(new KeyboardEvent('keydown',{key:'Process',keyCode:229,bubbles:true,cancelable:true}));
        t.value+=char;t.dispatchEvent(new InputEvent('input',{inputType:'insertText',data:char,composed:true,bubbles:true}));
        t.dispatchEvent(new KeyboardEvent('keyup',{key:'Process',keyCode:229,bubbles:true}));
      },followup);
      await page.waitForTimeout(50);assert.equal(input.slice(before),'，'+followup,'a second real punctuation key immediately after commit is preserved in order');
    }
    channels[0].write('\x1b[2J\x1b[HAB中文🥳🧑‍💻α∑🇨🇳1️⃣❤️\x1b[6n');
    for(let i=0;i<100 && !/\x1b\[1;19R/.test(input);i++)await new Promise(r=>setTimeout(r,20));
    assert.match(input,/\x1b\[1;19R/,'CJK, ZWJ emoji, flags, keycaps and hearts occupy 2 columns; Greek/math one');
    if((process.env.SILK_TEST_RENDERER||'webgl')==='dom') {
      const widths=await page.evaluate(()=>{
        const row=document.querySelector('.terminal-host:not([hidden]) .xterm-rows>div');
        const walker=document.createTreeWalker(row,NodeFilter.SHOW_TEXT),all=[];while(walker.nextNode())all.push(walker.currentNode);
        const measure=sample=>{for(const node of all){const at=node.textContent.indexOf(sample);if(at>=0){const range=document.createRange();range.setStart(node,at);range.setEnd(node,at+sample.length);return range.getBoundingClientRect().width;}}return 0;};
        return {english:measure('AB')/2,chinese:measure('中文')/2,emoji:measure('🥳')};
      });
      assert.ok(widths.english>0);assert.ok(Math.abs(widths.chinese-2*widths.english)<0.25,JSON.stringify(widths));assert.ok(Math.abs(widths.emoji-2*widths.english)<0.25,JSON.stringify(widths));
    }
    channels[0].write('\x1b[2J\x1b[HCOPY_TARGET\x1b[?2004h\x1b[?1000h\x1b[?1006h');await page.waitForTimeout(100);
    const screen=page.locator('.terminal-host:not([hidden]) .xterm-screen'),box=await screen.boundingBox();
    const info=await page.locator('#session-info').innerText(),cols=Number(info.match(/^(\d+)/)[1]),rows=Number(info.match(/× (\d+)/)[1]);
    const cw=box.width/cols,ch=box.height/rows;
    const selectCopyTarget=async()=>{await page.keyboard.down('Shift');await page.mouse.move(box.x+1,box.y+ch/2);await page.mouse.down();await page.mouse.move(box.x+11*cw+1,box.y+ch/2,{steps:8});await page.mouse.up();await page.keyboard.up('Shift');};
    const waitClipboard=async()=>{for(let i=0;i<100;i++){if(await app.evaluate(({clipboard})=>clipboard.readText())==='COPY_TARGET')return;await page.waitForTimeout(20);}throw Error('Clipboard copy did not reach the native clipboard');};
    await selectCopyTarget();await page.mouse.click(box.x+cw*20,box.y+ch*1.5,{button:'right'});await waitClipboard();
    const beforePaste=input.length;
    await app.evaluate(({clipboard})=>clipboard.writeText('PASTE_TEST_中文\nnext'));
    await page.mouse.click(box.x+cw*20,box.y+ch*1.5,{button:'right'});
    for(let i=0;i<100 && !input.slice(beforePaste).includes('next');i++)await page.waitForTimeout(20);
    assert.match(input.slice(beforePaste),/\x1b\[200~PASTE_TEST_中文\rnext\x1b\[201~/);
    assert.equal(input.slice(beforePaste).includes('\x1b[<'),false,'right click must not also reach TUI mouse reporting');
    const beforeInterrupt=input.length;await page.keyboard.press('Control+c');for(let i=0;i<100 && !input.slice(beforeInterrupt).includes('\x03');i++)await page.waitForTimeout(20);
    assert.equal(input.slice(beforeInterrupt).includes('\x03'),true,'Ctrl+C without selection must still interrupt the remote process');
    await selectCopyTarget();const beforeCopy=input.length;await page.keyboard.press('Control+c');await waitClipboard();assert.equal(input.slice(beforeCopy).includes('\x03'),false,'copy selection must not send SIGINT');
    await app.evaluate(({clipboard})=>clipboard.writeText('PASTE_TEST_中文\nnext'));
    await selectCopyTarget();await page.keyboard.press('Control+Shift+c');await waitClipboard();
    await app.evaluate(({clipboard})=>clipboard.writeText('PASTE_TEST_中文\nnext'));
    await selectCopyTarget();await page.locator('#copy-output').click();await waitClipboard();
    channels[0].write('\x1b[?1000l\x1b[?1006l\x1b[?2004l');
    const flood=('context 中文 🚀 '+'.'.repeat(90)+'\r\n').repeat(30000)+'\r\n# FLOOD_COMPLETE\r\n';
    const start=performance.now();channels[0].write(flood);
    await page.locator('#markdown-open').click();
    let complete=false;
    for(let i=0;i<100;i++) { await page.locator('#markdown-refresh').click();complete=(await page.locator('#markdown-source').inputValue()).includes('FLOOD_COMPLETE');if(complete)break;await page.waitForTimeout(100); }
    assert.equal(complete,true,'large SSH output reaches xterm buffer');
    const floodMs=performance.now()-start;
    await page.locator('#markdown-close').click();
    for(let i=2;i<=4;i++)await connect(`会话 ${i}`);
    await page.locator('#new-tab').click();await page.locator('#saved-profile option[value="config:fixture-config"]').waitFor({state:'attached'});
    await page.locator('#saved-profile').selectOption('config:fixture-config');
    assert.equal(await page.locator('#auth').inputValue(),'config');assert.equal(await page.locator('#host').inputValue(),'fixture-config');
    await page.locator('#password').fill('');await page.locator('#connect-submit').click();
    await page.locator('#auth-dialog').waitFor();assert.match(await page.locator('#auth-title').innerText(),/fixture-config/);
    await app.evaluate(({BrowserWindow})=>{const win=BrowserWindow.getAllWindows()[0];win.focus();globalThis.__inputNativeResets=0;const original=win.blurWebView.bind(win);win.blurWebView=()=>{globalThis.__inputNativeResets++;return original();};});
    await page.locator('#auth-fields input').fill('secret');
    await page.locator('#auth-fields input').evaluate(input=>{globalThis.__passwordBlurredWhileAttached=false;input.addEventListener('blur',()=>{globalThis.__passwordBlurredWhileAttached=input.isConnected;},{once:true});});
    await page.locator('#auth-fields input').press('Enter');
    await page.waitForFunction(()=>document.getElementById('connection-state').textContent.includes('已连接'));
    assert.equal(channels.length,5,'config alias connected to resolved fixture host and port');
    assert.equal(await page.evaluate(()=>globalThis.__passwordBlurredWhileAttached),true,'password field must leave native secure input while still attached');
    assert.equal(await page.evaluate(()=>document.activeElement?.classList.contains('xterm-helper-textarea')),true,'authentication completion restores terminal IME focus');
    for(let i=0;i<100 && !(await app.evaluate(()=>globalThis.__inputNativeResets));i++)await page.waitForTimeout(20);
    assert.ok(await app.evaluate(()=>globalThis.__inputNativeResets>0),'password completion reattaches the native text input client');
    const afterPassword=input.length;
    await ime.send('Input.imeSetComposition',{text:'denglu',selectionStart:6,selectionEnd:6});
    await ime.send('Input.insertText',{text:'登录后中文输入'});
    for(let i=0;i<100 && !input.slice(afterPassword).includes('登录后中文输入');i++)await page.waitForTimeout(20);
    assert.equal(input.slice(afterPassword),'登录后中文输入','IME must work immediately after Enter submits the password dialog');
    await page.keyboard.press('Enter');await page.keyboard.type('English');
    for(let i=0;i<100 && !input.slice(afterPassword).endsWith('English');i++)await page.waitForTimeout(20);
    assert.equal(input.slice(afterPassword),'登录后中文输入\rEnglish','Chinese/English switching survives the password transition');
    await page.locator('#appearance-open').click();
    assert.equal(await page.locator('#ui-theme option').count(),9);assert.equal(await page.locator('#terminal-scheme option').count(),13);
    const oldScheme=await page.evaluate(()=>document.documentElement.dataset.terminalScheme);
    for(const key of ['silk','graphite','ocean','forest','nebula','ember','ice','retro','paper','sepia','porcelain','contrast']){
      await page.locator('#terminal-scheme').selectOption(key);assert.equal(await page.locator('#scheme-swatches span').count(),16);
      assert.equal(await page.evaluate(()=>document.documentElement.dataset.terminalScheme),oldScheme,'previews do not mutate active terminals before save');
    }
    await page.locator('#appearance-cancel').click();
    const setAppearance=async(ui,scheme)=>{await page.locator('#appearance-open').click();await page.locator('#ui-theme').selectOption(ui);await page.locator('#terminal-scheme').selectOption(scheme);await page.locator('#appearance-save').click();await page.locator('#appearance-dialog').waitFor({state:'hidden'});};
    await setAppearance('paper','auto');
    assert.equal(await page.evaluate(()=>document.documentElement.style.colorScheme),'light');
    if((process.env.SILK_TEST_RENDERER||'webgl')==='dom'){
      for(let i=0;i<5;i++){await page.locator('.tab-label').nth(i).click();assert.equal(await page.locator('.terminal-host:not([hidden]) .xterm-rows').evaluate(el=>getComputedStyle(el).color),'rgb(40, 52, 73)','new palette updates existing terminal instances');}
    }
    channels[4].write('\r\n# 主题预览 / Theme\r\n\r\n**中文、英文、Emoji 🚀**\r\n\r\n$\\alpha+\\beta=\\gamma$\r\n\r\n\x1b[31merror\x1b[0m  \x1b[32msuccess\x1b[0m  \x1b[33mwarning\x1b[0m\r\n');await page.waitForTimeout(100);
    await page.locator('#markdown-open').click();await page.waitForTimeout(150);await page.screenshot({path:path.join(results,'themes-light.png')});await page.locator('#markdown-close').click();
    await setAppearance('system','auto');await page.emulateMedia({colorScheme:'light'});await page.waitForFunction(()=>document.documentElement.dataset.uiTheme==='paper');
    await page.emulateMedia({colorScheme:'dark'});await page.waitForFunction(()=>document.documentElement.dataset.uiTheme==='midnight');
    await setAppearance('contrast','contrast');await page.screenshot({path:path.join(results,'themes-contrast.png')});
    await setAppearance('plum','ocean');
    assert.equal(await page.evaluate(()=>document.documentElement.dataset.terminalScheme),'ocean','interface and terminal palette are independent');
    await page.screenshot({path:path.join(results,'themes-dark.png')});
    await page.locator('#appearance-open').click();await page.screenshot({path:path.join(results,'themes-picker.png')});await page.locator('#appearance-cancel').click();
    assert.equal(channels.length,5,'theme changes do not reconnect SSH sessions');
    // Background terminals continue parsing even while hidden.
    channels[0].write('\r\n# BACKGROUND_OK\r\n');await page.waitForTimeout(100);
    const switchTimes=[];
    for(let i=0;i<12;i++) { const started=performance.now();await page.locator('.tab-label').nth(i%4).click();switchTimes.push(performance.now()-started); }
    await page.locator('.tab-label').first().click();await page.locator('#markdown-open').click();
    assert.match(await page.locator('#markdown-source').inputValue(),/BACKGROUND_OK/);
    await page.locator('#markdown-close').click();
    channels[0].write('\x1b[?1049h\x1b[2J\x1b[Hvim alternate screen 中文 🥳\r\n\x1b[4:3mcurly underline\x1b[0m');await page.waitForTimeout(100);
    await page.locator('#markdown-open').click();assert.match(await page.locator('#markdown-source').inputValue(),/vim alternate screen/);
    await page.locator('#markdown-close').click();channels[0].write('\x1b[?1049l');await page.waitForTimeout(100);
    // Verify actual local fonts resolved through aliases in Chromium.
    const fonts=await page.evaluate(async()=>{
      const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');
      const aliases=['SilkLatin0','SilkCJK0','SilkEmoji0'];
      return Promise.all(aliases.map(async(f,i)=>{const sample=['ABC','中文','🥳'][i];await document.fonts.load(`16px "${f}"`,sample);ctx.font=`16px "${f}"`;return {alias:f,loaded:document.fonts.check(`16px "${f}"`,sample),width:ctx.measureText(sample).width};}));
    });
    await page.screenshot({path:path.join(results,'terminal.png')});
    const metrics=await app.evaluate(({app})=>app.getAppMetrics().map(x=>({type:x.type,cpu:x.cpu.percentCPUUsage,memoryKiB:x.memory.workingSetSize})));
    const report={renderer:process.env.SILK_TEST_RENDERER || 'webgl',floodLines:30000,floodBytes:Buffer.byteLength(flood),floodMs,tabSwitchMs:switchTimes,fonts,metrics,errors};
    await fs.writeFile(path.join(results,'report.json'),JSON.stringify(report,null,2));
    await fs.writeFile(path.join(results,`report-${report.renderer}.json`),JSON.stringify(report,null,2));
    assert.deepEqual(errors,[]);
    const stored=JSON.parse(await fs.readFile(path.join(userData,'settings.json'),'utf8'));assert.equal(JSON.stringify(stored).includes('secret'),false);
    await page.locator('#settings-open').click();await page.locator('#renderer').selectOption('dom');await page.locator('#settings-form button[type=submit]').click();
    await page.waitForFunction(()=>document.getElementById('resource-info').textContent.includes('DOM'));
    const savedAppearance=JSON.parse(await fs.readFile(path.join(userData,'settings.json'),'utf8')).appearance;
    assert.equal(savedAppearance.uiTheme,'plum');assert.equal(savedAppearance.terminalScheme,'ocean','saving font/performance settings preserves theme selection');
    const activeLabel=await page.locator('.tab.active .tab-label').innerText();
    channels[2].exit(0);channels[2].end();
    await page.waitForFunction(()=>document.querySelectorAll('.tab').length===4);
    assert.equal(await page.locator('.tab.active .tab-label').innerText(),activeLabel,'background shell exit does not steal the active tab');
    await page.locator('.tab-label').last().click();channels[4].exit(0);channels[4].end();
    await page.waitForFunction(()=>document.querySelectorAll('.tab').length===3);
    assert.equal(await page.locator('.tab.active').count(),1,'active shell exit activates a surviving neighbor');
    channels[1].destroy();await page.waitForFunction(()=>document.querySelectorAll('.tab').length===2);
    for(const index of [0,3]){channels[index].exit(0);channels[index].end();}
    await page.waitForFunction(()=>document.querySelectorAll('.tab').length===0);
    assert.equal(await page.locator('.terminal-host').count(),0);await page.locator('#welcome').waitFor({state:'visible'});
    assert.equal(await page.locator('#connection-state').innerText(),'○ 就绪');
    await connect('退出后重新连接');assert.equal(await page.locator('.tab').count(),1,'new connections remain usable after the last tab exits');
    console.log(JSON.stringify(report,null,2));
  } catch(e) { if(app) { const p=await app.firstWindow();await p.screenshot({path:path.join(results,'failure.png')}); console.error('UI diagnostics:',await p.locator('body').innerText(),errors); } throw e;
  } finally { if(app){await app.evaluate(async({clipboard})=>{if(['COPY_TARGET','PASTE_TEST_中文\nnext'].includes(await clipboard.readText()) && globalThis.__terminalClipboardBackup){if(globalThis.__terminalClipboardBackup.length)await clipboard.write(globalThis.__terminalClipboardBackup);else clipboard.clear();}}).catch(()=>{});await app.close();}clients.forEach(c=>c.end());server.close(); }
}
run().catch(e=>{console.error(e);process.exitCode=1;});
