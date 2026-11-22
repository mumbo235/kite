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
    else if (item.id === 'extensions') {
      const list = document.createElement('browser-action-list')
      list.setAttribute('partition', `persist:kite-${S.profile}`)
      list.setAttribute('alignment', 'bottom left')
      tb.appendChild(list)
    } else if (BUTTONS[item.id]) {
      const b = BUTTONS[item.id]
      const el = h(`<button class="icon-btn tb-btn" data-tb="${item.id}" title="${b.title}">${icon(b.icon)}</button>`)
      el.addEventListener('click', (e) => {
        if (item.id === 'menu') {
          const r = el.getBoundingClientRect()
          api.call('menu.app', r.right - 4, r.bottom + 4)
        } else if (item.id === 'shield') shieldMenu(el)
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
    editing = true
    requestAnimationFrame(() => addrInput.select())
  })
  addrInput.addEventListener('blur', () => {
    el.classList.remove('focus', 'typing')
    setTimeout(() => {
      if (document.activeElement !== addrInput || !document.hasFocus()) {
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
    setHTML(site, internal || !url ? icon(url && !url.startsWith('kite://newtab') ? 'zap' : 'search') : icon(url.startsWith('https://') ? 'lock' : 'unlock'))
  }
  site.title = url.startsWith('https://') ? 'Connection is secure' : url.startsWith('http://') ? 'Connection is not secure' : ''

  const chips = addr.querySelector('.chips')
  if (setHTML(chips, t && t.zoom && Math.abs(t.zoom - 1) > 0.01 ? `<button class="zoom-chip" title="Reset zoom">${Math.round(t.zoom * 100)}%</button>` : ''))
    chips.querySelector('.zoom-chip')?.addEventListener('click', () => api.call('zoom.by', 0))

  if (!editing || force) {
    if (!editing) addrInput.value = displayURL(url)
    const view = addr.querySelector('.url-view')
    const shown = displayURL(url)
    try {
      const u = new URL(shown)
      if (u.protocol.startsWith('http')) {
        view.innerHTML = `<span>${esc(u.protocol)}//</span><b>${esc(u.host)}</b><span>${esc(u.pathname + u.search + u.hash)}</span>`
        if (u.pathname === '/' && !u.search && !u.hash) view.innerHTML = `<b>${esc(u.host.replace(/^www\./, ''))}</b>`
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
