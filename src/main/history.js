// Browsing history kept in the profile's data file.
const { isInternal } = require('./urls')

const MAX = 20000

class History {
  constructor(data) {
    this.data = data
  }

  list() {
    return this.data.get('history')
  }

  add(url, title) {
    if (!url || isInternal(url) || url.startsWith('about:') || url.startsWith('data:')) return
    const h = this.list()
    const last = h[h.length - 1]
    if (last && last.url === url) {
      last.time = Date.now()
    } else {
      h.push({ url, title: title || '', time: Date.now() })
      if (h.length > MAX) h.splice(0, h.length - MAX)
    }
    this.data.save()
  }

  updateTitle(url, title) {
    const h = this.list()
    for (let i = h.length - 1; i >= Math.max(0, h.length - 20); i--) {
      if (h[i].url === url) {
        h[i].title = title
        this.data.save()
        return
      }
    }
  }

  search(query = '', limit = 200) {
    const q = query.toLowerCase()
    const out = []
    const h = this.list()
    for (let i = h.length - 1; i >= 0 && out.length < limit; i--) {
      const e = h[i]
      if (!q || e.url.toLowerCase().includes(q) || (e.title || '').toLowerCase().includes(q)) out.push(e)
    }
    return out
  }

  // Frecency-ish ranking for address bar suggestions.
  suggest(query, limit = 6) {
    const q = query.toLowerCase()
    const scores = new Map()
    const h = this.list()
    const now = Date.now()
    for (let i = h.length - 1; i >= Math.max(0, h.length - 5000); i--) {
      const e = h[i]
      const url = e.url.toLowerCase()
      const bare = url.replace(/^https?:\/\/(www\.)?/, '')
      const title = (e.title || '').toLowerCase()
      let s = 0
      if (bare.startsWith(q)) s = 10
      else if (url.includes(q)) s = 4
      else if (title.includes(q)) s = 3
      if (!s) continue
      const age = (now - e.time) / 86400000
      s += Math.max(0, 3 - age / 7)
      const prev = scores.get(e.url)
      if (prev) prev.score += s * 0.3
      else scores.set(e.url, { url: e.url, title: e.title, score: s })
    }
    return [...scores.values()].sort((a, b) => b.score - a.score).slice(0, limit)
  }

  remove(url) {
    this.data.set(
      'history',
      this.list().filter((e) => e.url !== url)
    )
  }

  clear() {
    this.data.set('history', [])
  }
}

module.exports = { History }
