// New tab widgets: weather, calendar, news, to-do, notes and a daily quote.
// Each widget renders into its own card and only redraws the parts whose
// data changed, so typing in Notes or To-do never loses focus when settings
// update.
import { api, esc } from 'kite://shared/page.js'
import { icon } from 'kite://ui/js/icons.js'

export const WIDGETS = {
  weather: 'Weather',
  calendar: 'Calendar',
  news: 'News',
  todo: 'To-do',
  notes: 'Notes',
  quote: 'Quote of the day',
}
const ORDER = Object.keys(WIDGETS)

let host = null
let getS = () => ({})
let save = () => {}
let shownKey = ''
const state = {}

// Set up once: where to draw, how to read settings, how to save newtab changes
export function setupWidgets(el, getSettings, saveNewtab) {
  host = el
  getS = getSettings
  save = saveNewtab
  host.addEventListener('click', onClick)
  host.addEventListener('change', onChange)
  host.addEventListener('submit', onSubmit)
  host.addEventListener('input', onInput)
  host.addEventListener('keydown', onKeydown)
  // the calendar and quote move on at midnight; weather/news refresh hourly
  setInterval(() => {
    const day = new Date().toDateString()
    if (day !== state.day) {
      state.day = day
      draw.calendar?.(true)
      draw.quote?.(true)
    }
  }, 60000)
  setInterval(() => {
    state.wxKey = state.newsKey = ''
    renderWidgets()
  }, 30 * 60000)
}

const nt = () => getS().newtab || {}

export function renderWidgets() {
  if (!host) return
  const n = nt()
  const on = n.widgets || {}
  const order = [...new Set([...(n.widgetOrder || []), ...ORDER])].filter((k) => WIDGETS[k] && on[k])
  const key = order.join(',')
  if (key !== shownKey) {
    shownKey = key
    host.innerHTML = order.map((k, i) => `<section class="widget w-${k}" data-w="${k}" style="animation-delay:${i * 40}ms"></section>`).join('')
    state.wxKey = state.newsKey = state.todoKey = state.calKey = state.quoteKey = ''
    state.notesShown = false
  }
  host.style.display = order.length ? '' : 'none'
  document.body.classList.toggle('has-widgets', order.length > 0)
  for (const k of order) draw[k]?.()
}

const card = (k) => host.querySelector(`[data-w="${k}"]`)

// ---------- weather ----------
// WMO weather codes -> [label, icon]
const WX = {
  0: ['Clear', 'sun'],
  1: ['Mostly clear', 'sun'],
  2: ['Partly cloudy', 'part'],
  3: ['Cloudy', 'cloud'],
  45: ['Fog', 'fog'],
  48: ['Freezing fog', 'fog'],
  51: ['Light drizzle', 'rain'],
  53: ['Drizzle', 'rain'],
  55: ['Heavy drizzle', 'rain'],
  56: ['Freezing drizzle', 'rain'],
  57: ['Freezing drizzle', 'rain'],
  61: ['Light rain', 'rain'],
  63: ['Rain', 'rain'],
  65: ['Heavy rain', 'rain'],
  66: ['Freezing rain', 'rain'],
  67: ['Freezing rain', 'rain'],
  71: ['Light snow', 'snow'],
  73: ['Snow', 'snow'],
  75: ['Heavy snow', 'snow'],
  77: ['Snow grains', 'snow'],
  80: ['Showers', 'rain'],
  81: ['Showers', 'rain'],
  82: ['Heavy showers', 'rain'],
  85: ['Snow showers', 'snow'],
  86: ['Snow showers', 'snow'],
  95: ['Thunderstorm', 'storm'],
  96: ['Thunderstorm, hail', 'storm'],
  99: ['Thunderstorm, hail', 'storm'],
}
const sunPath = '<circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.5 1.5M17.2 17.2l1.5 1.5M5.3 18.7l1.5-1.5M17.2 6.8l1.5-1.5"/>'
const moonPath = '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>'
const cloudPath = '<path d="M7 18.5h10a4 4 0 0 0 .6-7.95A5.5 5.5 0 0 0 7 11.2 3.7 3.7 0 0 0 7 18.5z"/>'
const upCloud = `<g transform="translate(0 -3)">${cloudPath}</g>`
function wxIcon(kind, day = true, size = 22) {
  const body = {
    sun: day ? sunPath : moonPath,
    part: `<g transform="translate(-3 -4) scale(.7)">${day ? sunPath : moonPath}</g><path d="M8.5 20h9a3.6 3.6 0 0 0 .5-7.15A4.9 4.9 0 0 0 8.6 13.4 3.3 3.3 0 0 0 8.5 20z"/>`,
    cloud: cloudPath,
    fog: '<path d="M4 9h16M3 13h18M5 17h14"/>',
    rain: `${upCloud}<path d="M8.5 18l-1 2.5M12.5 18l-1 2.5M16.5 18l-1 2.5"/>`,
    snow: `${upCloud}<path d="M8 19.5h.01M12 21h.01M16 19.5h.01"/>`,
    storm: `${upCloud}<path d="M12.5 15.5l-2 3.5h3l-2 3.5"/>`,
  }[kind]
  return `<svg class="wx-ic wx-${kind}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${body || cloudPath}</svg>`
}

function units() {
  const u = nt().weather?.units || 'auto'
  if (u !== 'auto') return u
  const region = (navigator.language.split('-')[1] || '').toUpperCase()
  return ['US', 'LR', 'MM', 'BS', 'BZ', 'KY', 'PW'].includes(region) ? 'f' : 'c'
}

const draw = {}
draw.weather = async () => {
  const el = card('weather')
  const w = nt().weather || {}
  const place = w.place
  const key = place ? `${place.lat},${place.lon},${units()}` : 'none'
  if (state.wxKey === key && !state.wxEditing) return
  state.wxKey = key
  if (!place || state.wxEditing) return drawPlaceForm(el)
  const title = `<div class="w-head"><span>${esc(place.name)}</span><button class="w-link" data-act="wx-change" title="Change place">Change</button></div>`
  if (!el.innerHTML || el.dataset.loaded !== key) el.innerHTML = title + '<div class="w-loading">Loading weather…</div>'
  try {
    const d = await api.call('widgets.weather', { lat: place.lat, lon: place.lon, units: units() })
    if (state.wxKey !== key) return
    el.dataset.loaded = key
    const [label, kind] = WX[d.now.code] || ['', 'cloud']
    const deg = (v) => (v == null ? '–' : Math.round(v) + '°')
    const dayName = (iso, i) => (i === 0 ? 'Today' : new Date(iso + 'T12:00').toLocaleDateString([], { weekday: 'short' }))
    el.innerHTML =
      title +
      `<div class="wx-now">${wxIcon(kind, d.now.day, 44)}<div class="wx-temp">${deg(d.now.temp)}<small>${d.units.toUpperCase()}</small></div>
        <div class="wx-desc"><b>${esc(label)}</b><span>Feels like ${deg(d.now.feels)}</span><span>${Math.round(d.now.humidity ?? 0)}% humidity · ${Math.round(d.now.wind ?? 0)} ${d.wind}</span></div></div>
      <div class="wx-days">${d.days
        .map((x, i) => {
          const [l, k] = WX[x.code] || ['', 'cloud']
          return `<div class="wx-day" title="${esc(l)}${x.rain ? ` · ${x.rain}% rain` : ''}"><span>${dayName(x.date, i)}</span>${wxIcon(k)}<b>${deg(x.max)}</b><span>${deg(x.min)}</span></div>`
        })
        .join('')}</div>`
  } catch {
    if (state.wxKey !== key) return
    el.innerHTML = title + `<div class="w-empty">Couldn’t load the weather. <button class="w-link" data-act="wx-retry">Try again</button></div>`
  }
}

function drawPlaceForm(el, results = null, msg = '') {
  const w = nt().weather || {}
  el.innerHTML = `<div class="w-head"><span>Weather</span>${w.place ? '<button class="w-link" data-act="wx-cancel">Cancel</button>' : ''}</div>
    <form class="w-form" data-form="wx-find"><input class="input" name="q" placeholder="Your city or town" autocomplete="off" spellcheck="false" value="${esc(state.wxQuery || '')}"><button class="btn">Find</button></form>
    ${msg ? `<div class="w-empty">${esc(msg)}</div>` : ''}
    ${results ? `<div class="wx-results">${results.map((r, i) => `<button class="w-row" data-act="wx-pick" data-i="${i}"><b>${esc(r.name)}</b><span>${esc([r.region, r.country].filter(Boolean).join(', '))}</span></button>`).join('')}</div>` : ''}
    ${!results && !msg ? '<div class="w-empty">Forecasts from Open-Meteo. Only the place you pick is sent.</div>' : ''}`
  state.wxResults = results
}

// ---------- calendar ----------
let calOffset = 0
function firstDay() {
  try {
    const loc = new Intl.Locale(navigator.language)
    const info = loc.getWeekInfo?.() || loc.weekInfo
    if (info?.firstDay) return info.firstDay % 7
  } catch {}
  return navigator.language === 'en-US' ? 0 : 1
}
draw.calendar = (force) => {
  const el = card('calendar')
  if (!el) return
  const now = new Date()
  const key = now.toDateString() + calOffset
  if (state.calKey === key && !force) return
  state.calKey = key
  const view = new Date(now.getFullYear(), now.getMonth() + calOffset, 1)
  const fd = firstDay()
  const start = (view.getDay() - fd + 7) % 7
  const days = new Date(view.getFullYear(), view.getMonth() + 1, 0).getDate()
  const names = [...Array(7)].map((_, i) => new Date(2023, 0, 1 + ((i + fd) % 7)).toLocaleDateString([], { weekday: 'narrow' }))
  let cells = ''
  for (let i = 0; i < start; i++) cells += '<span></span>'
  for (let d = 1; d <= days; d++) {
    const today = calOffset === 0 && d === now.getDate()
    const dow = new Date(view.getFullYear(), view.getMonth(), d).getDay()
    cells += `<span class="${today ? 'today' : ''}${dow === 0 || dow === 6 ? ' wkend' : ''}">${d}</span>`
  }
  el.innerHTML = `<div class="w-head"><span>${view.toLocaleDateString([], { month: 'long', year: 'numeric' })}</span>
      <span class="cal-nav">${calOffset ? '<button class="w-link" data-act="cal-today">Today</button>' : ''}<button class="icon-btn sm" data-act="cal-prev" title="Previous month">${icon('chevronLeft')}</button><button class="icon-btn sm" data-act="cal-next" title="Next month">${icon('chevronRight')}</button></span></div>
    <div class="cal-grid">${names.map((x) => `<b>${x}</b>`).join('')}${cells}</div>`
}

// ---------- news ----------
const FEEDS = [
  ['bbc', 'BBC News'],
  ['bbcworld', 'BBC World'],
  ['npr', 'NPR'],
  ['guardian', 'The Guardian'],
  ['hn', 'Hacker News'],
  ['verge', 'The Verge'],
  ['ars', 'Ars Technica'],
  ['espn', 'ESPN'],
  ['custom', 'Your own feed…'],
]
function ago(t) {
  if (!t) return ''
  const m = Math.round((Date.now() - t) / 60000)
  if (m < 1) return 'now'
  if (m < 60) return m + 'm'
  if (m < 48 * 60) return Math.round(m / 60) + 'h'
  return Math.round(m / 1440) + 'd'
}
draw.news = async () => {
  const el = card('news')
  const cfg = { feed: 'bbc', url: '', count: 6, ...(nt().news || {}) }
  const key = `${cfg.feed}|${cfg.url}|${cfg.count}`
  if (state.newsKey === key) return
  state.newsKey = key
  const picker = `<select class="w-select" data-set="news.feed" title="News source">${FEEDS.map(([id, name]) => `<option value="${id}" ${cfg.feed === id ? 'selected' : ''}>${name}</option>`).join('')}</select>`
  const head = `<div class="w-head"><span>News</span>${picker}</div>`
  const urlForm = cfg.feed === 'custom' ? `<form class="w-form" data-form="news-url"><input class="input" name="url" placeholder="https://example.com/feed.xml" value="${esc(cfg.url)}" spellcheck="false"><button class="btn">Use</button></form>` : ''
  if (cfg.feed === 'custom' && !cfg.url) {
    el.innerHTML = head + urlForm + '<div class="w-empty">Paste the address of any RSS or Atom feed.</div>'
    return
  }
  el.innerHTML = head + urlForm + '<div class="w-loading">Loading headlines…</div>'
  try {
    const d = await api.call('widgets.news', { feed: cfg.feed, url: cfg.url, count: cfg.count })
    if (state.newsKey !== key) return
    el.innerHTML =
      head +
      urlForm +
      (d.items.length
        ? `<div class="news-list">${d.items.map((x) => `<a class="news-item" href="${esc(x.link)}"><span>${esc(x.title)}</span><time>${ago(x.date)}</time></a>`).join('')}</div>`
        : '<div class="w-empty">No headlines in this feed.</div>')
  } catch {
    if (state.newsKey !== key) return
    el.innerHTML = head + urlForm + `<div class="w-empty">Couldn’t load the news. <button class="w-link" data-act="news-retry">Try again</button></div>`
  }
}

// ---------- to-do ----------
draw.todo = () => {
  const el = card('todo')
  const todos = nt().todos || []
  const key = JSON.stringify(todos)
  if (state.todoKey === key) return
  state.todoKey = key
  const left = todos.filter((t) => !t.done).length
  const list = `<div class="todo-list">${todos
    .map((t, i) => `<label class="todo ${t.done ? 'done' : ''}"><input type="checkbox" data-todo="${i}" ${t.done ? 'checked' : ''}><span>${esc(t.text)}</span><button class="icon-btn sm" data-act="todo-rm" data-i="${i}" title="Remove">${icon('x')}</button></label>`)
    .join('')}</div>`
  const head = `<div class="w-head"><span>To-do${todos.length ? ` <small>${left} left</small>` : ''}</span>${todos.some((t) => t.done) ? '<button class="w-link" data-act="todo-clear">Clear done</button>' : ''}</div>`
  const form = el.querySelector('[data-form="todo-add"]')
  if (form) {
    // keep the input (and what you're typing) where it is
    el.querySelector('.w-head').outerHTML = head
    el.querySelector('.todo-list').outerHTML = list
  } else el.innerHTML = head + list + `<form class="w-form" data-form="todo-add"><input class="input" name="text" placeholder="Add a task" autocomplete="off" maxlength="200"></form>`
}

// ---------- notes ----------
let notesTimer = null
draw.notes = () => {
  const el = card('notes')
  if (!state.notesShown) {
    state.notesShown = true
    el.innerHTML = `<div class="w-head"><span>Notes</span><small class="notes-saved"></small></div><textarea class="notes" placeholder="Jot something down…" spellcheck="true"></textarea>`
  }
  const ta = el.querySelector('textarea')
  if (document.activeElement !== ta && !notesTimer) ta.value = nt().notes || ''
}

// ---------- quote ----------
const QUOTES = [
  ['The journey of a thousand miles begins with one step.', 'Lao Tzu'],
  ['Well done is better than well said.', 'Benjamin Franklin'],
  ['Waste no more time arguing what a good man should be. Be one.', 'Marcus Aurelius'],
  ['We suffer more often in imagination than in reality.', 'Seneca'],
  ['Do what you can, with what you have, where you are.', 'Theodore Roosevelt'],
  ['Adopt the pace of nature: her secret is patience.', 'Ralph Waldo Emerson'],
  ['Brevity is the soul of wit.', 'William Shakespeare'],
  ['Energy and persistence conquer all things.', 'Benjamin Franklin'],
  ['The best way out is always through.', 'Robert Frost'],
  ['Happiness depends upon ourselves.', 'Aristotle'],
  ['Fortune favours the bold.', 'Virgil'],
  ['Little by little, one travels far.', 'Proverb'],
  ['Dwell on the beauty of life. Watch the stars, and see yourself running with them.', 'Marcus Aurelius'],
  ['It is not that we have a short time to live, but that we waste a lot of it.', 'Seneca'],
  ['Turn your face to the sun and the shadows fall behind you.', 'Māori proverb'],
  ['Nothing is particularly hard if you divide it into small jobs.', 'Henry Ford'],
  ['Whatever you do, do it well.', 'Walt Whitman'],
  ['Our life is frittered away by detail. Simplify, simplify.', 'Henry David Thoreau'],
  ['The future depends on what you do today.', 'Mahatma Gandhi'],
  ['He who has a why to live can bear almost any how.', 'Friedrich Nietzsche'],
  ['Act as if what you do makes a difference. It does.', 'William James'],
  ['Be not afraid of going slowly; be afraid only of standing still.', 'Chinese proverb'],
  ['The secret of getting ahead is getting started.', 'Mark Twain'],
  ['Where there is no struggle, there is no strength.', 'Oprah Winfrey'],
  ['To improve is to change; to be perfect is to change often.', 'Winston Churchill'],
  ['Knowledge is power.', 'Francis Bacon'],
  ['What we achieve inwardly will change outer reality.', 'Plutarch'],
  ['Begin, be bold, and venture to be wise.', 'Horace'],
]
let quoteShift = 0
draw.quote = (force) => {
  const el = card('quote')
  if (!el) return
  const d = new Date()
  const dayNo = Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 86400000) + d.getFullYear() * 366
  const key = dayNo + quoteShift
  if (state.quoteKey === key && !force) return
  state.quoteKey = key
  const [text, who] = QUOTES[(((dayNo + quoteShift) % QUOTES.length) + QUOTES.length) % QUOTES.length]
  el.innerHTML = `<div class="w-head"><span>Quote of the day</span><button class="icon-btn sm" data-act="quote-next" title="Another one">${icon('reload')}</button></div>
    <blockquote>“${esc(text)}”</blockquote><cite>${esc(who)}</cite>`
}

// ---------- events ----------
function setNt(patch) {
  return save(patch)
}

async function onClick(e) {
  const b = e.target.closest('[data-act]')
  if (!b) return
  e.preventDefault()
  const act = b.dataset.act
  const n = nt()
  if (act === 'wx-change') {
    state.wxEditing = true
    state.wxQuery = ''
    drawPlaceForm(card('weather'))
    card('weather').querySelector('input')?.focus()
  } else if (act === 'wx-cancel') {
    state.wxEditing = false
    state.wxKey = ''
    draw.weather()
  } else if (act === 'wx-retry') {
    state.wxKey = ''
    draw.weather()
  } else if (act === 'wx-pick') {
    const place = state.wxResults?.[+b.dataset.i]
    if (!place) return
    state.wxEditing = false
    state.wxKey = ''
    setNt({ weather: { ...(n.weather || {}), place } })
  } else if (act === 'cal-prev' || act === 'cal-next' || act === 'cal-today') {
    calOffset = act === 'cal-today' ? 0 : calOffset + (act === 'cal-prev' ? -1 : 1)
    draw.calendar()
  } else if (act === 'news-retry') {
    state.newsKey = ''
    draw.news()
  } else if (act === 'todo-rm') {
    setNt({ todos: (n.todos || []).filter((_, i) => i !== +b.dataset.i) })
  } else if (act === 'todo-clear') {
    setNt({ todos: (n.todos || []).filter((t) => !t.done) })
  } else if (act === 'quote-next') {
    quoteShift++
    draw.quote()
  }
}

function onChange(e) {
  const t = e.target
  const n = nt()
  if (t.dataset.todo != null) {
    const todos = (n.todos || []).map((x, i) => (i === +t.dataset.todo ? { ...x, done: t.checked } : x))
    setNt({ todos })
  } else if (t.dataset.set === 'news.feed') {
    setNt({ news: { ...(n.news || {}), feed: t.value } })
  }
}

async function onSubmit(e) {
  const f = e.target.closest('[data-form]')
  if (!f) return
  e.preventDefault()
  const n = nt()
  const val = (name) => f.elements[name].value.trim()
  if (f.dataset.form === 'wx-find') {
    const q = val('q')
    state.wxQuery = q
    if (!q) return
    let results = []
    try {
      results = await api.call('widgets.findPlace', q)
    } catch {
      return drawPlaceForm(card('weather'), null, 'Couldn’t search right now. Check your connection.')
    }
    if (results.length === 1) {
      state.wxEditing = false
      state.wxKey = ''
      return setNt({ weather: { ...(n.weather || {}), place: results[0] } })
    }
    state.wxEditing = true
    drawPlaceForm(card('weather'), results.length ? results : null, results.length ? '' : `No place called “${q}” found.`)
  } else if (f.dataset.form === 'todo-add') {
    const text = val('text')
    if (!text) return
    f.reset()
    setNt({ todos: [...(n.todos || []), { text, done: false }] })
  } else if (f.dataset.form === 'news-url') {
    let url = val('url')
    if (url && !/^https?:\/\//i.test(url)) url = 'https://' + url
    setNt({ news: { ...(n.news || {}), url } })
  }
}

function onInput(e) {
  if (!e.target.classList.contains('notes')) return
  const ta = e.target
  const saved = card('notes').querySelector('.notes-saved')
  saved.textContent = ''
  clearTimeout(notesTimer)
  notesTimer = setTimeout(async () => {
    await setNt({ notes: ta.value.slice(0, 20000) })
    notesTimer = null
    saved.textContent = 'Saved'
    setTimeout(() => (saved.textContent = ''), 1500)
  }, 500)
}

function onKeydown(e) {
  // keep page shortcuts (like Escape closing the drawer) from firing while typing
  if (e.target.matches('textarea, input')) e.stopPropagation()
}
