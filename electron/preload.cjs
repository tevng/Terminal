const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('silk', {
  connect: (profile, size) => ipcRenderer.invoke('ssh:connect', profile, size),
  startLocal: (id, shell, size) => ipcRenderer.invoke('local:start', id, shell, size),
  answerAuth: (requestId, answers) => ipcRenderer.invoke('ssh:auth-response',requestId,answers),
  restoreInputFocus: () => ipcRenderer.invoke('input:restore-focus'),
  close: id => ipcRenderer.invoke('terminal:close', id),
  input: (id, data, binary) => ipcRenderer.send('terminal:input', id, data, binary),
  resize: (id, cols, rows) => ipcRenderer.send('terminal:resize', id, cols, rows),
  ack: (id, seq) => ipcRenderer.send('terminal:ack', id, seq),
  chooseKey: () => ipcRenderer.invoke('key:choose'),
  listConfig: () => ipcRenderer.invoke('config:list'),
  readClipboard: () => ipcRenderer.invoke('clipboard:read'),
  writeClipboard: text => ipcRenderer.invoke('clipboard:write', text),
  loadSettings: () => ipcRenderer.invoke('settings:load'),
  saveSettings: data => ipcRenderer.invoke('settings:save', data),
  onEvent: fn => { const listener = (_event, payload) => fn(payload); ipcRenderer.on('terminal:event', listener); return () => ipcRenderer.removeListener('terminal:event', listener); }
});
