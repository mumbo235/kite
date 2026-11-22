// Preload for the browser UI. Exposes a small RPC bridge and the
// <browser-action-list> element for extension buttons.
const { contextBridge, ipcRenderer } = require('electron')

const listeners = new Map()
ipcRenderer.on('wz:event', (_e, name, payload) => {
  for (const cb of listeners.get(name) || []) cb(payload)
  for (const cb of listeners.get('*') || []) cb(name, payload)
})

contextBridge.exposeInMainWorld('kite', {
  call: (method, ...args) => ipcRenderer.invoke('wz', method, ...args),
  on: (name, cb) => {
    if (!listeners.has(name)) listeners.set(name, new Set())
    listeners.get(name).add(cb)
    return () => listeners.get(name).delete(cb)
  },
  platform: process.platform,
})

try {
  require('electron-chrome-extensions/browser-action').injectBrowserAction()
} catch (e) {
  console.warn('browser actions unavailable', e)
}
