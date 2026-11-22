// Tiny JSON-file store with debounced, atomic writes.
const fs = require('fs')
const path = require('path')

class JsonStore {
  constructor(file, defaults) {
    this.file = file
    this.defaults = defaults
    this.timer = null
    fs.mkdirSync(path.dirname(file), { recursive: true })
    let saved = {}
    try {
      saved = JSON.parse(fs.readFileSync(file, 'utf8'))
    } catch {}
    this.savedVersion = saved.settingsVersion || 0 // version of the file on disk
    this.data = merge(structuredClone(defaults), saved)
  }

  get(key) {
    return key ? this.data[key] : this.data
  }

  set(key, value) {
    this.data[key] = value
    this.save()
  }

  patch(obj) {
    Object.assign(this.data, obj)
    this.save()
  }

  save() {
    clearTimeout(this.timer)
    this.timer = setTimeout(() => this.flush(), 300)
  }

  flush() {
    clearTimeout(this.timer)
    const tmp = this.file + '.tmp'
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2))
    fs.renameSync(tmp, this.file)
  }
}

// Deep-merge saved values over defaults so new settings appear after upgrades.
function merge(base, over) {
  if (!over || typeof over !== 'object' || Array.isArray(over)) return over ?? base
  for (const [k, v] of Object.entries(over)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])) {
      base[k] = merge(base[k], v)
    } else {
      base[k] = v
    }
  }
  return base
}

module.exports = { JsonStore }
