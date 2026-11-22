// Data for the new tab page widgets: weather (Open-Meteo, no account or key
// needed) and news headlines (RSS/Atom feeds). Fetched here in the main
// process and cached for a while, so opening lots of new tabs doesn't hit
// the services every time.
const { net } = require('electron')

const TTL = 15 * 60000
const cache = new Map() // key -> { at, value }

async function cached(key, fn) {
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < TTL) return hit.value
  const value = await fn()
  cache.set(key, { at: Date.now(), value })
  if (cache.size > 50) cache.delete(cache.keys().next().value)
  return value
}

async function getJSON(url) {
  const res = await net.fetch(url, { signal: AbortSignal.timeout(8000) })
  if (!res.ok) throw new Error('HTTP ' + res.status)
  return res.json()
}

// ---------- weather ----------
// Find a place by name: [{ name, region, country, lat, lon }]
async function findPlace(query) {
  query = String(query || '').trim().slice(0, 100)
  if (!query) return []
  const url = `https://geocoding-api.open-meteo.com/v1/search?count=5&language=en&format=json&name=${encodeURIComponent(query)}`
  const json = await cached('geo:' + query.toLowerCase(), () => getJSON(url))
  return (json.results || []).map((r) => ({ name: r.name, region: r.admin1 || '', country: r.country || '', lat: r.latitude, lon: r.longitude }))
}

async function weather({ lat, lon, units = 'c' } = {}) {
  lat = Number(lat)
  lon = Number(lon)
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new Error('No location set')
  const f = units === 'f'
  const q = new URLSearchParams({
    latitude: lat.toFixed(3),
    longitude: lon.toFixed(3),
    current: 'temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,is_day',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
    timezone: 'auto',
    forecast_days: '5',
    temperature_unit: f ? 'fahrenheit' : 'celsius',
    wind_speed_unit: f ? 'mph' : 'kmh',
  })
  const json = await cached('wx:' + q, () => getJSON('https://api.open-meteo.com/v1/forecast?' + q))
  const c = json.current || {}
  const d = json.daily || {}
  return {
    units: f ? 'f' : 'c',
    wind: f ? 'mph' : 'km/h',
    now: { temp: c.temperature_2m, feels: c.apparent_temperature, humidity: c.relative_humidity_2m, wind: c.wind_speed_10m, code: c.weather_code, day: c.is_day !== 0 },
    days: (d.time || []).map((t, i) => ({ date: t, code: d.weather_code[i], max: d.temperature_2m_max[i], min: d.temperature_2m_min[i], rain: d.precipitation_probability_max?.[i] })),
  }
}

// ---------- news feed ----------
// Each topic mixes a few sources; stories are interleaved so no single site
// takes over the feed.
const TOPICS = {
  top: { name: 'Top stories', feeds: ['https://feeds.bbci.co.uk/news/rss.xml', 'https://feeds.npr.org/1001/rss.xml', 'https://www.theguardian.com/international/rss'] },
  world: { name: 'World', feeds: ['https://feeds.bbci.co.uk/news/world/rss.xml', 'https://www.theguardian.com/world/rss', 'https://feeds.npr.org/1004/rss.xml'] },
  business: { name: 'Business', feeds: ['https://feeds.bbci.co.uk/news/business/rss.xml', 'https://www.theguardian.com/uk/business/rss', 'https://feeds.npr.org/1006/rss.xml'] },
  tech: { name: 'Technology', feeds: ['https://www.theverge.com/rss/index.xml', 'https://feeds.arstechnica.com/arstechnica/index', 'https://feeds.bbci.co.uk/news/technology/rss.xml', 'https://www.theguardian.com/technology/rss'] },
  science: { name: 'Science', feeds: ['https://feeds.bbci.co.uk/news/science_and_environment/rss.xml', 'https://feeds.arstechnica.com/arstechnica/science', 'https://www.theguardian.com/science/rss'] },
  sports: { name: 'Sports', feeds: ['https://www.espn.com/espn/rss/news', 'https://feeds.bbci.co.uk/sport/rss.xml', 'https://www.theguardian.com/uk/sport/rss'] },
  entertainment: { name: 'Entertainment', feeds: ['https://feeds.bbci.co.uk/news/entertainment_and_arts/rss.xml', 'https://www.theguardian.com/culture/rss'] },
  hn: { name: 'Hacker News', feeds: ['https://hnrss.org/frontpage'] },
}
const SOURCE_NAMES = {
  'bbc.co.uk': 'BBC',
  'bbc.com': 'BBC',
  'npr.org': 'NPR',
  'theguardian.com': 'The Guardian',
  'theverge.com': 'The Verge',
  'arstechnica.com': 'Ars Technica',
  'espn.com': 'ESPN',
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }
function entities(s) {
  return String(s || '').replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
      return Number.isFinite(n) ? String.fromCodePoint(n) : m
    }
    return ENTITIES[e.toLowerCase()] ?? m
  })
}
const uncdata = (s) => String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
// raw (possibly escaped) HTML of a field
const html = (s) => {
  const raw = uncdata(s)
  return /&lt;\w/.test(raw) ? entities(raw) : raw
}
const text = (s) => entities(html(s).replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()
const tag = (xml, name) => xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i'))?.[1]
const attr = (el, name) => entities(el.match(new RegExp(`\\s${name}\\s*=\\s*["']([^"']*)`, 'i'))?.[1] || '')

// Ask image CDNs for a bigger picture than the tiny feed thumbnail
function bigger(url) {
  if (!url) return ''
  return url
    .replace(/(ichef\.bbci\.co\.uk\/(?:ace|news)\/(?:standard|ws))\/\d+\//, '$1/800/')
    .replace(/(platform\.theverge\.com\/.*[?&]w=)\d+/, '$1900')
    .replace(/(cdn\.arstechnica\.net\/.*)-\d+x\d+(\.\w+)$/, '$1$2')
}

function imageOf(item) {
  // media:content / media:thumbnail / enclosure: take the widest
  let best = ''
  let bestW = -1
  for (const m of item.match(/<(?:media:content|media:thumbnail|enclosure)\b[^>]*>/gi) || []) {
    const url = attr(m, 'url')
    const type = attr(m, 'type')
    const medium = attr(m, 'medium')
    if (!url || (type && !type.startsWith('image/')) || (medium && medium !== 'image')) continue
    if (!type && !medium && !/\.(jpe?g|png|webp|gif)|ichef|guim|image/i.test(url)) continue
    const w = +attr(m, 'width') || 0
    if (w > bestW) {
      best = url
      bestW = w
    }
  }
  if (best) return bigger(best)
  // otherwise the first real picture inside the story's HTML
  const body = html(tag(item, 'content:encoded') || tag(item, 'content') || tag(item, 'description') || tag(item, 'summary'))
  for (const img of body.match(/<img\b[^>]*>/gi) || []) {
    const src = attr(img, 'src')
    const w = +attr(img, 'width')
    if (!/^https?:\/\//.test(src) || /pixel|tracking|feedburner|\/ads?\//i.test(src) || (w && w < 60)) continue
    return bigger(src)
  }
  return ''
}

function sourceOf(link, fallback) {
  try {
    const host = new URL(link).hostname.replace(/^www\./, '')
    for (const [d, name] of Object.entries(SOURCE_NAMES)) if (host === d || host.endsWith('.' + d)) return name
    return host
  } catch {
    return fallback || ''
  }
}

// RSS 2.0 / Atom: [{ title, link, date, image, summary, source }]
function parseFeed(xml, feedName = '') {
  const items = []
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) || []
  for (const b of blocks) {
    const title = text(tag(b, 'title'))
    let link = text(tag(b, 'link'))
    if (!/^https?:/.test(link)) link = attr(b.match(/<link[^>]*rel=["']alternate["'][^>]*>/i)?.[0] || b.match(/<link\b[^>]*href=[^>]*>/i)?.[0] || '', 'href')
    const date = Date.parse(text(tag(b, 'pubDate') || tag(b, 'published') || tag(b, 'updated') || tag(b, 'dc:date'))) || 0
    let summary = text(tag(b, 'description') || tag(b, 'summary'))
    if (summary.length > 240) summary = summary.slice(0, 237).replace(/\s+\S*$/, '') + '…'
    if (title && /^https?:\/\//.test(link)) items.push({ title, link, date, image: imageOf(b), summary: summary === title ? '' : summary, source: sourceOf(link, feedName) })
  }
  return items
}

async function getFeed(url) {
  return cached('feed:' + url, async () => {
    const res = await net.fetch(url, { signal: AbortSignal.timeout(8000), headers: { Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml' } })
    if (!res.ok) throw new Error('HTTP ' + res.status)
    const xml = (await res.text()).slice(0, 3_000_000)
    const name = text(tag(xml.replace(/<(item|entry)[\s>][\s\S]*/i, ''), 'title'))
    return parseFeed(xml, name)
  })
}

// Merged stories for a topic (or your own feed address)
async function feed({ topic = 'top', url = '' } = {}) {
  const t = TOPICS[topic]
  const urls = t ? t.feeds : /^https?:\/\//i.test(String(url).trim()) ? [String(url).trim()] : []
  if (!urls.length) throw new Error('No feed set')
  const lists = (await Promise.allSettled(urls.map(getFeed))).filter((r) => r.status === 'fulfilled').map((r) => [...r.value].sort((a, z) => z.date - a.date))
  if (!lists.length) throw new Error('Feeds unavailable')
  // interleave the sources, newest first within each
  const seen = new Set()
  const out = []
  for (let i = 0; lists.some((l) => i < l.length); i++) {
    for (const l of lists) {
      const it = l[i]
      if (!it) continue
      const k = it.link.replace(/[?#].*/, '')
      if (seen.has(k) || seen.has(it.title)) continue
      seen.add(k)
      seen.add(it.title)
      out.push(it)
    }
  }
  return out.slice(0, 120)
}

// Stories without a picture in the feed: use the article's preview image
// (the one sites show when you share a link).
const ogCache = new Map()
async function ogImage(link) {
  if (ogCache.has(link)) return ogCache.get(link)
  let img = ''
  try {
    if (!/^https?:\/\//i.test(link)) throw 0
    const res = await net.fetch(link, { signal: AbortSignal.timeout(6000), headers: { Accept: 'text/html' } })
    if (res.ok && /html/i.test(res.headers.get('content-type') || '')) {
      // only the <head> matters; stop reading after ~400 KB
      const reader = res.body.getReader()
      let head = ''
      const dec = new TextDecoder()
      while (head.length < 400_000) {
        const { done, value } = await reader.read()
        if (done) break
        head += dec.decode(value, { stream: true })
        if (/<\/head>/i.test(head)) break
      }
      reader.cancel().catch(() => {})
      const meta = (head.match(/<meta\b[^>]*>/gi) || []).find((m) => /(property|name)\s*=\s*["'](og:image(:secure_url)?|twitter:image(:src)?)["']/i.test(m))
      const found = meta ? attr(meta, 'content') : ''
      if (found) img = bigger(new URL(found, link).href)
      // skip sites' generic "share" pictures and logos
      if (!/^https?:\/\//.test(img) || /default|placeholder|logo|favicon|sprite/i.test(img.split('?')[0])) img = ''
    }
  } catch {}
  ogCache.set(link, img)
  if (ogCache.size > 600) ogCache.delete(ogCache.keys().next().value)
  return img
}
async function ogImages(links = []) {
  links = links.filter((l) => typeof l === 'string').slice(0, 40)
  const out = {}
  let i = 0
  const worker = async () => {
    while (i < links.length) {
      const l = links[i++]
      out[l] = await ogImage(l)
    }
  }
  await Promise.all([worker(), worker(), worker(), worker()])
  return out
}

const topics = () => Object.entries(TOPICS).map(([id, t]) => ({ id, name: t.name }))

module.exports = { weather, findPlace, feed, topics, ogImages, parseFeed }
