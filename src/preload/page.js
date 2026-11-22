// Preload for every tab. On kite:// pages it exposes the settings bridge;
// on all pages it adds mouse gestures and mouse back/forward buttons.
const { contextBridge, ipcRenderer } = require('electron')

const internal = location.protocol === 'kite:'

if (internal) {
  const listeners = new Map()
  ipcRenderer.on('wz:event', (_e, name, payload) => {
    for (const cb of listeners.get(name) || []) cb(payload)
  })
  contextBridge.exposeInMainWorld('kite', {
    call: (method, ...args) => ipcRenderer.invoke('wz', method, ...args),
    on: (name, cb) => {
      if (!listeners.has(name)) listeners.set(name, new Set())
      listeners.get(name).add(cb)
      return () => listeners.get(name).delete(cb)
    },
  })
}

let cfg = { gestures: false }
try {
  cfg = ipcRenderer.sendSync('wz:page-config') || cfg
} catch {}

// ---- mouse back / forward buttons ----
window.addEventListener(
  'mouseup',
  (e) => {
    if (e.button === 3 || e.button === 4) {
      e.preventDefault()
      ipcRenderer.send('wz:page', 'mouse-nav', e.button === 3 ? 'back' : 'forward')
    }
  },
  true
)

// ---- right-drag mouse gestures ----
if (cfg.gestures) {
  const STEP = 30
  let down = null // { x, y }
  let dirs = ''
  let last = null
  let ctxEvent = null
  let pending = false
  let justGestured = false
  let trail = null

  const showTrail = () => {
    if (trail) return
    trail = document.createElement('div')
    trail.style.cssText = 'position:fixed;inset:0;z-index:2147483647;pointer-events:none;'
    trail.innerHTML = '<svg width="100%" height="100%" style="position:absolute;inset:0"><polyline fill="none" stroke="#3b82f6" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" stroke-opacity=".8" points=""/></svg>'
    document.documentElement.appendChild(trail)
  }
  const addPoint = (x, y) => {
    if (!trail) return
    const pl = trail.querySelector('polyline')
    pl.setAttribute('points', pl.getAttribute('points') + ` ${x},${y}`)
  }
  const clearTrail = () => {
    trail?.remove()
    trail = null
  }

  window.addEventListener(
    'mousedown',
    (e) => {
      if (e.button !== 2) return
      down = { x: e.clientX, y: e.clientY }
      last = { ...down }
      dirs = ''
    },
    true
  )

  window.addEventListener(
    'mousemove',
    (e) => {
      if (!down || !(e.buttons & 2)) return
      const dx = e.clientX - last.x
      const dy = e.clientY - last.y
      if (Math.abs(dx) < STEP && Math.abs(dy) < STEP) return
      const d = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'R' : 'L') : dy > 0 ? 'D' : 'U'
      if (dirs[dirs.length - 1] !== d) dirs += d
      if (!trail) {
        showTrail()
        addPoint(down.x, down.y)
      }
      addPoint(e.clientX, e.clientY)
      last = { x: e.clientX, y: e.clientY }
    },
    true
  )

  const ctxParams = (e) => {
    const t = e.target instanceof Element ? e.target : document.body
    const a = t.closest('a[href]')
    const media = t.closest('img, video, audio')
    const editable = t.closest('input, textarea, [contenteditable=""], [contenteditable="true"]')
    const sel = String(window.getSelection() || '')
    return {
      x: Math.round(e.clientX),
      y: Math.round(e.clientY),
      clientX: e.clientX,
      clientY: e.clientY,
      linkURL: a ? a.href : '',
      linkText: a ? a.textContent.trim().slice(0, 200) : '',
      srcURL: media ? media.currentSrc || media.src || '' : '',
      mediaType: media ? media.tagName.toLowerCase().replace('img', 'image') : 'none',
      selectionText: sel,
      isEditable: !!editable && !(editable.tagName === 'INPUT' && /^(button|checkbox|radio|submit|reset|file|range|color)$/i.test(editable.type)),
      editFlags: { canCut: true, canCopy: true, canPaste: true, canSelectAll: true, canUndo: true, canRedo: true },
      menuSourceType: 'mouse',
      dictionarySuggestions: [],
      misspelledWord: '',
    }
  }

  window.addEventListener(
    'contextmenu',
    (e) => {
      if (e.defaultPrevented) return // page has its own menu
      e.preventDefault()
      if (down) {
        // Linux: contextmenu fires on mousedown — wait for mouseup.
        ctxEvent = ctxParams(e)
        pending = true
      } else if (!justGestured) {
        ipcRenderer.send('wz:page', 'contextmenu', ctxParams(e))
      }
      justGestured = false
    },
    false // bubble phase, so pages with their own menus can preventDefault first
  )

  window.addEventListener(
    'mouseup',
    (e) => {
      if (e.button !== 2 || !down) return
      down = null
      clearTrail()
      if (dirs) {
        ipcRenderer.send('wz:page', 'gesture', dirs)
        justGestured = true
        setTimeout(() => (justGestured = false), 400)
        pending = false
      } else if (pending) {
        ipcRenderer.send('wz:page', 'contextmenu', ctxEvent)
        pending = false
        justGestured = true // swallow a following contextmenu (Windows order)
        setTimeout(() => (justGestured = false), 400)
      }
      dirs = ''
    },
    true
  )
}
