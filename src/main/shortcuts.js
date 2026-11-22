// Keyboard shortcuts: matched in before-input-event for every view, so they
// work whether focus is in the UI, a web page or a side panel.

const CODE_KEYS = {
  Equal: '=', Minus: '-', Comma: ',', Period: '.', Slash: '/', Backslash: '\\',
  BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: "'", Backquote: '`',
  Space: 'Space', Tab: 'Tab', Enter: 'Enter', Escape: 'Esc', Backspace: 'Backspace', Delete: 'Delete',
  ArrowLeft: 'Left', ArrowRight: 'Right', ArrowUp: 'Up', ArrowDown: 'Down',
  Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown', NumpadAdd: '=', NumpadSubtract: '-',
}

function keyName(input) {
  const code = input.code || ''
  if (code.startsWith('Key')) return code.slice(3)
  if (code.startsWith('Digit')) return code.slice(5)
  if (/^F\d+$/.test(code)) return code
  if (CODE_KEYS[code]) return CODE_KEYS[code]
  return (input.key || '').length === 1 ? input.key.toUpperCase() : input.key
}

const MAC = process.platform === 'darwin'

function comboFromInput(input) {
  const parts = []
  // On macOS, ⌘ plays the role of Ctrl (so "Ctrl+T" means ⌘T there).
  const ctrl = MAC ? input.meta : input.control
  const meta = MAC ? input.control : input.meta
  if (ctrl) parts.push('Ctrl')
  if (input.alt) parts.push('Alt')
  if (input.shift) parts.push('Shift')
  if (meta) parts.push('Meta')
  const k = keyName(input)
  if (['Control', 'Alt', 'Shift', 'Meta'].includes(k)) return null
  parts.push(k)
  return parts.join('+')
}

// Normalise user-written combos ("ctrl+shift+t", "Cmd+K") to our format.
function normalize(combo) {
  if (!combo) return ''
  const parts = combo.split('+').map((p) => p.trim()).filter(Boolean)
  const mods = new Set()
  let key = ''
  for (const p of parts) {
    const l = p.toLowerCase()
    if (['ctrl', 'control', 'cmdorctrl', 'commandorcontrol'].includes(l)) mods.add('Ctrl')
    else if (['alt', 'option'].includes(l)) mods.add('Alt')
    else if (l === 'shift') mods.add('Shift')
    else if (['meta', 'cmd', 'command', 'super', 'win'].includes(l)) mods.add('Meta')
    else key = p.length === 1 ? p.toUpperCase() : p[0].toUpperCase() + p.slice(1)
  }
  if (key === 'Plus') key = '='
  if (key === 'Escape') key = 'Esc'
  return [...['Ctrl', 'Alt', 'Shift', 'Meta'].filter((m) => mods.has(m)), key].join('+')
}

class Shortcuts {
  constructor(ctx) {
    this.ctx = ctx
    this.rebuild()
  }

  rebuild() {
    this.map = new Map()
    const s = this.ctx.settings.data.shortcuts || {}
    for (const [action, combo] of Object.entries(s)) {
      const c = normalize(combo)
      if (c) this.map.set(c, action)
    }
    // Friendly extras that are always available.
    const extras = { 'Ctrl+Shift+=': 'zoomIn', F5: 'reload', 'Ctrl+F5': 'hardReload', 'Ctrl+PageDown': 'nextTab', 'Ctrl+PageUp': 'prevTab', 'Alt+Home': 'home' }
    for (const [c, a] of Object.entries(extras)) if (!this.map.has(c)) this.map.set(c, a)
  }

  handle(event, input) {
    if (input.type !== 'keyDown' || this.recording) return
    const combo = comboFromInput(input)
    if (!combo) return
    const action = this.map.get(combo)
    if (!action) return
    // Leave plain typing keys alone (e.g. a shortcut bound to "/" without modifiers).
    if (!/Ctrl|Alt|Meta/.test(combo) && !/^F\d+$/.test(combo) && combo.length === 1) return
    event.preventDefault()
    this.ctx.actions.run(action)
  }
}

module.exports = { Shortcuts, normalize, comboFromInput }
