// New tab backgrounds: a scenic photo that changes every day (Bing's
// "image of the day"), plus pictures the user adds. Files are cached in the
// profile folder and served as kite://bg/<folder>/<file>.
const { net, dialog } = require('electron')
const fs = require('fs')
const path = require('path')

const DAILY_API = 'https://www.bing.com/HPImageArchive.aspx?format=js&n=8&mkt=en-US&idx='

class Backgrounds {
  constructor(ctx) {
    this.ctx = ctx
    this.dir = path.join(ctx.profileDir, 'backgrounds')
    this.dailyDir = path.join(this.dir, 'daily')
    this.customDir = path.join(this.dir, 'custom')
    fs.mkdirSync(this.dailyDir, { recursive: true })
    fs.mkdirSync(this.customDir, { recursive: true })
    this.pending = null
  }

  // Resolve a kite://bg/... path to a file on disk (or null).
  file(urlPath) {
    const p = path.normalize(path.join(this.dir, decodeURIComponent(urlPath)))
    return p.startsWith(this.dir + path.sep) && fs.existsSync(p) ? p : null
  }

  metaFile() {
    return path.join(this.dailyDir, 'index.json')
  }

  readMeta() {
    try {
      return JSON.parse(fs.readFileSync(this.metaFile(), 'utf8'))
    } catch {
      return { fetched: '', images: [] }
    }
  }

  today() {
    const d = new Date()
    return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
  }

  // List of recent daily photos, newest first. Refreshes once per day.
  async daily() {
    let meta = this.readMeta()
    if (meta.fetched !== this.today() || !meta.images.length) {
      this.pending ||= this.refresh().finally(() => (this.pending = null))
      try {
        meta = await this.pending
      } catch (e) {
        console.error('[backgrounds] daily photo fetch failed:', e.message)
      }
    }
    return meta.images.filter((i) => fs.existsSync(path.join(this.dailyDir, i.file)))
  }

  async refresh() {
    const res = await net.fetch(DAILY_API + '0', { signal: AbortSignal.timeout(8000) })
    const json = await res.json()
    const old = this.readMeta().images
    const images = []
    for (const img of json.images || []) {
      const file = `${img.startdate}.jpg`
      const dest = path.join(this.dailyDir, file)
      if (!fs.existsSync(dest)) {
        const url = 'https://www.bing.com' + img.urlbase + '_1920x1080.jpg'
        const r = await net.fetch(url, { signal: AbortSignal.timeout(20000) })
        if (!r.ok) continue
        fs.writeFileSync(dest, Buffer.from(await r.arrayBuffer()))
      }
      images.push({
        file,
        url: 'kite://bg/daily/' + file,
        date: img.startdate,
        title: img.title || '',
        copyright: img.copyright || '',
        link: img.copyrightlink && img.copyrightlink.startsWith('http') ? img.copyrightlink : '',
      })
    }
    // keep up to 30 days of photos
    const keep = [...images, ...old.filter((o) => !images.find((i) => i.file === o.file))].slice(0, 30)
    for (const f of fs.readdirSync(this.dailyDir)) {
      if (f.endsWith('.jpg') && !keep.find((k) => k.file === f)) fs.rmSync(path.join(this.dailyDir, f), { force: true })
    }
    const meta = { fetched: this.today(), images: keep }
    fs.writeFileSync(this.metaFile(), JSON.stringify(meta, null, 2))
    return meta
  }

  custom() {
    return fs
      .readdirSync(this.customDir)
      .filter((f) => /\.(jpe?g|png|webp|gif|avif)$/i.test(f))
      .map((f) => ({ file: f, url: 'kite://bg/custom/' + encodeURIComponent(f), added: fs.statSync(path.join(this.customDir, f)).mtimeMs }))
      .sort((a, b) => b.added - a.added)
  }

  async addCustom() {
    const r = await dialog.showOpenDialog({
      title: 'Choose background pictures',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif'] }],
    })
    if (r.canceled) return []
    const added = []
    for (const src of r.filePaths) {
      const ext = path.extname(src).toLowerCase()
      const name = path.basename(src, ext).replace(/[^\w-]+/g, '-').slice(0, 40) + '-' + Date.now().toString(36) + ext
      fs.copyFileSync(src, path.join(this.customDir, name))
      added.push('kite://bg/custom/' + encodeURIComponent(name))
    }
    return added
  }

  removeCustom(file) {
    const p = this.file('custom/' + file)
    if (p) fs.rmSync(p, { force: true })
  }
}

module.exports = { Backgrounds }
