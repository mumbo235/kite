// Preload for Kite's menu layer (context menus, the ⋯ menu, tab menus...).
const { contextBridge, ipcRenderer } = require('electron')
contextBridge.exposeInMainWorld('kmenu', {
  onShow: (cb) => ipcRenderer.on('menu:show', (_e, data) => cb(data)),
  pick: (id) => ipcRenderer.send('menu:pick', id),
  close: () => ipcRenderer.send('menu:close'),
})
