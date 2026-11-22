// Sidebar chrome: tool rail, web panels, workspaces, resizing, auto-hide.
import { S, api, $, h, esc, setSettings, addWebPanel, newWorkspace, animatedChange, reportLayout, setResizing } from './main.js'
import { icon } from './icons.js'
import { openTool, closeTool } from './panels.js'
import { fixBrokenFavicons } from './tabs.js'

export const TOOLS = {
  ai: { icon: 'sparkles', title: 'AI chat' },
  bookmarks: { icon: 'bookmark', title: 'Bookmarks' },
  history: { icon: 'history', title: 'History' },
  downloads: { icon: 'download', title: 'Downloads' },
  notes: { icon: 'note', title: 'Notes' },
  todo: { icon: 'todo', title: 'To-do' },
  performance: { icon: 'gauge', title: 'Performance' },
}

function faviconFor(url) {
  try {
    return url ? 'kite://favicon/?u=' + encodeURIComponent(url) : ''
  } catch {
    return ''
  }
}

export function renderSidebar() {
  if (!S.settings) return
  const rail = $('#rail')
  const items = []
  for (const t of S.settings.sidebarTools) {
    if (!t.visible || !TOOLS[t.id]) continue
    items.push(`<button class="icon-btn rail-btn ${S.tool === t.id ? 'on' : ''}" data-tool="${t.id}" title="${TOOLS[t.id].title}">${icon(TOOLS[t.id].icon)}</button>`)
  }
  if (S.settings.webPanels.length) items.push('<div class="rail-sep"></div>')
  for (const p of S.settings.webPanels) {
    const id = 'web:' + p.id
    items.push(`<button class="icon-btn rail-btn ${S.tool === id ? 'on' : ''}" data-tool="${id}" title="${esc(p.title)}"><img src="${esc(faviconFor(p.url))}" alt=""></button>`)
  }
  const html = items.join('')
  if (rail._html !== html) {
    rail._html = html
    rail.innerHTML = html
    fixBrokenFavicons(rail)
  }
  rail.onclick = (e) => {
    const b = e.target.closest('button')
    if (!b) return
    const id = b.dataset.tool
    S.tool === id ? closeTool() : openTool(id)
  }
  rail.oncontextmenu = (e) => {
    const b = e.target.closest('[data-tool^="web:"]')
    if (!b) return
    e.preventDefault()
    const pid = b.dataset.tool.slice(4)
    if (confirm('Remove this web panel?')) {
      if (S.tool === b.dataset.tool) closeTool()
      api.call('panel.remove', b.dataset.tool)
      setSettings({ webPanels: S.settings.webPanels.filter((p) => p.id !== pid) })
    }
  }

  // workspaces
  const ws = $('#workspaces')
  const wsHtml =
    S.workspaces
      .map((w) => `<button class="ws ${w.id === S.workspace ? 'active' : ''}" data-ws="${w.id}" title="${esc(w.name)} (right-click to edit)" style="--ws-color:${esc(w.color)}">${icon(w.icon || 'layers')}</button>`)
      .join('') +
    `<button class="ws" data-ws-new title="New workspace">${icon('plus')}</button>` +
    `<button class="icon-btn ws-settings" data-settings title="Settings">${icon('sliders')}</button>`
  if (ws._html !== wsHtml) {
    ws._html = wsHtml
    ws.innerHTML = wsHtml
  }
  ws.onclick = (e) => {
    const b = e.target.closest('button')
    if (!b) return
    if (b.hasAttribute('data-settings')) return api.call('actions.run', 'openSettings')
    if (b.hasAttribute('data-ws-new')) newWorkspace()
    else api.call('workspaces.switch', b.dataset.ws)
  }
  ws.oncontextmenu = (e) => {
    const b = e.target.closest('[data-ws]')
    if (!b) return
    e.preventDefault()
    newWorkspace(S.workspaces.find((w) => w.id === b.dataset.ws))
  }
  // Accept tabs dropped onto a workspace button.
  ws.ondragover = (e) => e.target.closest('[data-ws]') && e.preventDefault()
  ws.ondrop = (e) => {
    const b = e.target.closest('[data-ws]')
    const id = +e.dataTransfer.getData('text/plain')
    if (b && id) api.call('tabs.toWorkspace', id, b.dataset.ws)
  }
}

export function setupResizers() {
  for (const r of document.querySelectorAll('.resizer')) {
    r.addEventListener('mousedown', (e) => {
      e.preventDefault()
      const which = r.dataset.resize
      const el = which === 'sidebar' ? $('#sidebar') : $('#panel')
      const startX = e.clientX
      const startW = el.getBoundingClientRect().width
      const dir = S.settings.sidebarSide === 'right' ? -1 : 1
      r.classList.add('active')
      setResizing(true)
      document.body.style.cursor = 'col-resize'
      el.style.transition = 'none'
      const varName = which === 'sidebar' ? '--sb-width' : '--panel-width'
      const [min, max] = which === 'sidebar' ? [180, 480] : [300, 900]
      let w = startW
      const move = (ev) => {
        w = Math.round(Math.min(max, Math.max(min, startW + (ev.clientX - startX) * dir)))
        document.documentElement.style.setProperty(varName, w + 'px')
        reportLayout()
      }
      const up = () => {
        document.removeEventListener('mousemove', move)
        document.removeEventListener('mouseup', up)
        r.classList.remove('active')
        document.body.style.cursor = ''
        el.style.transition = ''
        setSettings(which === 'sidebar' ? { sidebarWidth: w } : { panelWidth: w }).finally(() => setResizing(false))
      }
      document.addEventListener('mousemove', move)
      document.addEventListener('mouseup', up)
    })
  }
}

export function setupAutoHide() {
  const body = document.body
  let t = null
  const peek = () => {
    clearTimeout(t)
    if (!body.classList.contains('sb-autohide') || body.classList.contains('sb-peek')) return
    if (!S.settings.sidebarCollapsed) return
    animatedChange(() => body.classList.add('sb-peek'))
  }
  const unpeek = () => {
    clearTimeout(t)
    t = setTimeout(() => {
      if (body.classList.contains('overlay')) return
      animatedChange(() => body.classList.remove('sb-peek'))
    }, 450)
  }
  $('#hot-edge').addEventListener('mouseenter', peek)
  $('#sidebar').addEventListener('mouseenter', () => clearTimeout(t))
  $('#sidebar').addEventListener('mouseleave', unpeek)
}
