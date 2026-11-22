// Keep "session" cookies (cookies without an expiry date) across restarts.
// Chromium drops them on every quit, which signs you out of sites like Apple
// and makes them ask for verification again. Chrome keeps them when
// "Continue where you left off" is on; Kite does the same while "Restore tabs
// on startup" is on (and "Clear everything when Kite closes" is off).
//
// They're written to the profile folder, encrypted with the system keyring
// when it's available (Electron safeStorage).
const { safeStorage } = require('electron')
const fs = require('fs')
const path = require('path')

class SessionCookies {
  constructor(ctx) {
    this.ctx = ctx
    this.file = path.join(ctx.profileDir, 'session-cookies.bin')
  }

  get enabled() {
    const s = this.ctx.settings.data
    return s.restoreSession !== false && !s.clearOnExit
  }

  sessions() {
    return { tabs: this.ctx.tabSession, panels: this.ctx.panelSession }
  }

  async save() {
    try {
      if (!this.enabled) return fs.rmSync(this.file, { force: true })
      const data = {}
      for (const [name, ses] of Object.entries(this.sessions())) {
        data[name] = (await ses.cookies.get({})).filter((c) => c.session)
      }
      const json = JSON.stringify(data)
      const secure = safeStorage.isEncryptionAvailable()
      const body = secure ? Buffer.concat([Buffer.from('KSC1'), safeStorage.encryptString(json)]) : Buffer.from('KSC0' + json)
      const tmp = this.file + '.tmp'
      fs.writeFileSync(tmp, body, { mode: 0o600 })
      fs.renameSync(tmp, this.file)
    } catch (e) {
      console.error('[cookies] could not save session cookies:', e.message)
    }
  }

  async restore() {
    if (!this.enabled || !fs.existsSync(this.file)) return 0
    let data
    try {
      const buf = fs.readFileSync(this.file)
      const tag = buf.subarray(0, 4).toString()
      const rest = buf.subarray(4)
      data = JSON.parse(tag === 'KSC1' ? safeStorage.decryptString(rest) : rest.toString())
    } catch (e) {
      console.error('[cookies] could not read saved session cookies:', e.message)
      return 0
    }
    let n = 0
    for (const [name, ses] of Object.entries(this.sessions())) {
      for (const c of data[name] || []) {
        const host = c.domain.replace(/^\./, '')
        const details = {
          url: `${c.secure ? 'https' : 'http'}://${host}${c.path || '/'}`,
          name: c.name,
          value: c.value,
          path: c.path,
          secure: c.secure,
          httpOnly: c.httpOnly,
          sameSite: c.sameSite,
        }
        if (!c.hostOnly) details.domain = c.domain
        try {
          await ses.cookies.set(details) // no expiry: stays a session cookie
          n++
        } catch {}
      }
    }
    return n
  }

  // also save every minute, so a crash or logout doesn't lose them
  startAutosave() {
    clearInterval(this.timer)
    this.timer = setInterval(() => this.save(), 60000)
  }
}

module.exports = { SessionCookies }
