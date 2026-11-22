// Preload for the floating popup layer (address bar suggestions).
const { contextBridge, ipcRenderer } = require('electron')
contextBridge.exposeInMainWorld('popup', {
  onRender: (cb) => ipcRenderer.on('popup:render', (_e, data) => cb(data)),
  pick: (index, newTab) => ipcRenderer.send('popup:pick', index, newTab),
  size: (height) => ipcRenderer.send('popup:size', height),
})
