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

// ---------- news ----------
const FEEDS = {
  bbc: { name: 'BBC News', url: 'https://feeds.bbci.co.uk/news/rss.xml' },
  bbcworld: { name: 'BBC World', url: 'https://feeds.bbci.co.uk/news/world/rss.xml' },
  npr: { name: 'NPR', url: 'https://feeds.npr.org/1001/rss.xml' },
  guardian: { name: 'The Guardian', url: 'https://www.theguardian.com/international/rss' },
  hn: { name: 'Hacker News', url: 'https://hnrss.org/frontpage' },
  verge: { name: 'The Verge', url: 'https://www.theverge.com/rss/index.xml' },
  ars: { name: 'Ars Technica', url: 'https://feeds.arstechnica.com/arstechnica/index' },
  espn: { name: 'ESPN', url: 'https://www.espn.com/espn/rss/news' },
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }
function decode(s) {
  return String(s || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e) => {
      if (e[0] === '#') {
        const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
        return Number.isFinite(n) ? String.fromCodePoint(n) : m
      }
      return ENTITIES[e.toLowerCase()] ?? m
    })
    .replace(/\s+/g, ' ')
    .trim()
}
const tag = (xml, name) => xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i'))?.[1]

// Small RSS 2.0 / Atom parser: [{ title, link, date }]
function parseFeed(xml) {
  const items = []
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) || []
  for (const b of blocks) {
    const title = decode(tag(b, 'title'))
    let link = decode(tag(b, 'link'))
    if (!link) link = b.match(/<link[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)/i)?.[1] || b.match(/<link[^>]*href=["']([^"']+)/i)?.[1] || ''
    link = link.replace(/&amp;/g, '&')
    const date = Date.parse(decode(tag(b, 'pubDate') || tag(b, 'updated') || tag(b, 'published') || tag(b, 'dc:date'))) || 0
    if (title && /^https?:\/\//.test(link)) items.push({ title, link, date })
  }
  return items
}

async function news({ feed = 'bbc', url = '', count = 6 } = {}) {
  const preset = FEEDS[feed]
  const src = preset ? preset.url : String(url || '').trim()
  if (!/^https?:\/\//i.test(src)) throw new Error('No feed set')
  const items = await cached('news:' + src, async () => {
    const res = await net.fetch(src, { signal: AbortSignal.timeout(8000), headers: { Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml' } })
    if (!res.ok) throw new Error('HTTP ' + res.status)
    const text = (await res.text()).slice(0, 2_000_000)
    return parseFeed(text)
  })
  let name = preset?.name
  if (!name) {
    try {
      name = new URL(src).hostname.replace(/^(www|feeds?|rss)\./, '')
    } catch {}
  }
  return { name, items: items.slice(0, Math.max(1, Math.min(20, count))) }
}

const feeds = () => Object.entries(FEEDS).map(([id, f]) => ({ id, name: f.name }))

module.exports = { weather, findPlace, news, feeds, parseFeed }
