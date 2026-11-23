import {uiThemes,terminalSchemes,resolveAppearance} from './themes.js';
export function installAppearance({getOptions,getFont,save,onClose}){
  const dialog=document.createElement('dialog');dialog.id='appearance-dialog';
  dialog.innerHTML='<form id="appearance-form"><div class="dialog-heading"><div><div class="eyebrow">APPEARANCE</div><h2>主题与配色</h2></div><button type="button" id="appearance-close" aria-label="关闭主题设置">✕</button></div><label>界面主题<select id="ui-theme"></select></label><div id="ui-theme-cards" class="theme-cards"></div><label>终端配色<select id="terminal-scheme"></select></label><p class="muted">界面与终端可独立搭配。预览后保存，将应用到所有标签和新连接。</p><div id="scheme-preview"><div id="scheme-preview-heading"></div><pre id="scheme-preview-text"></pre><div id="scheme-swatches" aria-label="16 色 ANSI 色板"></div></div><p id="appearance-error" class="error" role="alert"></p><div class="dialog-actions"><button type="button" id="appearance-cancel">取消</button><button class="primary" type="submit" id="appearance-save">保存外观</button></div></form>';
  document.body.append(dialog);const $=id=>dialog.querySelector('#'+id);
  $('ui-theme').add(new Option('跟随系统','system'));
  for(const [key,theme]of Object.entries(uiThemes)){
    $('ui-theme').add(new Option(theme.name,key));
    const card=document.createElement('button');card.type='button';card.className='theme-card';card.dataset.theme=key;card.textContent=theme.name.split(' · ')[0];
    card.style.setProperty('--card-bg',theme.tokens.panel);card.style.setProperty('--card-fg',theme.tokens.text);card.style.setProperty('--card-accent',theme.tokens.accent);
    card.onclick=()=>{$('ui-theme').value=key;preview();};$('ui-theme-cards').append(card);
  }
  $('terminal-scheme').add(new Option('跟随界面主题','auto'));
  for(const [key,scheme]of Object.entries(terminalSchemes))$('terminal-scheme').add(new Option(scheme.name,key));
  function preview(){
    const result=resolveAppearance({uiTheme:$('ui-theme').value,terminalScheme:$('terminal-scheme').value},matchMedia('(prefers-color-scheme: light)').matches),p=result.terminal.colors;
    for(const card of $('ui-theme-cards').children)card.setAttribute('aria-pressed',String(card.dataset.theme===result.uiKey));
    $('scheme-preview').style.cssText=`background:${p.background};color:${p.foreground};font-family:${getFont()};`;
    $('scheme-preview-heading').textContent=result.terminal.name;
    $('scheme-preview-text').replaceChildren();
    for(const [text,color]of [['user@linux',p.green],[' ~/workspace\n',p.blue],['$ ',p.cursor],['中文 · Comic Mono · αβγ · 🚀\n',p.foreground],['success  ',p.green],['warning  ',p.yellow],['error  ',p.red],['info\n',p.cyan],['Markdown + LaTeX / SSH / Vim',p.magenta]]){const span=document.createElement('span');span.textContent=text;span.style.color=color;$('scheme-preview-text').append(span);}
    $('scheme-swatches').replaceChildren();
    for(const key of ['black','red','green','yellow','blue','magenta','cyan','white','brightBlack','brightRed','brightGreen','brightYellow','brightBlue','brightMagenta','brightCyan','brightWhite']){
      const chip=document.createElement('span');chip.style.background=p[key];chip.title=`${key}: ${p[key]}`;$('scheme-swatches').append(chip);
    }
  }
  $('ui-theme').onchange=preview;$('terminal-scheme').onchange=preview;
  const close=()=>{dialog.close();onClose();};$('appearance-close').onclick=close;$('appearance-cancel').onclick=close;
  dialog.oncancel=event=>{event.preventDefault();close();};
  $('appearance-form').onsubmit=async event=>{
    event.preventDefault();$('appearance-save').disabled=true;$('appearance-error').textContent='';
    try{await save({uiTheme:$('ui-theme').value,terminalScheme:$('terminal-scheme').value});close();}catch(e){$('appearance-error').textContent=e.message;}finally{$('appearance-save').disabled=false;}
  };
  return {open(){const o=getOptions();$('ui-theme').value=o.uiTheme;$('terminal-scheme').value=o.terminalScheme;$('appearance-error').textContent='';preview();dialog.showModal();}};
}
