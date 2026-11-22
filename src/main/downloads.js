// Download tracking. Files go straight to the system Downloads folder.
const { app, shell } = require('electron')
const path = require('path')
const fs = require('fs')

let nextId = 1

class Downloads {
  constructor(ctx) {
    this.ctx = ctx
    this.items = [] // { id, item, name, path, url, state, received, total, started }
  }

  attach(session) {
    session.on('will-download', (_e, item) => {
      const dir = app.getPath('downloads')
      const file = uniquePath(path.join(dir, item.getFilename()))
      item.setSavePath(file)
      const d = { id: nextId++, item, name: path.basename(file), path: file, url: item.getURL(), state: 'progressing', received: 0, total: item.getTotalBytes(), started: Date.now() }
      this.items.unshift(d)
      if (this.items.length > 100) this.items.pop()
      item.on('updated', (_ev, state) => {
        d.state = item.isPaused() ? 'paused' : state
        d.received = item.getReceivedBytes()
        d.total = item.getTotalBytes()
        this.emit()
      })
      item.once('done', (_ev, state) => {
        d.state = state
        d.received = item.getReceivedBytes()
        this.emit()
        if (state === 'completed') this.ctx.browser?.emit('toast', { text: `Downloaded ${d.name}`, action: { label: 'Open', call: ['downloads.open', d.id] } })
      })
      this.emit()
      this.ctx.browser?.emit('toast', { text: `Downloading ${d.name}…` })
    })
  }

  list() {
    return this.items.map(({ item, ...d }) => d)
  }

  emit() {
    clearTimeout(this.t)
    this.t = setTimeout(() => this.ctx.browser?.emit('downloads', this.list()), 100)
  }

  find(id) {
    return this.items.find((d) => d.id === id)
  }

  open(id) {
    const d = this.find(id)
    if (d) shell.openPath(d.path)
  }

  show(id) {
    const d = this.find(id)
    if (d) shell.showItemInFolder(d.path)
  }

  cancel(id) {
    this.find(id)?.item.cancel()
  }

  pause(id) {
    const d = this.find(id)
    if (!d) return
    d.item.isPaused() ? d.item.resume() : d.item.pause()
    d.state = d.item.isPaused() ? 'paused' : 'progressing'
    this.emit()
  }

  clear() {
    this.items = this.items.filter((d) => d.state === 'progressing' || d.state === 'paused')
    this.emit()
  }
}

function uniquePath(p) {
  if (!fs.existsSync(p)) return p
  const { dir, name, ext } = path.parse(p)
  for (let i = 1; ; i++) {
    const c = path.join(dir, `${name} (${i})${ext}`)
    if (!fs.existsSync(c)) return c
  }
}

module.exports = { Downloads }
