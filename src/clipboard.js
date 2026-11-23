export function wireClipboard({element,term,api,ready,notify,error}) {
  async function copy(clear=false) {
    const text=term.getSelection();if(!text){notify('请先选中文字');return;}
    try{await api.writeClipboard(text);if(clear)term.clearSelection();notify('已复制');}catch(e){error(e);}
  }
  async function paste() {
    if(!ready()){notify('会话尚未连接，无法粘贴');return;}
    try{const text=await api.readClipboard();if(new TextEncoder().encode(text).length>1024*1024){notify('粘贴内容超过 1 MiB');return;}if(ready()){term.paste(text);term.focus();}}catch(e){error(e);}
  }
  for(const type of ['mousedown','mouseup'])element.addEventListener(type,event=>{if(event.button===2){event.preventDefault();event.stopImmediatePropagation();}},true);
  element.addEventListener('contextmenu',event=>{event.preventDefault();event.stopImmediatePropagation();if(term.hasSelection())void copy(true);else void paste();},true);
  element.addEventListener('copy',event=>{const text=term.getSelection();if(text && event.clipboardData){event.clipboardData.setData('text/plain',text);event.preventDefault();event.stopImmediatePropagation();}},true);
  element.addEventListener('keydown',event=>{
    if(event.isComposing || event.keyCode===229)return;
    if(!event.ctrlKey || event.altKey || event.metaKey)return;
    const key=event.key.toLowerCase();
    if(key==='c' && (event.shiftKey || term.hasSelection())){event.preventDefault();event.stopImmediatePropagation();void copy();}
    else if(key==='v' && event.shiftKey){event.preventDefault();event.stopImmediatePropagation();void paste();}
  },true);
  return {copy,paste};
}
