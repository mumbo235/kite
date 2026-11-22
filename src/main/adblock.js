// Ad & tracker blocking via Ghostery's engine (EasyList + EasyPrivacy etc).
const { webContents } = require('electron')
const fs = require('fs/promises')
const path = require('path')
const { hostOf } = require('./urls')

class AdBlock {
  constructor(ctx) {
    this.ctx = ctx
    this.blocker = null
    this.enabled = false
    this.total = 0
  }

  allowed(url) {
    const host = hostOf(url)
    return (this.ctx.settings.data.adblockAllowlist || []).some((d) => host === d || host.endsWith('.' + d))
  }

  async init(session) {
    this.session = session
    try {
      const { ElectronBlocker } = require('@ghostery/adblocker-electron')
      const cache = path.join(this.ctx.profileDir, 'adblock-engine.bin')
      this.blocker = await ElectronBlocker.fromPrebuiltAdsAndTracking(fetch, {
        path: cache,
        read: fs.readFile,
        write: fs.writeFile,
      })
      // Per-site allowlist: skip blocking when the top page is allowlisted.
      const before = this.blocker.onBeforeRequest
      this.blocker.onBeforeRequest = (details, cb) => {
        const wc = details.webContentsId ? webContents.fromId(details.webContentsId) : null
        if (wc && !wc.isDestroyed() && this.allowed(wc.getURL())) return cb({})
        return before(details, cb)
      }
      const cosmetic = this.blocker.onInjectCosmeticFilters
      this.blocker.onInjectCosmeticFilters = (event, url, msg) => {
        if (this.allowed(url)) return Promise.resolve()
        return cosmetic(event, url, msg)
      }
      this.blocker.on('request-blocked', (req) => {
        this.total++
        const tab = [...(this.ctx.browser?.tabs.values() || [])].find((t) => t.wc && !t.wc.isDestroyed() && t.wc.id === req.tabId)
        if (tab) {
          tab.blocked = (tab.blocked || 0) + 1
          this.ctx.browser.emitTabs()
        }
      })
      this.apply()
    } catch (e) {
      console.error('[adblock] failed to load filter lists:', e.message)
    }
  }

  apply() {
    if (!this.blocker) return
    const want = !!this.ctx.settings.data.adblock
    if (want && !this.enabled) this.blocker.enableBlockingInSession(this.session)
    if (!want && this.enabled) this.blocker.disableBlockingInSession(this.session)
    this.enabled = want
  }

  toggleSite(url) {
    const host = hostOf(url).replace(/^www\./, '')
    if (!host) return
    const list = new Set(this.ctx.settings.data.adblockAllowlist || [])
    list.has(host) ? list.delete(host) : list.add(host)
    this.ctx.setSettings({ adblockAllowlist: [...list] })
    this.ctx.browser.active()?.wc?.reload()
  }

  stats() {
    return { enabled: this.enabled, ready: !!this.blocker, total: this.total }
  }
}

module.exports = { AdBlock }
