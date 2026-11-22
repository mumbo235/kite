// Tab lists (vertical sidebar list, pinned grid, horizontal strip) with
// keyed rendering, FLIP reorder animation and drag-to-reorder.
import { S, api, $, h, esc } from './main.js'
import { icon } from './icons.js'

const els = new Map() // key -> element (key = container + id)

function favHTML(t) {
  if (t.loading && !t.sleeping) return '<div class="spinner"></div>'
  if (t.url.startsWith('kite://settings')) return icon('sliders')
  if (t.url.startsWith('kite://history')) return icon('history')
  if (t.url.startsWith('kite://extensions')) return icon('blocks')
  if (t.url.startsWith('kite://')) return icon('zap')
  const cached = /^https?:/.test(t.url) ? 'kite://favicon/?u=' + encodeURIComponent(t.url) : ''
  if (t.favicon) return `<img src="${esc(t.favicon)}" data-fallback="${esc(cached)}" alt="">`
  if (cached) return `<img src="${esc(cached)}" alt="">`
  return icon('globe')
}

function title(t) {
  if (t.url.startsWith('kite://newtab') && (!t.title || t.title.startsWith('kite'))) return 'New tab'
  return t.title || t.url
}

function tabEl(t, kind) {
  const key = kind + t.id
  let el = els.get(key)
  const isNew = !el
  if (isNew) {
    el = h(`<div class="${kind === 'pin' ? 'pin-tab' : 'tab'}" draggable="true" data-id="${t.id}"></div>`)
    el.addEventListener('mousedown', (e) => {
      if (e.button === 0 && !e.target.closest('.close, .audio')) api.call('tabs.activate', +el.dataset.id)
    })
    el.addEventListener('auxclick', (e) => {
      if (e.button === 1) api.call('tabs.close', +el.dataset.id)
    })
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault()
      api.call('tabs.menu', +el.dataset.id, e.clientX, e.clientY)
    })
    el.addEventListener('click', (e) => {
      if (e.target.closest('.close')) api.call('tabs.close', +el.dataset.id)
      else if (e.target.closest('.audio')) api.call('tabs.mute', +el.dataset.id)
    })
    wireDrag(el)
    if (rendered) el.classList.add('entering')
    el.addEventListener('animationend', () => el.classList.remove('entering'))
    els.set(key, el)
  }
  const sig = [t.favicon, t.frozen, t.loading, t.audible, t.muted, t.sleeping, t.pinned, t.id === S.activeId, t.url.startsWith('kite://') ? t.url : ''].join('|')
  const label = title(t)
  if (el._sig === sig && el._label !== label) {
    el._label = label
    const ts = el.querySelector('.title')
    if (ts) ts.textContent = label
    el.title = label + (t.url && !t.url.startsWith('kite://') ? '\n' + t.url : '')
  }
  if (el._sig !== sig) {
    el._label = label
    el._sig = sig
    el.classList.toggle('active', t.id === S.activeId)
    el.classList.toggle('sleeping', !!t.sleeping)
    el.classList.toggle('frozen', !!t.frozen)
    el.classList.toggle('pinned', !!t.pinned)
    el.title = title(t) + (t.url && !t.url.startsWith('kite://') ? '\n' + t.url : '')
    if (kind === 'pin') el.innerHTML = favHTML(t)
    else {
      const audio = t.muted ? icon('mute') : t.audible ? icon('volume') : ''
      el.innerHTML = `<span class="fav">${favHTML(t)}</span><span class="title">${esc(title(t))}</span>${
        audio ? `<button class="icon-btn sm audio" title="${t.muted ? 'Unmute' : 'Mute'}">${audio}</button>` : ''
      }<button class="icon-btn sm close" title="Close tab">${icon('x')}</button>`
    }
    fixBrokenFavicons(el)
  }
  return el
}

let rendered = false

function sync(container, list, kind) {
  // FLIP: record old positions
  const first = new Map()
  const fixed = container.querySelector('.htab-new')
  for (const el of container.children) if (!el.classList.contains('leaving') && el !== fixed) first.set(el, el.getBoundingClientRect())

  const keep = new Set()
  const ordered = list.map((t) => {
    const el = tabEl(t, kind)
    keep.add(el)
    return el
  })
  // animate out removed tabs
  for (const el of [...container.children]) {
    if (el === fixed) continue
    if (!keep.has(el) && !el.classList.contains('leaving')) {
      for (const [k, v] of els) if (v === el) els.delete(k)
      if (!rendered || document.documentElement.classList.contains('no-anim')) {
        el.remove()
        continue
      }
      el.style.height = el.offsetHeight + 'px'
      el.style.maxWidth = el.offsetWidth + 'px'
      el.offsetWidth // reflow
      el.classList.add('leaving')
      setTimeout(() => el.remove(), 300)
    }
  }
  // place in order (leaving elements stay where they are)
  let prev = null
  for (const el of ordered) {
    const want = prev ? prev.nextSibling : container.firstChild
    if (el !== want) container.insertBefore(el, want)
    prev = el
  }
  if (fixed && container.lastElementChild !== fixed) container.appendChild(fixed)
  // FLIP: animate moved elements
  for (const el of ordered) {
    const a = first.get(el)
    if (!a) continue
    const b = el.getBoundingClientRect()
    const dx = a.left - b.left
    const dy = a.top - b.top
    if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
      el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], {
        duration: 220 * (S.settings.animationSpeed || 1),
        easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
      })
    }
  }
}

export function renderTabs() {
  if (!S.settings) return
  const visible = S.tabs.filter((t) => t.workspace === S.workspace)
  const vertical = S.settings.tabLayout === 'vertical'
  if (vertical) {
    sync($('#pinned'), visible.filter((t) => t.pinned), 'pin')
    sync($('#vtabs'), visible.filter((t) => !t.pinned), 'v')
    for (const el of [...$('#htabs').children]) if (!el.classList.contains('htab-new')) el.remove()
    for (const k of [...els.keys()]) if (k.startsWith('h')) els.delete(k)
  } else {
    sync($('#htabs'), visible, 'h')
    $('#pinned').replaceChildren()
    $('#vtabs').replaceChildren()
    for (const k of [...els.keys()]) if (!k.startsWith('h')) els.delete(k)
  }
  const ws = S.workspaces.find((w) => w.id === S.workspace)
  $('#ws-label').innerHTML = ws && S.workspaces.length > 1 ? `<span style="display:flex;gap:6px;align-items:center">${icon(ws.icon || 'layers')} ${esc(ws.name)}</span><span class="line"></span>` : ''
  const active = (vertical ? $('#vtabs, #pinned') : $('#htabs')) && document.querySelector(vertical ? '#vtabs .tab.active, #pinned .active' : '#htabs .tab.active')
  if (active && active !== lastScrolled) {
    lastScrolled = active
    active.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }
  rendered = true
}
let lastScrolled = null

// ---------- drag to reorder ----------
let dragId = null

function wireDrag(el) {
  el.addEventListener('dragstart', (e) => {
    dragId = +el.dataset.id
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', String(dragId))
    const t = S.tabs.find((x) => x.id === dragId)
    if (t && t.url) e.dataTransfer.setData('text/uri-list', t.url)
    requestAnimationFrame(() => el.classList.add('dragging'))
  })
  el.addEventListener('dragend', () => {
    el.classList.remove('dragging')
    clearMarks()
    dragId = null
  })
  el.addEventListener('dragover', (e) => {
    if (dragId == null) return
    e.preventDefault()
    clearMarks()
    const r = el.getBoundingClientRect()
    const horizontal = el.parentElement.id === 'htabs' || el.classList.contains('pin-tab')
    const after = horizontal ? e.clientX > r.left + r.width / 2 : e.clientY > r.top + r.height / 2
    el.classList.add(after ? 'drop-after' : 'drop-before')
  })
  el.addEventListener('drop', (e) => {
    e.preventDefault()
    if (dragId == null) return
    const targetId = +el.dataset.id
    const after = el.classList.contains('drop-after')
    clearMarks()
    if (targetId === dragId) return
    const order = S.tabs.map((t) => t.id).filter((id) => id !== dragId)
    let idx = order.indexOf(targetId) + (after ? 1 : 0)
    const target = S.tabs.find((t) => t.id === targetId)
    const dragged = S.tabs.find((t) => t.id === dragId)
    if (target && dragged && !!target.pinned !== !!dragged.pinned) api.call('tabs.pin', dragId)
    api.call('tabs.move', dragId, idx)
  })
}

function clearMarks() {
  document.querySelectorAll('.drop-before, .drop-after').forEach((x) => x.classList.remove('drop-before', 'drop-after'))
}

// Mouse wheel scrolls the top tab strip when there are too many tabs to fit.
document.querySelector('#htabs')?.addEventListener(
  'wheel',
  (e) => {
    const strip = e.currentTarget
    if (strip.scrollWidth <= strip.clientWidth) return
    e.preventDefault()
    strip.scrollLeft += e.deltaY || e.deltaX
  },
  { passive: false }
)

// Dropping a tab onto the pinned area pins it.
for (const sel of ['#pinned', '#sb-scroll']) {
  const zone = document.querySelector(sel)
  zone?.addEventListener('dragover', (e) => {
    if (dragId != null) e.preventDefault()
  })
}
document.querySelector('#pinned')?.addEventListener('drop', (e) => {
  if (dragId == null || e.target.closest('.pin-tab')) return
  const t = S.tabs.find((x) => x.id === dragId)
  if (t && !t.pinned) api.call('tabs.pin', dragId)
})

export function fixBrokenFavicons(root) {
  for (const img of root.querySelectorAll('img')) {
    const onError = () => {
      // try the cached icon first, then give up and show a globe
      if (img.dataset.fallback && img.src !== img.dataset.fallback) {
        img.src = img.dataset.fallback
        return
      }
      img.removeEventListener('error', onError)
      const fb = h(`<span class="fav-fallback" style="display:contents">${icon('globe')}</span>`)
      if ((img.dataset.fallback || img.getAttribute('src') || '').startsWith('kite://favicon/')) fb.dataset.src = img.dataset.fallback || img.getAttribute('src')
      img.replaceWith(fb)
    }
    img.addEventListener('error', onError)
  }
}
