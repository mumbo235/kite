// Browser UI entry: owns UI state and reports layout to the main process.
import { applyTheme, onSystemThemeChange } from './theme.js'
import { icon } from './icons.js'
import { renderTabs, fixBrokenFavicons } from './tabs.js'
import { renderToolbar, focusAddress, updateToolbarState } from './toolbar.js'
import { renderSidebar, setupResizers, setupAutoHide } from './sidebar.js'
import { openPalette, toast, prompt } from './overlay.js'
import { renderPanel, openTool, closeTool } from './panels.js'
import { renderFindbar, showFind } from './find.js'
import { renderBookmarksBar, editBookmark } from './bookmarksbar.js'

const api = window.kite
export const S = {
  settings: null,
  themes: [],
  tabs: [],
  activeId: null,
  workspace: 'default',
  workspaces: [],
  bookmarks: [],
  downloads: [],
  tool: null, // open sidebar tool id
  win: {},
}
export { api }

export const $ = (sel, root = document) => root.querySelector(sel)
export const h = (html) => {
  const t = document.createElement('template')
  t.innerHTML = html.trim()
  return t.content.firstElementChild
}
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
export const activeTab = () => S.tabs.find((t) => t.id === S.activeId)

// ---------- layout reporting ----------
let lastContent = ''
let lastPanel = ''
let holdLayout = false // while animating, keep the pages at their old size
export function reportLayout() {
  if (holdLayout) return
  const contentEl = $('#content')
  const c = contentEl.getBoundingClientRect()
  const radius = parseFloat(getComputedStyle(contentEl).borderTopLeftRadius) || 0
  const cs = JSON.stringify([c.x, c.y, c.width, c.height, radius])
  if (cs !== lastContent) {
    lastContent = cs
    api.call('layout.content', { x: c.x, y: c.y, width: c.width, height: c.height, radius })
  }
  const web = $('#panel-web')
  const isWeb = S.tool && (S.tool === 'ai' || S.tool.startsWith('web:'))
  let p = null
  if (isWeb && $('#panel').classList.contains('open')) {
    const r = web.getBoundingClientRect()
    p = { x: r.x, y: r.y, width: r.width, height: r.height, radius: parseFloat(getComputedStyle($('.panel-card')).borderTopLeftRadius) || 0 }
  }
  const ps = JSON.stringify(p)
  if (ps !== lastPanel) {
    lastPanel = ps
    api.call('layout.panel', p)
  }
}

// Report the final layout once a change has settled.
export function animateLayout(ms = 0) {
  setTimeout(reportLayout, ms)
}

new ResizeObserver(() => reportLayout()).observe($('#content'))
new ResizeObserver(() => reportLayout()).observe($('#panel-web'))

// ---------- smooth layout animations ----------
// Web pages are native views that can't be animated. For sidebar / panel /
// layout changes we swap them for screenshots, run the CSS animation on the
// screenshots, then put the real pages back at their new size.
const animationsOn = () => S.settings?.animations !== false && !matchMedia('(prefers-reduced-motion: reduce)').matches
let queue = Promise.resolve()

export function animatedChange(apply) {
  queue = queue.then(() => runAnimated(apply)).catch((e) => console.error(e))
  return queue
}

async function runAnimated(apply) {
  if (!animationsOn()) {
    apply()
    reportLayout()
    return
  }
  const sb = $('#sidebar')
  const pn = $('#panel')
  const rect = (el) => {
    const r = el.getBoundingClientRect()
    return { x: r.x, y: r.y, width: r.width, height: r.height }
  }
  // 1. where things are now
  const from = { sb: sb.getBoundingClientRect().width, pn: pn.getBoundingClientRect().width, content: rect($('#content')) }
  // 2. jump to the end state without transitions, just to measure it
  holdLayout = true
  document.body.classList.add('measuring')
  apply()
  const to = { sb: sb.getBoundingClientRect().width, pn: pn.getBoundingClientRect().width, content: rect($('#content')) }
  document.body.classList.remove('measuring')
  void document.body.offsetWidth
  const duration = Math.round(240 * (S.settings.animationSpeed || 1))
  const easing = 'cubic-bezier(0.16, 1, 0.3, 1)'
  // 3. the main process slides the real page along (moving is cheap; it is
  //    resized only once), while the UI animates the sidebar/panel widths
  api.call('layout.animate', { from: from.content, to: to.content, duration })
  const anims = []
  if (from.sb !== to.sb) anims.push(sb.animate([{ width: from.sb + 'px' }, { width: to.sb + 'px' }], { duration, easing }))
  if (from.pn !== to.pn) anims.push(pn.animate([{ width: from.pn + 'px' }, { width: to.pn + 'px' }], { duration, easing }))
  await Promise.all(anims.map((a) => a.finished.catch(() => {})))
  holdLayout = false
  reportLayout()
}

function showSnap(host, shot) {
  if (!shot) return null
  const w = host.getBoundingClientRect().width
  const el = h(`<div class="snap"><img alt="" style="width:${w}px"><div class="snap-edge"></div></div>`)
  const img = el.querySelector('img')
  img.src = shot.src
  // the page's right edge (scrollbar etc.) stays pinned to the right side
  const edge = el.querySelector('.snap-edge')
  edge.style.backgroundImage = `url("${shot.src}")`
  edge.style.backgroundSize = `${w}px auto`
  // fill any area the screenshot doesn't cover with the page's own edge colour
  img.decode().then(() => {
    try {
      const c = document.createElement('canvas')
      c.width = c.height = 1
      const ctx = c.getContext('2d')
      ctx.drawImage(img, img.naturalWidth - 2, Math.floor(img.naturalHeight / 2), 1, 1, 0, 0, 1, 1)
      const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data
      el.style.background = `rgb(${r} ${g} ${b})`
    } catch {}
  }, () => {})
  host.appendChild(el)
  return el
}

// ---------- overlay mode ----------
// While a popup is open the UI is lifted above the page, which would hide it.
// So we first put a screenshot of the page (and side panel) in its place.
let overlayCount = 0
let closeTimer = null
let overlaySnaps = []
let overlayToken = 0
function clearOverlaySnaps() {
  for (const s of overlaySnaps) s?.remove()
  overlaySnaps = []
}
export function setOverlay(on) {
  overlayCount = Math.max(0, overlayCount + (on ? 1 : -1))
  const active = overlayCount > 0
  const body = document.body
  if (active) {
    clearTimeout(closeTimer)
    body.classList.remove('overlay-closing')
    if (!body.classList.contains('overlay')) {
      body.classList.add('overlay')
      const token = ++overlayToken
      api
        .call('layout.capture')
        .catch(() => ({}))
        .then(async (shots) => {
          if (token !== overlayToken || overlayCount === 0) return
          clearOverlaySnaps()
          overlaySnaps = [showSnap($('#content'), shots.page), showSnap($('#panel-web'), shots.panel)]
          await Promise.all(overlaySnaps.map((s) => s?.querySelector('img').decode().catch(() => {})))
          if (token !== overlayToken || overlayCount === 0) return clearOverlaySnaps()
          api.call('layout.overlay', true)
        })
    }
    return
  }
  if (!body.classList.contains('overlay')) return
  // play the exit animation, then drop the UI back below the page
  body.classList.add('overlay-closing')
  const ms = animationsOn() ? 130 * (S.settings?.animationSpeed || 1) : 0
  clearTimeout(closeTimer)
  overlayToken++
  closeTimer = setTimeout(() => {
    body.classList.remove('overlay', 'overlay-closing')
    $('#overlay').innerHTML = ''
    api.call('layout.overlay', false).then(() => requestAnimationFrame(clearOverlaySnaps))
  }, ms)
}

// ---------- settings + theme ----------
export function setSettings(patch) {
  Object.assign(S.settings, patch)
  applySettings()
  return api.call('settings.set', patch)
}

let layoutSig = null
function applySettings() {
  const s = S.settings
  applyTheme(s, S.themes)
  $('#custom-css').textContent = s.customCSS || ''
  // sliding animation only for the sidebar opening/closing; bigger layout
  // switches (tab position, sidebar side, compact, bookmarks bar) just snap
  const structure = JSON.stringify([s.tabLayout, s.sidebarSide, s.compact, s.showBookmarksBar])
  const slide = JSON.stringify([s.sidebarCollapsed, s.sidebarAutoHide])
  const animate = layoutSig !== null && !resizing && structure === layoutSig[0] && slide !== layoutSig[1]
  layoutSig = [structure, slide]
  if (animate) animatedChange(applyLayout)
  else applyLayout()
}

// set while the user drags a resize handle (no snapshot animation then)
export let resizing = false
export const setResizing = (v) => (resizing = v)

function applyLayout() {
  const s = S.settings
  const b = document.body.classList
  b.toggle('layout-vertical', s.tabLayout === 'vertical')
  b.toggle('layout-horizontal', s.tabLayout === 'horizontal')
  b.toggle('side-right', s.sidebarSide === 'right')
  b.toggle('side-left', s.sidebarSide !== 'right')
  b.toggle('sb-autohide', !!s.sidebarAutoHide)
  b.toggle('sb-hidden', !!s.sidebarCollapsed && (s.tabLayout === 'horizontal' || s.sidebarAutoHide))
  b.toggle('sb-mini', !!s.sidebarCollapsed && s.tabLayout === 'vertical' && !s.sidebarAutoHide)
  b.toggle('compact', !!s.compact)
  document.documentElement.style.setProperty('--sb-width', s.sidebarWidth + 'px')
  document.documentElement.style.setProperty('--panel-width', s.panelWidth + 'px')
  document.documentElement.style.setProperty('--htab-width', (s.tabWidth || 260) + 'px')
  placeChrome()
  renderToolbar()
  renderSidebar()
  renderTabs()
  renderBookmarksBar()
  renderPanel()
  reportLayout()
}

// Move the toolbar and window controls depending on the layout mode.
function placeChrome() {
  const s = S.settings
  const toolbar = $('#toolbar')
  const intoSidebar = s.tabLayout === 'vertical' && s.compact && !s.sidebarCollapsed
  const target = intoSidebar ? $('#sb-toolbar-slot') : $('#toolbar-home')
  if (toolbar.parentElement !== target) target.appendChild(toolbar)
  document.body.classList.toggle('tb-in-sidebar', intoSidebar)

  let controls = $('.win-controls')
  if (!controls) {
    controls = h(`<div class="win-controls">
      <button class="icon-btn" data-w="minimize" title="Minimize">${icon('minimize')}</button>
      <button class="icon-btn" data-w="maximize" title="Maximize">${icon('maximize')}</button>
      <button class="icon-btn close-win" data-w="close" title="Close">${icon('x')}</button></div>`)
    controls.addEventListener('click', (e) => {
      const b = e.target.closest('[data-w]')
      if (b) api.call('window.' + b.dataset.w)
    })
  }
  let slot
  if (s.tabLayout === 'horizontal') slot = $('#top-controls-slot')
  else if (intoSidebar) slot = $('#sb-controls-slot')
  else slot = toolbar
  if (controls.parentElement !== slot) slot.appendChild(controls)
  updateWindowControls()
}

function updateWindowControls() {
  const max = $('.win-controls [data-w="maximize"]')
  if (max) max.innerHTML = icon(S.win.maximized ? 'restore' : 'maximize')
}

// ---------- events from main ----------
api.on('tabs', (st) => {
  const prevActive = S.activeId
  Object.assign(S, { tabs: st.tabs, activeId: st.activeId, workspace: st.workspace, workspaces: st.workspaces })
  renderTabs()
  updateToolbarState(prevActive !== S.activeId)
  renderSidebar()
})
api.on('settings', (s) => {
  S.settings = s
  applySettings()
})
api.on('focus-address', () => focusAddress())
api.on('palette', () => openPalette())
api.on('find', (r) => showFind(r))
api.on('tool', (id) => (S.tool === id ? closeTool() : openTool(id)))
api.on('panel-open', (key) => {
  const id = key.startsWith('ai:') ? 'ai' : key
  if (S.tool !== id) openTool(id)
})
api.on('toast', (t) => toast(t.text, t.action))
api.on('downloads', (d) => {
  S.downloads = d
  updateToolbarState()
  if (S.tool === 'downloads') renderPanel()
})
api.on('data:bookmarks', (b) => {
  S.bookmarks = b
  renderBookmarksBar()
  if (S.tool === 'bookmarks') renderPanel()
})
api.on('data:workspaces', (w) => {
  S.workspaces = w
  renderSidebar()
})
api.on('window', (w) => {
  S.win = w
  updateWindowControls()
  updateWindowShape()
})

// Rounded window corners, except when maximized or full screen.
function updateWindowShape() {
  document.body.classList.toggle('win-square', !!(S.win.maximized || S.win.fullscreen))
  reportLayout()
}
api.on('add-web-panel', () => addWebPanel())
// Reload only the icons whose site got a new icon (no re-render = no flicker).
api.on('favicons', (hosts) => {
  const want = new Set(hosts)
  const hostOf = (src) => {
    try {
      return new URL(new URL(src).searchParams.get('u')).host
    } catch {
      return ''
    }
  }
  for (const el of document.querySelectorAll('img[src^="kite://favicon/"], .fav-fallback[data-src]')) {
    const src = el.tagName === 'IMG' ? el.getAttribute('src') : el.dataset.src
    if (!want.has(hostOf(src))) continue
    const fresh = src.replace(/&v=\d+$/, '') + '&v=' + Date.now()
    if (el.tagName === 'IMG') {
      const pre = new Image()
      pre.onload = () => (el.src = fresh)
      pre.src = fresh
    } else {
      const img = h(`<img alt="">`)
      img.src = fresh
      el.replaceWith(img)
      fixBrokenFavicons(img.parentElement)
    }
  }
})
api.on('edit-bookmark', (id) => editBookmark(id))
api.on('new-workspace', () => newWorkspace())
onSystemThemeChange(() => applySettings())

export async function addWebPanel() {
  const r = await prompt({
    title: 'Add web panel',
    fields: [
      { name: 'url', label: 'URL', placeholder: 'https://music.youtube.com', value: activeTab()?.url?.startsWith('http') ? activeTab().url : '' },
      { name: 'title', label: 'Name (optional)', placeholder: 'YouTube Music' },
    ],
    ok: 'Add panel',
  })
  if (!r || !r.url) return
  let url = r.url.trim()
  if (!/^https?:\/\//.test(url)) url = 'https://' + url
  const id = 'p' + Date.now().toString(36)
  let title = r.title
  if (!title) {
    try {
      title = new URL(url).hostname.replace(/^www\./, '')
    } catch {
      title = url
    }
  }
  await setSettings({ webPanels: [...S.settings.webPanels, { id, url, title }] })
  openTool('web:' + id)
}

export async function newWorkspace(existing) {
  const r = await prompt({
    title: existing ? 'Edit workspace' : 'New workspace',
    fields: [
      { name: 'name', label: 'Name', value: existing?.name || '', placeholder: 'Work' },
      { name: 'icon', label: 'Icon', type: 'icons', value: existing?.icon || 'briefcase' },
      { name: 'color', label: 'Color', type: 'color', value: existing?.color || '#8b5cf6' },
    ],
    ok: existing ? 'Save' : 'Create',
    extra: existing && S.workspaces.length > 1 ? { label: 'Delete', danger: true, value: 'delete' } : null,
  })
  if (!r) return
  if (r === 'delete') return api.call('workspaces.delete', existing.id)
  let list = [...S.workspaces]
  if (existing) list = list.map((w) => (w.id === existing.id ? { ...w, name: r.name || w.name, icon: r.icon || w.icon, color: r.color } : w))
  else list.push({ id: 'w' + Date.now().toString(36), name: r.name || 'Workspace', icon: r.icon || 'layers', color: r.color })
  await api.call('data.set', 'workspaces', list)
  if (!existing) api.call('workspaces.switch', list[list.length - 1].id)
}

// ---------- boot ----------
document.body.classList.add('platform-' + (window.kite.platform || 'linux'))

async function boot() {
  const [settings, themes, st, bookmarks, downloads, win, profiles] = await Promise.all([
    api.call('settings.get'),
    api.call('themes.list'),
    api.call('tabs.state'),
    api.call('data.get', 'bookmarks'),
    api.call('downloads.list'),
    api.call('window.state'),
    api.call('profiles.list'),
  ])
  S.profile = profiles.current
  document.body.classList.toggle('win-square', !!(win.maximized || win.fullscreen))
  Object.assign(S, { settings, themes, bookmarks, downloads, win, tabs: st.tabs, activeId: st.activeId, workspace: st.workspace, workspaces: st.workspaces })
  $('#sb-toggle').innerHTML = icon('sidebar')
  $('#sb-toggle').onclick = () => api.call('actions.run', 'toggleSidebar')
  for (const b of document.querySelectorAll('#topbar [data-sb-show]')) {
    b.innerHTML = icon('sidebar')
    b.onclick = () => api.call('actions.run', 'toggleSidebar')
  }
  $('#htab-new').innerHTML = icon('plus')
  $('#htab-new').onclick = () => api.call('tabs.new')
  $('#vtab-new').innerHTML = `${icon('plus')}<span>New tab</span>`
  $('#vtab-new').onclick = () => api.call('tabs.new')
  setupResizers()
  setupAutoHide()
  renderFindbar()
  applySettings()
  requestAnimationFrame(reportLayout)
}

// themes may change when custom themes are imported
api.on('settings', async (s) => {
  if (s.customThemes?.length !== S.themes.filter((t) => !t.builtin).length) {
    S.themes = await api.call('themes.list')
    applyTheme(S.settings, S.themes)
  }
})

boot()
