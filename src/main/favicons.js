// Site icon cache, served as kite://favicon/?u=<page url>.
// Icons come from (1) pages you visit, (2) the icon databases of browsers you
// import from, or (3) fetching the site and reading its <link rel="icon">.
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const RETRY_MISS_MS = 24 * 3600 * 1000

class Favicons {
  constructor(ctx) {
    this.ctx = ctx
    this.dir = path.join(ctx.profileDir, 'favicons')
    fs.mkdirSync(this.dir, { recursive: true })
    this.indexFile = path.join(this.dir, 'index.json')
    try {
      this.index = JSON.parse(fs.readFileSync(this.indexFile, 'utf8'))
    } catch {
      this.index = {} // host -> { file, mime, src, t } | { miss: t }
    }
    this.inflight = new Map()
  }

  key(pageUrl) {
    try {
      const u = new URL(pageUrl)
      return /^https?:$/.test(u.protocol) ? u.host : null
    } catch {
      return null
    }
  }

  saveIndex() {
    clearTimeout(this.t)
    this.t = setTimeout(() => fs.writeFile(this.indexFile, JSON.stringify(this.index), () => {}), 500)
  }

  has(host) {
    const e = this.index[host]
    return !!(e && e.file && fs.existsSync(path.join(this.dir, e.file)))
  }

  // Store raw icon bytes for a host (only if they really are an image).
  store(host, buf, src, { overwrite = true } = {}) {
    if (!host || !buf?.length) return false
    if (!overwrite && this.has(host)) return true
    const mime = sniff(buf)
    if (!mime) return false
    const hash = crypto.createHash('sha1').update(buf).digest('hex')
    if (this.index[host]?.hash === hash && this.has(host)) return true // same icon: nothing to do
    const ext = { 'image/png': 'png', 'image/x-icon': 'ico', 'image/gif': 'gif', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/svg+xml': 'svg' }[mime]
    const file = crypto.createHash('sha1').update(host).digest('hex').slice(0, 16) + '.' + ext
    fs.writeFileSync(path.join(this.dir, file), buf)
    this.index[host] = { file, mime, hash, src: src || '', t: Date.now() }
    this.saveIndex()
    this.changed(host)
    return true
  }

  // Tell the UI to reload icons (debounced) — it appends the version to URLs.
  changed(host) {
    ;(this.pending ||= new Set()).add(host)
    clearTimeout(this.ct)
    this.ct = setTimeout(() => {
      const hosts = [...this.pending]
      this.pending = null
      this.ctx.browser?.emit('favicons', hosts)
    }, 300)
  }

  // Called when a tab reports its favicon: download it in the background.
  learn(pageUrl, iconUrl) {
    const host = this.key(pageUrl)
    if (!host || !iconUrl || this.index[host]?.src === iconUrl) return
    // sites like YouTube swap their icon constantly (notification badges);
    // only replace a saved icon once a day so the UI doesn't keep reloading it
    const e = this.index[host]
    if (this.has(host) && Date.now() - (e.t || 0) < 24 * 3600 * 1000) return
    this.download(iconUrl)
      .then((buf) => buf && this.store(host, buf, iconUrl))
      .catch(() => {})
  }

  async download(iconUrl, ses = this.ctx.tabSession) {
    if (iconUrl.startsWith('data:')) {
      const m = iconUrl.match(/^data:[^;,]*(;base64)?,(.*)$/s)
      if (!m) return null
      return m[1] ? Buffer.from(m[2], 'base64') : Buffer.from(decodeURIComponent(m[2]))
    }
    const res = await ses.fetch(iconUrl, { signal: AbortSignal.timeout(6000) })
    if (!res.ok) return null
    const buf = Buffer.from(await res.arrayBuffer())
    return buf.length > 0 && buf.length < 2_000_000 ? buf : null
  }

  // Fetch the page and pick the best icon it declares; fall back to /favicon.ico.
  async resolve(pageUrl) {
    const host = this.key(pageUrl)
    if (!host) return false
    if (this.inflight.has(host)) return this.inflight.get(host)
    const job = (async () => {
      const ses = this.ctx.tabSession
      const candidates = []
      try {
        const res = await ses.fetch(new URL(pageUrl).origin + '/', { signal: AbortSignal.timeout(6000) })
        const base = res.url || pageUrl
        const html = (await res.text()).slice(0, 300000)
        for (const tag of html.match(/<link\b[^>]*>/gi) || []) {
          const rel = (tag.match(/\brel\s*=\s*["']?([^"'>]+)/i) || [])[1]?.toLowerCase() || ''
          if (!/\bicon\b/.test(rel)) continue
          const href = (tag.match(/\bhref\s*=\s*["']([^"']+)["']/i) || tag.match(/\bhref\s*=\s*([^\s>]+)/i) || [])[1]
          if (!href) continue
          const sizes = (tag.match(/\bsizes\s*=\s*["']?(\d+)/i) || [])[1]
          const type = (tag.match(/\btype\s*=\s*["']([^"']+)/i) || [])[1] || ''
          let score = sizes ? Number(sizes) : 16
          if (/svg/.test(type) || /\.svg(\?|$)/i.test(href)) score = 120
          if (/apple-touch|mask-icon/.test(rel)) score = Math.min(score || 180, 100) - 1
          if (score > 256) score = 256 - score / 1000 // very large icons are slow
          try {
            candidates.push({ url: new URL(href.replace(/&amp;/g, '&'), base).href, score })
          } catch {}
        }
      } catch {}
      candidates.sort((a, b) => b.score - a.score)
      candidates.push({ url: new URL(pageUrl).origin + '/favicon.ico', score: 0 })
      for (const c of candidates) {
        try {
          const buf = await this.download(c.url, ses)
          if (buf && this.store(host, buf, c.url)) return true
        } catch {}
      }
      this.index[host] = { miss: Date.now() }
      this.saveIndex()
      return false
    })().finally(() => this.inflight.delete(host))
    this.inflight.set(host, job)
    return job
  }

  // Protocol handler: kite://favicon/?u=<page url>
  async serve(pageUrl) {
    const host = this.key(pageUrl)
    if (!host) return notFound()
    let e = this.index[host]
    if (!this.has(host) && !(e?.miss && Date.now() - e.miss < RETRY_MISS_MS)) {
      await this.resolve(pageUrl)
      e = this.index[host]
    }
    if (!this.has(host)) return notFound()
    return new Response(fs.readFileSync(path.join(this.dir, e.file)), { headers: { 'content-type': e.mime, 'cache-control': 'max-age=3600' } })
  }
}

function notFound() {
  return new Response('', { status: 404 })
}

// Identify image bytes by their magic numbers (never trust the server).
function sniff(b) {
  if (b.length < 4) return null
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png'
  if (b[0] === 0x00 && b[1] === 0x00 && (b[2] === 0x01 || b[2] === 0x02) && b[3] === 0x00) return 'image/x-icon'
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'image/gif'
  if (b[0] === 0xff && b[1] === 0xd8) return 'image/jpeg'
  if (b.length > 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return 'image/webp'
  const head = b.toString('utf8', 0, Math.min(b.length, 600)).trimStart().toLowerCase()
  if ((head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg'))) && !head.includes('<html')) return 'image/svg+xml'
  return null
}

module.exports = { Favicons, sniff }
