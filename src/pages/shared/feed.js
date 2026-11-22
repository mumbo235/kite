// News feed under the new tab page: scroll down for stories with pictures.
// Stories come from the main process (cached there), load in pages of 18 as
// you scroll, and stories whose feed has no picture get the article's
// preview image.
import { api, $, esc } from 'kite://shared/page.js'
import { icon } from 'kite://ui/js/icons.js'

const TOPICS = [
  ['top', 'Top stories'],
  ['world', 'World'],
  ['business', 'Business'],
  ['tech', 'Technology'],
  ['science', 'Science'],
  ['sports', 'Sports'],
  ['entertainment', 'Entertainment'],
  ['hn', 'Hacker News'],
]
const PAGE = 18

let getS = () => ({})
let saveNt = () => {}
let items = []
let shown = 0
let loadedKey = ''
let loading = null
let sentinel = null

const cfg = () => {
  const n = getS().newtab || {}
  const news = n.news || {}
  let topic = news.topic || 'top'
  if (topic === 'custom' && !news.url) topic = 'top'
  return { on: n.showNews !== false, topic, url: news.url || '' }
}

export function setupFeed(getSettings, saveNewtab) {
  getS = getSettings
  saveNt = saveNewtab
  // News on: the hint scrolls down to it. News off: the hint turns it on.
  $('#feed-hint').onclick = async () => {
    if (!cfg().on) {
      await setOn(true)
      requestAnimationFrame(() => $('#feed').scrollIntoView({ behavior: 'smooth', block: 'start' }))
    } else $('#feed').scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  $('#feed-off').innerHTML = `${icon('x')}<span>News off</span>`
  $('#feed-off').onclick = () => {
    window.scrollTo({ top: 0, behavior: 'smooth' })
    setTimeout(() => setOn(false), 250)
  }
  $('#feed-topics').onclick = (e) => {
    const b = e.target.closest('[data-topic]')
    if (!b) return
    const n = getS().newtab || {}
    saveNt({ news: { ...(n.news || {}), topic: b.dataset.topic } })
    window.scrollTo({ top: $('#feed').offsetTop, behavior: 'smooth' })
  }
  $('#feed-refresh').innerHTML = icon('reload')
  $('#feed-refresh').onclick = () => load(true)
  $('#feed-grid').addEventListener(
    'error',
    (e) => {
      // picture failed: show the story as text
      const img = e.target
      if (img.tagName !== 'IMG') return
      const card = img.closest('.story')
      img.closest('.pic')?.remove()
      card?.classList.add('noimg')
    },
    true
  )
  // the page dims and blurs its background once you're reading the feed
  const io = new IntersectionObserver(([e]) => document.body.classList.toggle('in-feed', e.isIntersecting && e.boundingClientRect.top < innerHeight * 0.5), { threshold: [0, 0.01, 0.2, 0.5, 1], rootMargin: '0px 0px -40% 0px' })
  io.observe($('#feed'))
  addEventListener('scroll', () => document.body.classList.toggle('scrolled', scrollY > 40), { passive: true })
  // more stories when you reach the bottom
  sentinel = new IntersectionObserver(([e]) => e.isIntersecting && more(), { rootMargin: '600px' })
  sentinel.observe($('#feed-more'))
}

function setOn(on) {
  return saveNt({ showNews: on })
}

export function renderFeed() {
  const c = cfg()
  $('#feed').hidden = !c.on
  const hint = $('#feed-hint')
  hint.classList.toggle('off', !c.on)
  hint.title = c.on ? 'Scroll down for the news' : 'Turn the news feed on'
  hint.innerHTML = c.on ? `<span>News</span>${icon('chevronDown')}` : `<span>Show news</span>`
  hint.hidden = false
  document.body.classList.toggle('has-feed', c.on)
  if (!c.on) return
  const topics = [...TOPICS]
  if (c.url) topics.push(['custom', 'Your feed'])
  $('#feed-topics').innerHTML = topics.map(([id, name]) => `<button data-topic="${id}" class="${c.topic === id ? 'on' : ''}">${esc(name)}</button>`).join('')
  const key = c.topic + '|' + c.url
  if (key !== loadedKey) load()
}

async function load(force = false) {
  const c = cfg()
  const key = c.topic + '|' + c.url
  loadedKey = key
  const grid = $('#feed-grid')
  if (force || !items.length || grid.dataset.key !== key) {
    grid.dataset.key = key
    grid.innerHTML = skeleton()
    $('#feed-more').innerHTML = ''
  }
  const p = (loading = api.call('widgets.feed', { topic: c.topic, url: c.url }))
  try {
    const list = await p
    if (loading !== p) return
    items = list
    shown = 0
    grid.innerHTML = ''
    more()
  } catch {
    if (loading !== p) return
    items = []
    grid.innerHTML = `<div class="feed-empty">Couldn’t load the news. <button class="w-link" id="feed-retry">Try again</button></div>`
    $('#feed-retry').onclick = () => load(true)
  }
}

function skeleton() {
  return [...Array(6)].map((_, i) => `<div class="story ghost ${i === 0 ? 'big' : ''}"><div class="pic"></div><div class="txt"><i></i><i></i><i></i></div></div>`).join('')
}

function ago(t) {
  if (!t) return ''
  const m = Math.round((Date.now() - t) / 60000)
  if (m < 1) return 'Just now'
  if (m < 60) return m + 'm ago'
  if (m < 24 * 60) return Math.round(m / 60) + 'h ago'
  const d = Math.round(m / 1440)
  return d === 1 ? 'Yesterday' : d + 'd ago'
}

function card(it, i) {
  // a big story to start each screenful, the rest regular cards
  const big = i % PAGE === 0 && it.image
  let fav = ''
  try {
    fav = 'kite://favicon/?u=' + encodeURIComponent(new URL(it.link).origin)
  } catch {}
  return `<a class="story ${big ? 'big' : ''} ${it.image ? '' : 'noimg'}" href="${esc(it.link)}" data-link="${esc(it.link)}" style="animation-delay:${(i % PAGE) * 25}ms">
    ${it.image ? `<div class="pic"><img src="${esc(it.image)}" alt="" loading="lazy" referrerpolicy="no-referrer"></div>` : ''}
    <div class="txt">
      <div class="src"><img class="fav" src="${esc(fav)}" alt="" onerror="this.remove()"><span>${esc(it.source)}</span>${it.date ? `<span class="dot">·</span><time>${ago(it.date)}</time>` : ''}</div>
      <h3>${esc(it.title)}</h3>
      ${it.summary ? `<p>${esc(it.summary)}</p>` : ''}
    </div>
  </a>`
}

function more() {
  if (!items.length || shown >= items.length) {
    if (items.length) $('#feed-more').innerHTML = `<span>You’re all caught up</span><button class="w-link" id="feed-again">Refresh</button>`
    if ($('#feed-again')) $('#feed-again').onclick = () => load(true)
    return
  }
  const batch = items.slice(shown, shown + PAGE)
  $('#feed-grid').insertAdjacentHTML('beforeend', batch.map((it, j) => card(it, shown + j)).join(''))
  shown += batch.length
  $('#feed-more').innerHTML = shown < items.length ? '<span class="w-loading">Loading more…</span>' : ''
  fillPictures(batch.filter((it) => !it.image))
  if (shown >= items.length) more()
}

// stories without a picture: ask for the article's preview image
async function fillPictures(list) {
  if (!list.length) return
  const key = loadedKey
  let found = {}
  try {
    found = await api.call('widgets.ogImages', list.map((it) => it.link))
  } catch {
    return
  }
  if (key !== loadedKey) return
  for (const it of list) {
    const url = found[it.link]
    if (!url) continue
    it.image = url
    const el = $('#feed-grid').querySelector(`.story[data-link="${CSS.escape(it.link)}"]`)
    if (!el || el.querySelector('.pic')) continue
    el.classList.remove('noimg')
    el.insertAdjacentHTML('afterbegin', `<div class="pic"><img src="${esc(url)}" alt="" loading="lazy" referrerpolicy="no-referrer"></div>`)
  }
}
