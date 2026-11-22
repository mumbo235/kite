// Ad & tracker blocking via Ghostery's engine (EasyList + EasyPrivacy etc).
const { webContents } = require('electron')
const fs = require('fs/promises')
const path = require('path')
const { hostOf } = require('./urls')

// Sign-in services: never block their requests. Their "telemetry" endpoints
// feed fraud checks (e.g. Apple's device verification fails with 503s when
// appleauth/jslog is blocked).
const SIGN_IN_HOSTS = ['idmsa.apple.com', 'appleid.apple.com', 'gsa.apple.com', 'signin.apple.com', 'accounts.google.com', 'accounts.youtube.com', 'login.microsoftonline.com', 'login.live.com', 'login.microsoft.com', 'account.live.com', 'auth0.com', 'okta.com', 'duosecurity.com', 'id.atlassian.com', 'login.yahoo.com']
// Sites whose own first-party requests shouldn't be blocked while you're on
// them (account pages that break when their analytics are cut).
const FIRST_PARTY_SITES = [['apple.com', 'icloud.com', 'cdn-apple.com', 'apple-cloudkit.com']]

const under = (host, d) => host === d || host.endsWith('.' + d)

function exempt(reqUrl, pageUrl) {
  const req = hostOf(reqUrl)
  if (!req) return false
  if (SIGN_IN_HOSTS.some((d) => under(req, d))) return true
  const page = hostOf(pageUrl)
  return FIRST_PARTY_SITES.some((family) => family.some((d) => under(page, d)) && family.some((d) => under(req, d)))
}

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
        const page = wc && !wc.isDestroyed() ? wc.getURL() : details.referrer || ''
        if (wc && !wc.isDestroyed() && this.allowed(page)) return cb({})
        if (exempt(details.url, page) || exempt(details.url, details.frame?.url || '')) return cb({})
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
