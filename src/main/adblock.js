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
        // Ghostery swaps some blocked requests for an empty data: URL instead
        // of cancelling them. Redirecting to data: crashes this Electron
        // (the whole browser goes down ~5 s into a YouTube video, which pings
        // doubleclick). Cancel those requests instead.
        return before(details, (r) => cb(r && r.redirectURL && r.redirectURL.startsWith('data:') ? { cancel: true } : r))
      }
      // Cosmetic filters + scriptlets. Ghostery's own version runs every
      // frame's scripts in the *main page* (webContents.executeJavaScript), so
      // pages that keep making iframes (YouTube, Shorts) got the same
      // scriptlets stacked again and again — "already declared" / "maximum
      // call stack" errors, broken players, and with extensions that add
      // frames (Bitwarden) a crash of the whole browser. Inject into the frame
      // that asked, once, and skip frames that are already gone.
      this.blocker.onInjectCosmeticFilters = (event, url, msg) => this.injectCosmetics(event, url, msg)
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

  async injectCosmetics(event, url, msg) {
    try {
      const frame = event.senderFrame
      if (!frame || frame.detached || event.sender.isDestroyed()) return
      const page = event.sender.getURL() || url
      if (this.allowed(page) || exempt(url, page)) return
      const { parse } = require('tldts-experimental')
      const parsed = parse(url)
      const first = msg === undefined // first call per document; later calls carry DOM info
      const { active, styles, scripts } = this.blocker.getCosmeticsFilters({
        domain: parsed.domain || '',
        hostname: parsed.hostname || '',
        url,
        classes: msg?.classes,
        hrefs: msg?.hrefs,
        ids: msg?.ids,
        getBaseRules: first,
        getInjectionRules: first,
        getExtendedRules: false,
        getRulesFromHostname: first,
        getRulesFromDOM: !first,
        callerContext: { frameId: event.frameId, processId: event.processId, lifecycle: msg?.lifecycle },
      })
      if (active === false) return
      const isTop = frame === frame.top
      if (styles.length > 0) {
        if (isTop) event.sender.insertCSS(styles, { cssOrigin: 'user' }).catch(() => {})
        else frame.executeJavaScript(`(() => { const s = document.createElement('style'); s.textContent = ${JSON.stringify(styles)}; (document.head || document.documentElement).appendChild(s) })()`).catch(() => {})
      }
      for (const script of scripts) {
        if (frame.detached) return
        // each scriptlet in its own block: several bundle the same helper
        // (e.g. a JSONPath class) and would clash at the page's top level
        frame.executeJavaScript(`{\n${script}\n}`, true).catch(() => {})
      }
    } catch {}
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
