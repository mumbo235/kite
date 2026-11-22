// Kite's menu layer: draws a menu (and its submenus) at a point, handles the
// mouse and keyboard, and reports the chosen item back to the main process.
// The page underneath keeps running; clicking anywhere else closes the menu.

const CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>'
const DOT = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4.5" fill="currentColor"/></svg>'
const ARROW = '<svg class="ar" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>'

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

// "CmdOrCtrl+Shift+T" -> "Ctrl+Shift+T"
function prettyAccel(a) {
  if (!a) return ''
  return String(a)
    .replace(/CommandOrControl|CmdOrCtrl/gi, navigator.platform.startsWith('Mac') ? '⌘' : 'Ctrl')
    .replace(/\bPlus\b/g, '+')
    .replace(/\bEsc(ape)?\b/, 'Esc')
}

let levels = [] // [{ el, items, sel, parentRow }]
let hoverTimer = null
let closing = false
let shownAt = 0
let downInside = false

window.kmenu.onShow(({ items, x, y, vars, noAnim }) => {
  for (const [k, v] of Object.entries(vars || {})) {
    if (k === 'color-scheme') document.documentElement.style.colorScheme = v
    else document.documentElement.style.setProperty(k, v)
  }
  document.documentElement.classList.toggle('no-anim', !!noAnim)
  closeFrom(0)
  closing = false
  shownAt = Date.now()
  downInside = false
  open(items, x, y, null)
  focusLevel(0)
})

function selectable(it) {
  return it && it.type !== 'separator' && it.type !== 'header' && it.enabled !== false
}

function rowHTML(it, i) {
  if (it.type === 'separator') return '<div class="ks"></div>'
  if (it.type === 'header') return `<div class="kh">${esc(it.label)}</div>`
  const mark = it.checked ? (it.type === 'radio' ? DOT : CHECK) : it.icon ? `<img src="${esc(it.icon)}" alt="">` : ''
  return `<div class="ki ${it.enabled === false ? 'dis' : ''} ${it.danger ? 'danger' : ''}" data-i="${i}" role="menuitem">
    <span class="ck">${mark}</span><span class="lb">${esc(it.label)}</span>${it.accel ? `<span class="ac">${esc(prettyAccel(it.accel))}</span>` : ''}${it.sub ? ARROW : ''}</div>`
}

// Place a menu at (x, y) — or beside `parentRow` for a submenu — keeping it
// inside the window (flip left / up when there's no room).
function open(items, x, y, parentRow) {
  // drop separators at the ends and doubled ones
  items = items.filter((it, i, a) => it.visible !== false && !(it.type === 'separator' && (i === 0 || i === a.length - 1 || a[i - 1]?.type === 'separator')))
  const el = document.createElement('div')
  el.className = 'km'
  // no checkmarks or icons in this menu: no empty column for them
  if (!items.some((it) => it.checked || it.icon)) el.classList.add('nock')
  el.tabIndex = -1
  el.innerHTML = items.map(rowHTML).join('')
  el.style.maxHeight = innerHeight - 16 + 'px'
  document.body.appendChild(el)
  const w = el.offsetWidth
  const h = Math.min(el.scrollHeight, innerHeight - 16)
  let left = x
  let top = y
  let ox = 'left'
  let oy = 'top'
  if (parentRow) {
    const r = parentRow.getBoundingClientRect()
    left = r.right + 2
    top = r.top - 5
    if (left + w > innerWidth - 8) {
      left = r.left - w - 2
      ox = 'right'
    }
  } else if (left + w > innerWidth - 8) {
    left = Math.max(8, left - w)
    ox = 'right'
  }
  if (top + h > innerHeight - 8) {
    top = parentRow ? innerHeight - 8 - h : Math.max(8, y - h)
    oy = 'bottom'
  }
  el.style.left = Math.max(8, Math.round(left)) + 'px'
  el.style.top = Math.max(8, Math.round(top)) + 'px'
  el.style.setProperty('--ox', `${oy} ${ox}`)
  const level = { el, items, sel: -1, parentRow }
  levels.push(level)
  const depth = levels.length - 1

  el.addEventListener('mousemove', (e) => {
    const row = e.target.closest('.ki')
    if (!row) return
    const i = +row.dataset.i
    if (level.sel === i) return
    setSel(depth, i)
    clearTimeout(hoverTimer)
    // open submenus on hover, close other ones
    hoverTimer = setTimeout(() => {
      closeFrom(depth + 1)
      if (items[i]?.sub && items[i].enabled !== false) open(items[i].sub, 0, 0, row)
    }, items[i]?.sub ? 120 : 220)
  })
  el.addEventListener('mouseup', (e) => {
    // the button that opened a context menu is released right away, maybe
    // over the menu: only count a release after a press in the menu, or later
    if (!downInside && Date.now() - shownAt < 350) return
    const row = e.target.closest('.ki')
    if (row) activate(depth, +row.dataset.i, true)
  })
  el.addEventListener('mousedown', (e) => {
    e.preventDefault()
    downInside = true
  })
  return level
}

function setSel(depth, i) {
  const level = levels[depth]
  if (!level) return
  level.el.querySelector('.ki.on')?.classList.remove('on')
  level.sel = i
  const row = level.el.querySelector(`.ki[data-i="${i}"]`)
  if (row) {
    row.classList.add('on')
    row.scrollIntoView({ block: 'nearest' })
  }
  // keep the path to an open submenu highlighted
  for (let d = 0; d < depth; d++) levels[d].el.querySelector(`.ki[data-i="${levels[d].sel}"]`)?.classList.add('on')
}

function closeFrom(depth) {
  while (levels.length > depth) levels.pop().el.remove()
}

function focusLevel(depth) {
  levels[depth]?.el.focus({ preventScroll: true })
}

function activate(depth, i, fromMouse) {
  const it = levels[depth]?.items[i]
  if (!selectable(it) || closing) return
  if (it.sub) {
    closeFrom(depth + 1)
    const row = levels[depth].el.querySelector(`.ki[data-i="${i}"]`)
    open(it.sub, 0, 0, row)
    if (!fromMouse) {
      move(depth + 1, 1)
      focusLevel(depth + 1)
    }
    return
  }
  closing = true
  window.kmenu.pick(it.id)
}

function move(depth, dir) {
  const level = levels[depth]
  if (!level) return
  const n = level.items.length
  let i = level.sel
  for (let k = 0; k < n; k++) {
    i = (i + dir + n) % n
    if (selectable(level.items[i])) return setSel(depth, i)
  }
}

let typed = ''
let typedTimer = null
document.addEventListener('keydown', (e) => {
  const depth = levels.length - 1
  const level = levels[depth]
  if (!level) return
  e.preventDefault()
  if (e.key === 'ArrowDown') move(depth, 1)
  else if (e.key === 'ArrowUp') move(depth, -1)
  else if (e.key === 'Home') (levels[depth].sel = -1), move(depth, 1)
  else if (e.key === 'End') (levels[depth].sel = 0), move(depth, -1)
  else if (e.key === 'ArrowRight') {
    if (level.items[level.sel]?.sub) activate(depth, level.sel, false)
  } else if (e.key === 'ArrowLeft') {
    if (depth > 0) {
      closeFrom(depth)
      focusLevel(depth - 1)
    }
  } else if (e.key === 'Enter' || e.key === ' ') {
    if (level.sel >= 0) activate(depth, level.sel, false)
  } else if (e.key === 'Escape') {
    if (depth > 0) {
      closeFrom(depth)
      focusLevel(depth - 1)
    } else window.kmenu.close()
  } else if (e.key === 'Tab') move(depth, e.shiftKey ? -1 : 1)
  else if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
    // type to jump to an item
    clearTimeout(typedTimer)
    typed += e.key.toLowerCase()
    typedTimer = setTimeout(() => (typed = ''), 700)
    const start = typed.length === 1 ? level.sel + 1 : Math.max(level.sel, 0)
    const n = level.items.length
    for (let k = 0; k < n; k++) {
      const i = (start + k) % n
      if (selectable(level.items[i]) && String(level.items[i].label || '').toLowerCase().startsWith(typed)) return setSel(depth, i)
    }
  }
})

// clicking (or right-clicking) outside every menu closes them
document.addEventListener('mousedown', (e) => {
  if (!e.target.closest('.km')) window.kmenu.close()
})
document.addEventListener('contextmenu', (e) => e.preventDefault())
// the mouse leaving a submenu's row towards nothing: close deeper menus later
document.addEventListener('mousemove', (e) => {
  if (e.target.closest('.km')) return
  clearTimeout(hoverTimer)
})
