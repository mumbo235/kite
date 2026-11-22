// kite://newtab — clock, search, shortcuts and a customizable background.
import { init, api, $, esc, onSettings } from 'kite://shared/page.js'
import { icon } from 'kite://ui/js/icons.js'

// Gradient presets. `light: true` means dark text reads better on top.
export const GRADIENTS = {
  aurora: { name: 'Aurora', css: 'radial-gradient(at 15% 20%, #4f46e5 0, transparent 50%), radial-gradient(at 85% 25%, #0891b2 0, transparent 50%), radial-gradient(at 50% 95%, #059669 0, transparent 55%), #0b1020' },
  midnight: { name: 'Midnight', css: 'linear-gradient(135deg, #0f0c29, #302b63, #24243e)' },
  ocean: { name: 'Ocean', css: 'linear-gradient(135deg, #1e3c72, #2a5298, #6dd5ed)' },
  sunset: { name: 'Sunset', css: 'linear-gradient(135deg, #ff5f6d, #ffc371)' },
  dusk: { name: 'Dusk', css: 'linear-gradient(135deg, #2c3e50, #fd746c)' },
  forest: { name: 'Forest', css: 'linear-gradient(135deg, #134e5e, #71b280)' },
  ember: { name: 'Ember', css: 'linear-gradient(135deg, #f12711, #f5af19)' },
  berry: { name: 'Berry', css: 'linear-gradient(135deg, #8e2de2, #f093fb)' },
  lagoon: { name: 'Lagoon', css: 'linear-gradient(135deg, #00b09b, #96c93d)' },
  peach: { name: 'Peach', css: 'linear-gradient(135deg, #ffecd2, #fcb69f)', light: true },
  lavender: { name: 'Lavender', css: 'linear-gradient(135deg, #e0c3fc, #8ec5fc)', light: true },
  mist: { name: 'Mist', css: 'linear-gradient(160deg, #f5f7fa, #c3cfe2)', light: true },
}
const COLORS = ['#0f172a', '#1e293b', '#334155', '#18181b', '#1c1917', '#7f1d1d', '#9a3412', '#854d0e', '#166534', '#115e59', '#1e3a8a', '#4c1d95', '#831843', '#f8fafc', '#f5f5f4', '#fef3c7', '#dcfce7', '#dbeafe']
const TYPES = [
  ['daily', 'Daily'],
  ['gradient', 'Gradient'],
  ['solid', 'Color'],
  ['image', 'Custom'],
]

let s = await init()
const engines = await api.call('engines.list')
let daily = []
let custom = []

const bgOf = () => ({ type: 'daily', daily: 0, gradient: 'aurora', color: '#1e293b', image: '', dim: 0.2, blur: 0, ...(s.newtab.background || {}) })

function setNewtab(patch) {
  s = { ...s, newtab: { ...s.newtab, ...patch } }
  render()
  return api.call('settings.set', { newtab: s.newtab })
}
function setBg(patch) {
  return setNewtab({ background: { ...bgOf(), ...patch } })
}

function isLight(hex) {
  const n = parseInt(hex.replace('#', ''), 16)
  const r = (n >> 16) & 255,
    g = (n >> 8) & 255,
    b = n & 255
  return 0.299 * r + 0.587 * g + 0.114 * b > 160
}

// ---------- background ----------
let shownKey = ''
async function paintBackground() {
  const bg = bgOf()
  const el = $('#bg')
  const body = document.body
  let key = ''
  let css = ''
  let photo = ''
  let tone = '' // on-dark | on-light | ''
  let credit = ''

  if (bg.type === 'daily') {
    if (!daily.length) {
      // first load: show a gradient while today's photo downloads
      css = GRADIENTS.aurora.css
      tone = 'on-dark'
      loadDaily()
    } else {
      const pick = (bg.daily && daily.find((d) => d.date === bg.daily)) || daily[0]
      photo = pick.url
      tone = 'on-dark'
      credit = `<b>${esc(pick.title)}</b> ${esc(pick.copyright)}`
      $('#credit').href = pick.link || '#'
    }
  } else if (bg.type === 'gradient') {
    const g = GRADIENTS[bg.gradient] || GRADIENTS.aurora
    css = g.css
    tone = g.light ? 'on-light' : 'on-dark'
  } else if (bg.type === 'solid') {
    css = bg.color
    tone = isLight(bg.color) ? 'on-light' : 'on-dark'
  } else if (bg.type === 'image' && bg.image) {
    photo = bg.image
    tone = 'on-dark'
  }

  body.classList.toggle('on-dark', tone === 'on-dark')
  body.classList.toggle('on-light', tone === 'on-light')
  body.classList.toggle('has-bg', !!tone)
  $('#credit').innerHTML = credit
  const isPhoto = !!photo
  $('#shade').style.opacity = isPhoto ? bg.dim : 0
  el.style.filter = isPhoto && bg.blur ? `blur(${bg.blur}px)` : ''

  key = photo || css
  if (key === shownKey) return
  shownKey = key
  const apply = () => {
    el.style.background = photo ? `center / cover no-repeat url("${photo.replace(/"/g, '%22')}")` : css
    el.classList.add('ready')
  }
  if (photo) {
    const img = new Image()
    // Kite's own photos allow reading their colors (accent from the photo);
    // pictures from other sites may not, so don't ask for that there
    if (photo.startsWith('kite://')) img.crossOrigin = 'anonymous'
    img.onload = () => {
      if (s.accentFromWallpaper) pickAccent(img)
      el.classList.remove('ready')
      requestAnimationFrame(() => requestAnimationFrame(apply))
    }
    img.onerror = () => {
      el.style.background = GRADIENTS.midnight.css
      el.classList.add('ready')
    }
    img.src = photo
  } else apply()
}

let dailyLoading = null
function loadDaily() {
  dailyLoading ||= api
    .call('bg.daily')
    .then((list) => {
      daily = list
      if (daily.length) {
        paintBackground()
        if ($('#drawer').classList.contains('open')) renderOptions()
      }
    })
    .catch(() => {})
  return dailyLoading
}

// ---------- pin the background to the window ----------
function setViewport(v) {
  if (!v || !v.winWidth) return
  const root = document.documentElement.style
  root.setProperty('--vx', v.x + 'px')
  root.setProperty('--vy', v.y + 'px')
  root.setProperty('--ww', v.winWidth + 'px')
  root.setProperty('--wh', v.winHeight + 'px')
}
api.call('layout.viewport').then(setViewport)
api.on('viewport', setViewport)

// "Accent from today's photo": a vivid color from the picture becomes the
// browser's accent color.
function pickAccent(img) {
  try {
    const c = document.createElement('canvas')
    c.width = 48
    c.height = 27
    const ctx = c.getContext('2d', { willReadFrequently: true })
    ctx.drawImage(img, 0, 0, c.width, c.height)
    const d = ctx.getImageData(0, 0, c.width, c.height).data
    let best = null
    let bestScore = -1
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], g = d[i + 1], b = d[i + 2]
      const max = Math.max(r, g, b), min = Math.min(r, g, b)
      const sat = max ? (max - min) / max : 0
      const light = (max + min) / 510
      // prefer saturated, mid-brightness colors that work as an accent
      const score = sat * (1 - Math.abs(light - 0.5) * 1.6)
      if (score > bestScore) {
        bestScore = score
        best = [r, g, b]
      }
    }
    if (!best) return
    const hex = '#' + best.map((v) => v.toString(16).padStart(2, '0')).join('')
    if (hex !== s.wallpaperAccent) api.call('settings.set', { wallpaperAccent: hex })
  } catch {}
}

// ---------- page ----------
function render() {
  const n = s.newtab
  $('#clock').style.display = n.showClock ? '' : 'none'
  $('#brand').style.display = n.showLogo !== false ? '' : 'none'
  $('#search').style.display = n.showSearch ? '' : 'none'
  $('#tiles').style.display = n.showShortcuts ? '' : 'none'
  $('#greet').textContent = greetingText(n)
  $('#clock').dataset.style = n.clockStyle || 'thin'
  tick()
  $('#q').placeholder = `Search ${(engines[s.searchEngine] || engines.google).name} or type a URL`
  $('#tiles').innerHTML =
    n.shortcuts
      .map((t, i) => {
        let fav = ''
        try {
          fav = 'kite://favicon/?u=' + encodeURIComponent(t.url)
        } catch {}
        return `<a class="tile" href="${esc(t.url)}" style="animation-delay:${i * 30}ms"><div class="ico"><img src="${esc(fav)}" alt=""></div><span>${esc(t.title)}</span><button class="icon-btn sm rm" data-rm="${i}" title="Remove">${icon('x')}</button></a>`
      })
      .join('') + `<a class="tile" href="#" id="add"><div class="ico">${icon('plus')}</div><span>Add</span></a>`
  for (const img of document.querySelectorAll('.tile img')) img.onerror = () => (img.outerHTML = icon('globe'))
  paintBackground()
  syncDrawer()
}

// ---------- customize drawer ----------
function syncDrawer() {
  const bg = bgOf()
  $('#bg-type').innerHTML = TYPES.map(([v, l]) => `<button data-t="${v}" class="${bg.type === v ? 'on' : ''}">${l}</button>`).join('')
  for (const c of document.querySelectorAll('[data-show]')) c.checked = !!s.newtab[c.dataset.show]
  if (document.activeElement !== $('#greeting')) $('#greeting').value = s.newtab.greetingMode === 'custom' ? s.newtab.greeting || '' : ''
  if (document.activeElement !== $('#yourname')) $('#yourname').value = s.newtab.name || ''
  $('#dim').value = bg.dim
  $('#blur').value = bg.blur
  $('#sliders').style.display = bg.type === 'daily' || bg.type === 'image' ? '' : 'none'
  if ($('#drawer').classList.contains('open')) renderOptions()
}

async function renderOptions() {
  const bg = bgOf()
  const box = $('#bg-options')
  if (bg.type === 'daily') {
    if (!daily.length) {
      box.innerHTML = '<p class="note">Loading today’s photo…</p>'
      return loadDaily()
    }
    const pinned = bg.daily && daily.find((d) => d.date === bg.daily)
    const today = daily[0]
    box.innerHTML = `<div style="display:flex;flex-direction:column;gap:10px">
      <button class="daily-hero ${!pinned ? 'on' : ''}" data-daily="0" style="background-image:url('${today.url}')"><div class="lbl"><b>New photo every day</b>Today: ${esc(today.title)}</div></button>
      <p class="note">Or keep one you like:</p>
      <div class="grid">${daily.map((d) => `<button class="pick ${pinned && pinned.date === d.date ? 'on' : ''}" data-daily="${d.date}" title="${esc(d.title + ' — ' + d.copyright)}" style="background-image:url('${d.url}')"><span class="lbl">${esc(d.date.slice(4, 6) + '/' + d.date.slice(6))}</span></button>`).join('')}</div>
      <p class="note">Scenic photos from Bing’s photo of the day.</p></div>`
  } else if (bg.type === 'gradient') {
    box.innerHTML = `<div class="grid">${Object.entries(GRADIENTS)
      .map(([id, g]) => `<button class="pick ${bg.gradient === id ? 'on' : ''}" data-grad="${id}" style="background:${g.css}"><span class="lbl">${g.name}</span></button>`)
      .join('')}</div>`
  } else if (bg.type === 'solid') {
    box.innerHTML = `<div class="grid colors">${COLORS.map((c) => `<button class="pick ${bg.color === c ? 'on' : ''}" data-color="${c}" style="background:${c}" title="${c}"></button>`).join('')}</div>
      <div class="row-inline" style="margin-top:10px"><span class="note">Custom</span><input type="color" id="color-custom" value="${bg.color}"></div>`
  } else if (bg.type === 'image') {
    custom = await api.call('bg.custom')
    box.innerHTML = `<div class="grid">
      <button class="pick add-pick" id="upload" title="Add pictures">${icon('plus')}</button>
      ${custom.map((c) => `<button class="pick ${bg.image === c.url ? 'on' : ''}" data-img="${esc(c.url)}" style="background-image:url('${esc(c.url)}')"><span class="x" data-del="${esc(c.file)}" title="Remove">${icon('x')}</span></button>`).join('')}</div>
      <p class="note">Add pictures from your computer, or paste an image link:</p>
      <form class="row-inline" id="url-form"><input class="input" id="img-url" placeholder="https://…/photo.jpg" spellcheck="false"><button class="btn">Use</button></form>`
  }
}

$('#bg-type').onclick = (e) => {
  const b = e.target.closest('[data-t]')
  if (b) setBg({ type: b.dataset.t })
}
$('#bg-options').onclick = async (e) => {
  const t = e.target
  const del = t.closest('[data-del]')
  if (del) {
    e.stopPropagation()
    await api.call('bg.removeCustom', decodeURIComponent(del.dataset.del))
    const url = 'kite://bg/custom/' + del.dataset.del
    if (bgOf().image === url) await setBg({ image: '' })
    return renderOptions()
  }
  if (t.closest('#upload')) {
    const added = await api.call('bg.addCustom')
    if (added.length) setBg({ type: 'image', image: added[0] })
    return renderOptions()
  }
  const d = t.closest('[data-daily]')
  if (d) return setBg({ daily: d.dataset.daily === '0' ? 0 : d.dataset.daily })
  const g = t.closest('[data-grad]')
  if (g) return setBg({ gradient: g.dataset.grad })
  const c = t.closest('[data-color]')
  if (c) return setBg({ color: c.dataset.color })
  const im = t.closest('[data-img]')
  if (im) return setBg({ image: im.dataset.img })
}
$('#bg-options').addEventListener('change', (e) => {
  if (e.target.id === 'color-custom') setBg({ color: e.target.value })
})
$('#bg-options').addEventListener('submit', (e) => {
  e.preventDefault()
  const url = $('#img-url').value.trim()
  if (/^https?:\/\//.test(url)) setBg({ type: 'image', image: url })
})
$('#dim').oninput = (e) => setBg({ dim: +e.target.value })
$('#blur').oninput = (e) => setBg({ blur: +e.target.value })
for (const c of document.querySelectorAll('[data-show]')) c.onchange = () => setNewtab({ [c.dataset.show]: c.checked })
$('#greeting').onchange = (e) => {
  const v = e.target.value.trim()
  setNewtab({ greeting: v, greetingMode: v ? 'custom' : s.newtab.name ? 'time' : 'off' })
}
$('#yourname').onchange = (e) => {
  const v = e.target.value.trim()
  setNewtab({ name: v, greetingMode: v ? 'time' : s.newtab.greetingMode === 'time' ? 'off' : s.newtab.greetingMode })
}
$('#more').onclick = () => api.call('nav.go', 'kite://settings#newtab')

function openDrawer(open) {
  $('#drawer').classList.toggle('open', open)
  if (open) renderOptions()
}
$('#customize').innerHTML = `${icon('edit')} Customize`
$('#customize').onclick = () => openDrawer(!$('#drawer').classList.contains('open'))
$('#close').innerHTML = icon('x')
$('#close').onclick = () => openDrawer(false)
document.addEventListener('keydown', (e) => e.key === 'Escape' && openDrawer(false))

// ---------- clock, search, shortcuts ----------
$('#search-ic').innerHTML = icon('search')
// greeting: off, by time of day with your name, or your own text
function greetingText(n) {
  if (n.greetingMode === 'custom') return n.greeting || ''
  if (n.greetingMode !== 'time') return ''
  const h = new Date().getHours()
  const part = h < 5 ? 'Good night' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'
  return n.name ? `${part}, ${n.name}` : part
}

function tick() {
  const n = s.newtab
  const now = new Date()
  const opts = { hour: n.clockFormat === '24' ? '2-digit' : 'numeric', minute: '2-digit' }
  if (n.showSeconds) opts.second = '2-digit'
  if (n.clockFormat === '12') opts.hour12 = true
  if (n.clockFormat === '24') opts.hourCycle = 'h23'
  $('#clock').textContent = now.toLocaleTimeString([], opts)
  const date = n.showDate ? now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' }) : ''
  if ($('#date').textContent !== date) $('#date').textContent = date
  // the time-of-day greeting changes on its own
  const g = greetingText(n)
  if ($('#greet').textContent !== g) $('#greet').textContent = g
}
tick()
setInterval(tick, 1000)

$('#search').onsubmit = (e) => {
  e.preventDefault()
  if ($('#q').value.trim()) api.call('nav.go', $('#q').value)
}
$('#tiles').onclick = (e) => {
  const rm = e.target.closest('[data-rm]')
  if (rm) {
    e.preventDefault()
    setNewtab({ shortcuts: s.newtab.shortcuts.filter((_, i) => i !== +rm.dataset.rm) })
    return
  }
  if (e.target.closest('#add')) {
    e.preventDefault()
    $('#add-dlg').showModal()
  }
}
$('#add-form').onsubmit = (e) => {
  e.preventDefault()
  let url = $('#add-url').value.trim()
  const name = $('#add-name').value.trim()
  $('#add-dlg').close()
  $('#add-form').reset()
  if (!url) return
  if (!/^https?:\/\//.test(url)) url = 'https://' + url
  let title = url
  try {
    title = new URL(url).hostname.replace(/^www\./, '').split('.')[0]
    title = title[0].toUpperCase() + title.slice(1)
  } catch {}
  setNewtab({ shortcuts: [...s.newtab.shortcuts, { title: name || title, url }] })
}
$('#add-cancel').onclick = () => $('#add-dlg').close()
const editLabel = (on) => `${icon(on ? 'check' : 'edit')} ${on ? 'Done' : 'Edit shortcuts'}`
$('#edit').innerHTML = editLabel(false)
$('#edit').onclick = () => {
  const on = document.body.classList.toggle('editing')
  $('#edit').innerHTML = editLabel(on)
}
$('#customize').innerHTML = `${icon('sliders')} Customize`

onSettings((ns) => {
  s = ns
  render()
})
render()
if (bgOf().type === 'daily') loadDaily()
