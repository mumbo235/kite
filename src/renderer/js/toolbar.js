// Toolbar: nav buttons, address bar with suggestions, action buttons.
import { S, api, $, h, esc, activeTab, setOverlay } from './main.js'
import { icon } from './icons.js'
import { fixBrokenFavicons } from './tabs.js'

const BUTTONS = {
  back: { icon: 'back', title: 'Back', action: 'back' },
  forward: { icon: 'forward', title: 'Forward', action: 'forward' },
  reload: { icon: 'reload', title: 'Reload', action: 'reload' },
  home: { icon: 'home', title: 'Home', action: 'home' },
  shield: { icon: 'shieldCheck', title: 'Ad & tracker blocker' },
  bookmark: { icon: 'star', title: 'Bookmark this page', action: 'bookmarkPage' },
  downloads: { icon: 'download', title: 'Downloads', action: 'openDownloads' },
  palette: { icon: 'command', title: 'Command palette', action: 'commandPalette' },
  menu: { icon: 'dots', title: 'Menu' },
}

// ---------- extensions ----------
// Pinned extensions sit on the toolbar; the rest (and turned-off ones) live
// in the Extensions menu. Right-click any of them for pin / off / remove.
let extList = []
let extEls = null
const partition = () => `persist:kite-${S.profile}`

function extensionsArea() {
  const wrap = h(`<div class="ext-area"></div>`)
  const list = document.createElement('browser-action-list')
  list.setAttribute('partition', partition())
  list.setAttribute('alignment', 'bottom left')
  const btn = h(`<button class="icon-btn tb-btn ext-btn" title="Extensions">${icon('blocks')}</button>`)
  btn.onclick = () => {
    const r = btn.getBoundingClientRect()
    api.call('menu.extensions', r.left, r.bottom + 4, { x: r.left, y: r.top, width: r.width, height: r.height })
  }
  wrap.append(list, btn)
  extEls = { list, btn }
  initExtensions()
  applyPins()
  // the list fills in asynchronously; hide unpinned ones as they appear
  setTimeout(applyPins, 300)
  return wrap
}

function applyPins() {
  if (!extEls) return
  const unpinned = new Set(S.settings.unpinnedExtensions || [])
  const root = extEls.list.shadowRoot
  if (root) {
    let st = root.querySelector('style[data-kite-pins]')
    if (!st) {
      st = document.createElement('style')
      st.dataset.kitePins = ''
      root.appendChild(st)
    }
    const ids = [...unpinned].filter((id) => /^[a-p]{32}$/.test(id))
    st.textContent = ids.length ? ids.map((id) => `#${id}`).join(', ') + ' { display: none !important; }' : ''
  }
  // the Extensions button shows once something is installed
  extEls.btn.style.display = extList.length ? '' : 'none'
}

export function setExtensions(list) {
  extList = list || []
  applyPins()
}
// set up once, the first time the toolbar shows extensions (not at module
// load: main.js, which provides api, imports this file)
let extReady = false
function initExtensions() {
  if (extReady) return
  extReady = true
  api.call('extensions.list').then(setExtensions).catch(() => {})
  api.on('extensions', setExtensions)

  // Kite's own right-click menu for extension buttons (instead of the
  // extension library's, which has no pin / turn off / remove)
  addEventListener(
    'contextmenu',
    (e) => {
      const btn = e.composedPath().find((n) => n.classList?.contains('action') && n.getRootNode()?.host?.localName === 'browser-action-list')
      if (!btn) return
      e.preventDefault()
      e.stopImmediatePropagation()
      api.call('menu.extension', btn.id, e.clientX, e.clientY)
    },
    true
  )

  // "Open" from the Extensions menu: show its popup under the menu button
  api.on('ext-activate', ({ id, anchor }) => {
    const btn = extEls?.list.shadowRoot?.getElementById(id)
    const r = anchor || extEls?.btn.getBoundingClientRect()
    window.browserAction?.activate(partition(), { eventType: 'click', extensionId: id, tabId: btn?.tab ?? -1, alignment: 'bottom left', anchorRect: { x: r.x, y: r.y, width: r.width, height: r.height } })
  })
  api.on('settings', () => setTimeout(applyPins))
}

let addrInput = null
let editing = false

export function renderToolbar() {
  const tb = $('#toolbar')
  const controls = tb.querySelector('.win-controls')
  tb.replaceChildren()
  const show = h(`<button class="icon-btn sb-show" data-sb-show title="Show sidebar">${icon('sidebar')}</button>`)
  show.onclick = () => api.call('actions.run', 'toggleSidebar')
  tb.appendChild(show)
  for (const item of S.settings.toolbar) {
    if (!item.visible) continue
    if (item.id === 'address') tb.appendChild(addressBar())
    else if (item.id === 'extensions') tb.appendChild(extensionsArea())
    else if (BUTTONS[item.id]) {
      const b = BUTTONS[item.id]
      const el = h(`<button class="icon-btn tb-btn" data-tb="${item.id}" title="${b.title}">${icon(b.icon)}</button>`)
      el.addEventListener('click', (e) => {
        if (item.id === 'menu') {
          const r = el.getBoundingClientRect()
          api.call('menu.app', r.right - 4, r.bottom + 4)
        } else if (item.id === 'shield') shieldMenu(el)
        else if (item.id === 'downloads') toggleDownloads(el)
        else if (item.id === 'reload' && activeTab()?.loading) api.call('nav.stop')
        else api.call('actions.run', b.action)
      })
      tb.appendChild(el)
    }
  }
  if (!S.settings.toolbar.find((i) => i.id === 'address' && i.visible)) tb.appendChild(h('<div class="spacer"></div>'))
  if (controls) tb.appendChild(controls)
  tb.ondblclick = (e) => {
    if (e.target === tb) api.call('window.maximize')
  }
  updateToolbarState(true)
}

function addressBar() {
  const el = h(`<div class="address">
    <span class="site"></span>
    <input spellcheck="false" placeholder="Search or enter address" />
    <div class="url-view"></div>
    <span class="chips"></span>
    <div class="load-bar"></div>
  </div>`)
  addrInput = el.querySelector('input')
  addrInput.addEventListener('focus', () => {
    el.classList.add('focus')
    // Focus coming straight back (e.g. the dropdown appearing briefly took
    // it) must not select everything, or your next letter replaces what you
    // typed. Only a fresh click/shortcut into the bar selects all.
    if (editing && Date.now() - blurredAt < 400) return
    editing = true
    requestAnimationFrame(() => addrInput.select())
  })
  let blurredAt = 0
  addrInput.addEventListener('blur', () => {
    blurredAt = Date.now()
    setTimeout(() => {
      if (document.activeElement !== addrInput || !document.hasFocus()) {
        el.classList.remove('focus', 'typing')
        editing = false
        closeSuggestions()
        updateToolbarState(true)
      }
    }, 150)
  })
  addrInput.addEventListener('input', (e) => {
    el.classList.add('typing')
    typed = addrInput.value
    completed = null
    suggest(typed, !(e.inputType || '').startsWith('delete'))
  })
  addrInput.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      moveSel(e.key === 'ArrowDown' ? 1 : -1)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const s = suggestions[sel]
      if (s && sel > 0) choose(s, e.altKey || e.ctrlKey)
      else go(completed ? completed.url : addrInput.value, e.altKey || e.ctrlKey)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      if (suggestions.length) closeSuggestions()
      else {
        editing = false
        updateToolbarState(true)
        api.call('nav.focusPage')
      }
    } else if (e.key === 'Tab' && suggestions.length) {
      e.preventDefault()
      moveSel(e.shiftKey ? -1 : 1)
    } else if ((e.key === 'ArrowRight' || e.key === 'End') && completed) {
      // accept the inline completion and keep typing after it
      typed = addrInput.value
    }
  })
  return el
}

function go(text, newTab) {
  if (!text.trim()) return
  closeSuggestions()
  editing = false
  addrInput.blur()
  api.call('nav.go', text, { newTab })
}

function choose(s, newTab) {
  closeSuggestions()
  editing = false
  addrInput.blur()
  if (s.type === 'tab') api.call('tabs.activate', s.tabId)
  else api.call('nav.go', s.url, { newTab })
}

export function focusAddress() {
  if (!addrInput) return
  addrInput.focus()
  addrInput.select()
  // focus can arrive before the bar is laid out; make sure it sticks
  requestAnimationFrame(() => {
    if (document.activeElement !== addrInput) addrInput.focus()
    addrInput.select()
  })
}

function displayURL(url) {
  if (!url || url.startsWith('kite://newtab')) return ''
  return url
}

export function updateToolbarState(force) {
  const t = activeTab()
  const tb = $('#toolbar')
  if (!tb || !S.settings) return
  const btn = (id) => tb.querySelector(`[data-tb="${id}"]`)
  if (btn('back')) btn('back').disabled = !t?.canGoBack
  if (btn('forward')) btn('forward').disabled = !t?.canGoForward
  if (btn('reload')) {
    const want = t?.loading ? 'x' : 'reload'
    if (btn('reload')._ic !== want) {
      btn('reload').innerHTML = icon(want)
      btn('reload')._ic = want
      btn('reload').title = t?.loading ? 'Stop' : 'Reload'
    }
  }
  if (btn('bookmark')) {
    btn('bookmark').classList.toggle('on', !!t?.bookmarked)
    btn('bookmark').querySelector('svg').style.fill = t?.bookmarked ? 'currentColor' : 'none'
  }
  if (btn('shield')) {
    const allowed = isAllowlisted(t?.url)
    const on = S.settings.adblock && !allowed
    btn('shield').classList.toggle('shield-off', !on)
    setHTML(btn('shield').querySelector('svg') ? btn('shield') : btn('shield'), icon(on ? 'shieldCheck' : 'shield'), 'ic')
    setBadge(btn('shield'), on && t?.blocked ? (t.blocked > 99 ? '99+' : String(t.blocked)) : '')
    btn('shield').title = on ? `${t?.blocked || 0} ads & trackers blocked on this page` : 'Ad blocker off for this site'
  }
  if (btn('downloads')) {
    const active = S.downloads.filter((d) => d.state === 'progressing')
    const b = btn('downloads')
    if (active.length) {
      const total = active.reduce((a, d) => a + (d.total || 0), 0)
      const got = active.reduce((a, d) => a + d.received, 0)
      const pct = total ? got / total : 0.25
      const C = 2 * Math.PI * 11
      if (!b.querySelector('.ring')) b.innerHTML = `${icon('download')}<svg class="ring" viewBox="0 0 24 24"><circle cx="12" cy="12" r="11" stroke-dasharray="${C}"/></svg>`
      b.querySelector('.ring circle').setAttribute('stroke-dashoffset', String(C * (1 - pct)))
    } else if (b.querySelector('.ring') || !b.querySelector('svg')) b.innerHTML = icon('download')
  }

  const addr = tb.querySelector('.address')
  if (!addr) return
  addr.classList.toggle('loading', !!t?.loading)
  const url = t?.url || ''
  const site = addr.querySelector('.site')
  const internal = url.startsWith('kite://')
  if (!open) {
    site.className = 'site ' + (url.startsWith('http://') ? 'insecure' : 'secure')
    setHTML(site, internal || !url ? icon(url && !url.startsWith('kite://newtab') ? 'kite' : 'search') : icon(url.startsWith('https://') ? 'lock' : 'unlock'))
  }
  site.title = url.startsWith('https://') ? 'Connection is secure' : url.startsWith('http://') ? 'Connection is not secure' : ''

  const chips = addr.querySelector('.chips')
  if (setHTML(chips, t && t.zoom && Math.abs(t.zoom - (S.settings.pageZoom || 1)) > 0.01 ? `<button class="zoom-chip" title="Reset zoom">${Math.round(t.zoom * 100)}%</button>` : ''))
    chips.querySelector('.zoom-chip')?.addEventListener('click', () => api.call('zoom.by', 0))

  if (!editing || force) {
    // a different tab became active: show its address even if the bar is focused
    if (!editing || force === 'tab') {
      addrInput.value = displayURL(url)
      if (document.activeElement === addrInput) addrInput.select()
    }
    const view = addr.querySelector('.url-view')
    const shown = displayURL(url)
    try {
      const u = new URL(shown)
      if (u.protocol.startsWith('http')) {
        view.innerHTML = `<span>${esc(u.protocol)}//</span><b>${esc(u.host)}</b><span>${esc(u.pathname + u.search + u.hash)}</span>`
        // "site name only" setting, or a bare home page: just the domain
        if (S.settings.addressFullUrl === false || (u.pathname === '/' && !u.search && !u.hash)) view.innerHTML = `<b>${esc(u.host.replace(/^www\./, ''))}</b>`
      } else view.textContent = shown
    } catch {
      view.textContent = shown
    }
  }
}

// Set innerHTML only when it differs (avoids replaying animations / reloading images).
function setHTML(el, html, key = 'html') {
  if (el['_' + key] === html) return false
  el['_' + key] = html
  if (key === 'ic') {
    const badge = el.querySelector('.badge')
    el.innerHTML = html
    if (badge) el.appendChild(badge)
  } else el.innerHTML = html
  return true
}

function setBadge(el, text) {
  let badge = el.querySelector('.badge')
  if (!text) return badge?.remove()
  if (!badge) {
    badge = document.createElement('span')
    badge.className = 'badge'
    el.appendChild(badge)
  }
  if (badge.textContent !== text) badge.textContent = text
}

function isAllowlisted(url) {
  try {
    const host = new URL(url).hostname
    return (S.settings.adblockAllowlist || []).some((d) => host === d || host.endsWith('.' + d))
  } catch {
    return false
  }
}

async function shieldMenu(el) {
  const t = activeTab()
  let host = ''
  try {
    host = new URL(t.url).hostname.replace(/^www\./, '')
  } catch {}
  const allowed = isAllowlisted(t?.url)
  const stats = await api.call('adblock.stats')
  setOverlay(true)
  const r = el.getBoundingClientRect()
  const ov = $('#overlay')
  ov.innerHTML = ''
  const bd = h('<div class="backdrop clear"></div>')
  const pop = h(`<div class="popover dialog" style="left:auto;transform:none;top:${r.bottom + 6}px;right:${Math.max(8, innerWidth - r.right)}px;width:300px">
      <h3>${icon('shieldCheck')} Shields</h3>
      <div class="muted">${S.settings.adblock ? `${t?.blocked || 0} blocked on this page · ${stats.total} this session` : 'Ad blocker is turned off'}${stats.ready ? '' : ' · loading filter lists…'}</div>
      ${host ? `<label style="flex-direction:row;align-items:center;justify-content:space-between;color:var(--text)">Block on ${esc(host)}<input type="checkbox" class="switch" data-k="site" ${allowed ? '' : 'checked'} ${S.settings.adblock ? '' : 'disabled'}></label>` : ''}
      <label style="flex-direction:row;align-items:center;justify-content:space-between;color:var(--text)">Ad blocker (all sites)<input type="checkbox" class="switch" data-k="all" ${S.settings.adblock ? 'checked' : ''}></label>
    </div>`)
  const close = () => setOverlay(false)
  bd.onclick = close
  pop.querySelector('[data-k="site"]')?.addEventListener('change', () => api.call('adblock.toggleSite').then(close))
  pop.querySelector('[data-k="all"]').addEventListener('change', (e) => api.call('settings.set', { adblock: e.target.checked }).then(close))
  ov.append(bd, pop)
  document.addEventListener('keydown', function onKey(e) {
    if (e.key === 'Escape') {
      document.removeEventListener('keydown', onKey)
      if (document.body.classList.contains('overlay')) close()
    }
  })
}

// ---------- suggestions (drawn in a floating popup layer above the page) ----------
let suggestions = []
let sel = -1
let open = false
let reqId = 0
let typed = ''
let completed = null // { host, url } when the input shows an inline completion

const favURL = (url) => (/^https?:/.test(url || '') ? 'kite://favicon/?u=' + encodeURIComponent(url) : '')
const ICON_FOR = { bookmark: 'star', history: 'history', search: 'search', tab: 'layers' }

async function suggest(text, allowComplete) {
  const id = ++reqId
  if (!text.trim()) return closeSuggestions()
  const res = await api.call('suggest', text)
  if (id !== reqId || !editing) return
  // inline autocomplete, e.g. "yo" -> "yo|utube.com" (the rest selected)
  completed = null
  if (allowComplete && res.complete && addrInput.value === text && addrInput.selectionEnd === text.length) {
    const host = res.complete.host
    if (host.toLowerCase().startsWith(text.toLowerCase())) {
      addrInput.value = text + host.slice(text.length)
      addrInput.setSelectionRange(text.length, addrInput.value.length)
      completed = res.complete
    }
  }
  const looksUrl = /^\S+\.\S+$|^\w+:\/\/|^localhost/.test(text)
  const first = completed
    ? { type: 'go', title: completed.host, url: completed.url, sub: 'Open site' }
    : { type: 'go', title: text, url: text, sub: looksUrl ? 'Open' : 'Search', search: !looksUrl }
  suggestions = [first, ...res.items.filter((s) => !(completed && bareHost(s.url) === completed.host && s.type === 'history'))]
  sel = 0
  drawSuggestions(!open)
}

const bareHost = (url) => {
  try {
    return new URL(url).host.replace(/^www\./, '')
  } catch {
    return ''
  }
}

function rowIcon(s) {
  const fallback = icon(s.type === 'go' ? (s.search ? 'search' : 'globe') : ICON_FOR[s.type] || 'globe')
  const fav = s.type !== 'search' && !s.search ? favURL(s.url.includes('://') ? s.url : 'https://' + s.url) : ''
  return fav ? `<img src="${esc(fav)}" data-fallback="${esc(fallback)}" alt="">` : fallback
}

function cssVars() {
  const cs = getComputedStyle(document.documentElement)
  const out = {}
  for (const k of ['--bg', '--surface', '--surface-2', '--surface-3', '--text', '--muted', '--border', '--accent', '--accent-text', '--accent-soft', '--radius', '--font', '--fs', '--speed', '--shadow']) {
    const v = cs.getPropertyValue(k)
    if (v) out[k] = v.trim()
  }
  out['color-scheme'] = cs.colorScheme
  return out
}

function drawSuggestions(fresh) {
  const addr = $('.address')
  if (!addr) return
  dlOpen = false
  open = true
  const r = addr.getBoundingClientRect()
  const tagFor = { bookmark: 'Bookmark', history: 'History', search: '', tab: 'Switch to tab', go: '' }
  const html = suggestions
    .map((s, i) => {
      const title = s.type === 'go' && completed ? `<b>${esc(typed)}</b>${esc(s.title.slice(typed.length))}` : esc(s.title || s.url)
      const sub = s.type === 'go' ? esc(s.sub) : s.type === 'search' ? '' : esc(s.url)
      return `<div class="sugg ${i === sel ? 'sel' : ''}" data-i="${i}"><span class="ic">${rowIcon(s)}</span><span class="t">${title}</span><span class="u">${sub ? '— ' + sub : ''}</span><span class="tag">${tagFor[s.type] || ''}</span></div>`
    })
    .join('')
  const pad = 14
  api.call('popup.show', { x: r.left - 4 - pad, y: r.bottom + 2, width: Math.max(380, r.width + 8) + pad * 2, maxHeight: Math.round(innerHeight * 0.7) }, html, cssVars(), fresh)
  // the site icon in the address bar follows the selected suggestion
  const s = suggestions[sel]
  const site = addr.querySelector('.site')
  if (site && s) {
    site.className = 'site'
    site.innerHTML = rowIcon(s)
    const img = site.querySelector('img')
    if (img) img.onerror = () => (site.innerHTML = img.dataset.fallback)
  }
}

window.kite.on('popup-pick', ({ index, newTab }) => {
  if (typeof index === 'string') return downloadAction(index)
  const s = suggestions[index]
  if (!s) return
  if (s.type === 'go') go(s.url, newTab)
  else choose(s, newTab)
})

function moveSel(d) {
  if (!suggestions.length) return
  sel = (sel + d + suggestions.length) % suggestions.length
  const s = suggestions[sel]
  if (sel === 0) {
    addrInput.value = completed ? completed.host : typed
  } else {
    addrInput.value = s.type === 'search' ? s.title : s.url
  }
  drawSuggestions(false)
}

function closeSuggestions() {
  reqId++
  suggestions = []
  sel = -1
  completed = null
  if (open) {
    open = false
    api.call('popup.hide')
  }
}

// ---------- downloads dropdown (drawn in the floating popup layer) ----------
let dlOpen = false
let dlAnchor = null

const fmtSize = (n) => (!n ? '' : n > 1e9 ? (n / 1e9).toFixed(1) + ' GB' : n > 1e6 ? (n / 1e6).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1e3)) + ' KB')

const DL_CSS = `<style>
  .dl-head { display: flex; align-items: center; gap: 8px; padding: 6px 8px 8px; font-size: 13px; }
  .dl-head b { flex: 1; font-weight: 600; }
  .dl-link { border: 0; background: none; color: var(--accent); font: inherit; font-size: 12px; padding: 4px 6px; border-radius: 6px; }
  .dl-link:hover { background: var(--accent-soft); }
  .dl-row { display: flex; align-items: center; gap: 10px; padding: 8px; border-radius: var(--radius-sm); }
  .dl-row:hover { background: var(--surface-2); }
  .dl-row.done { cursor: default; }
  .dl-ic { width: 32px; height: 32px; flex: none; display: grid; place-items: center; border-radius: 8px; background: var(--surface-2); color: var(--muted); }
  .dl-row:hover .dl-ic { background: var(--surface-3); }
  .dl-main { flex: 1; min-width: 0; }
  .dl-name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 13px; }
  .dl-sub { font-size: 11.5px; color: var(--muted); margin-top: 1px; }
  .dl-sub.bad { color: var(--danger, #dc2626); }
  .dl-bar { height: 3px; margin-top: 5px; border-radius: 3px; background: var(--surface-3); overflow: hidden; }
  .dl-bar i { display: block; height: 100%; background: var(--accent); border-radius: 3px; transition: width 200ms linear; }
  .dl-acts { display: flex; gap: 2px; }
  .dl-acts button { width: 28px; height: 28px; border: 0; border-radius: 7px; background: transparent; color: var(--muted); display: grid; place-items: center; }
  .dl-acts button:hover { background: var(--surface-3); color: var(--text); }
  .dl-acts .icon { width: 15px; height: 15px; }
  .dl-empty { padding: 22px 8px 18px; text-align: center; color: var(--muted); font-size: 13px; }
  .dl-foot { display: flex; padding: 6px 2px 2px; margin-top: 4px; border-top: 1px solid var(--border); }
</style>`

function downloadsHTML() {
  const list = S.downloads.slice(0, 6)
  const rows = list
    .map((d) => {
      const live = d.state === 'progressing' || d.state === 'paused'
      const pct = d.total ? Math.round((d.received / d.total) * 100) : 0
      let sub = ''
      let bad = false
      if (d.state === 'progressing') sub = `${fmtSize(d.received)}${d.total ? ' of ' + fmtSize(d.total) : ''}`
      else if (d.state === 'paused') sub = `Paused · ${fmtSize(d.received)}${d.total ? ' of ' + fmtSize(d.total) : ''}`
      else if (d.state === 'completed') sub = fmtSize(d.received) || 'Done'
      else {
        sub = d.state === 'cancelled' ? 'Cancelled' : 'Failed'
        bad = true
      }
      const acts = live
        ? `<button data-act="pause:${d.id}" title="${d.state === 'paused' ? 'Resume' : 'Pause'}">${icon(d.state === 'paused' ? 'play' : 'pause')}</button><button data-act="cancel:${d.id}" title="Cancel">${icon('x')}</button>`
        : d.state === 'completed'
          ? `<button data-act="show:${d.id}" title="Show in folder">${icon('folder')}</button>`
          : ''
      return `<div class="dl-row ${d.state === 'completed' ? 'done' : ''}" ${d.state === 'completed' ? `data-act="open:${d.id}" title="Open ${esc(d.name)}"` : ''}>
        <span class="dl-ic">${icon('file')}</span>
        <div class="dl-main"><div class="dl-name">${esc(d.name)}</div><div class="dl-sub ${bad ? 'bad' : ''}">${esc(sub)}</div>${live ? `<div class="dl-bar"><i style="width:${pct}%"></i></div>` : ''}</div>
        <div class="dl-acts">${acts}</div></div>`
    })
    .join('')
  return `${DL_CSS}<div class="dl-head"><b>Downloads</b>${S.downloads.length ? '<button class="dl-link" data-act="all">See all</button>' : ''}</div>
    ${rows || '<div class="dl-empty">No downloads yet</div>'}
    <div class="dl-foot"><button class="dl-link" data-act="folder">Open downloads folder</button></div>`
}

function drawDownloads(fresh) {
  if (!dlAnchor?.isConnected) dlAnchor = $('#toolbar [data-tb="downloads"]')
  if (!dlAnchor) return
  const r = dlAnchor.getBoundingClientRect()
  const pad = 14
  const width = 360
  const x = Math.max(0, Math.round(r.right + 4 - width - pad))
  api.call('popup.show', { x, y: r.bottom + 2, width: width + pad * 2, maxHeight: Math.round(innerHeight * 0.8) }, downloadsHTML(), cssVars(), fresh, 'downloads')
}

function toggleDownloads(btn) {
  if (dlOpen) return closeDownloads()
  if (open) closeSuggestions()
  dlAnchor = btn
  dlOpen = true
  btn.classList.add('on')
  drawDownloads(true)
}

export function closeDownloads() {
  if (!dlOpen) return
  dlOpen = false
  dlAnchor?.classList.remove('on')
  api.call('popup.hide')
}

// live progress while it's open
export function refreshDownloadsDropdown() {
  if (dlOpen) drawDownloads(false)
}

function downloadAction(act) {
  const [what, id] = act.split(':')
  if (what === 'all') {
    closeDownloads()
    return api.call('actions.run', 'openDownloads')
  }
  if (what === 'folder') {
    closeDownloads()
    return api.call('downloads.folder')
  }
  if (what === 'open') closeDownloads()
  api.call('downloads.' + what, +id)
}

window.kite.on('popup-closed', () => {
  dlOpen = false
  dlAnchor?.classList.remove('on')
})
// clicking anywhere else in the browser UI, or Escape, closes it
document.addEventListener('mousedown', (e) => {
  if (dlOpen && !e.target.closest('[data-tb="downloads"]')) closeDownloads()
})
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && dlOpen) closeDownloads()
})
