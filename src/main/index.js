// Kite main process entry point.
const { app, session, protocol, net, nativeTheme, dialog, Menu } = require('electron')
const path = require('path')
const { pathToFileURL } = require('url')
const { JsonStore } = require('./store')
const { SETTINGS_DEFAULTS, DATA_DEFAULTS } = require('./defaults')
const { Browser } = require('./browser')
const { History } = require('./history')
const { Menus } = require('./menus')
const { Shortcuts } = require('./shortcuts')
const { defineActions } = require('./actions')
const { Downloads } = require('./downloads')
const { AdBlock } = require('./adblock')
const { Extensions } = require('./extensions')
const { registerApi } = require('./api')
const { Backgrounds } = require('./backgrounds')
const { Favicons } = require('./favicons')
const { Performance } = require('./performance')
const { SessionCookies } = require('./sessioncookies')

app.setName('Kite')
// Testing aid: run a fully separate instance with its own data folder.
if (process.env.KITE_USERDATA) app.setPath('userData', process.env.KITE_USERDATA)
migrateFromOldName()

const argProfile = process.argv.find((a) => a.startsWith('--profile='))
const profile = (argProfile ? argProfile.split('=')[1] : 'default').replace(/[^\w-]/g, '') || 'default'
const dev = process.argv.includes('--dev')

if (!app.requestSingleInstanceLock({ profile })) {
  app.quit()
  return
}

protocol.registerSchemesAsPrivileged([
  { scheme: 'kite', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
])

// Look like plain Chrome to websites (some sign-in pages reject "Electron").
const chromeUA = app.userAgentFallback.replace(/\s(Electron|kite|Kite)\/[\d.]+/g, '')

// Web identity: Kite presents itself exactly like a regular Chromium browser
// (reduced user agent, client hints, matching languages). Without this, Google
// refuses sign-in with "This browser or app may not be secure".
const CHROME_MAJOR = process.versions.chrome.split('.')[0]
const reducedUA = chromeUA.replace(/Chrome\/[\d.]+/, `Chrome/${CHROME_MAJOR}.0.0.0`)
function acceptLanguages() {
  const tags = [app.getLocale(), ...(app.getPreferredSystemLanguages?.() || [])].map((t) => String(t).replace('_', '-')).filter((t) => /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/i.test(t))
  const out = []
  for (const t of tags) {
    for (const v of [t, t.split('-')[0]]) if (!out.some((o) => o.toLowerCase() === v.toLowerCase())) out.push(v)
  }
  return (out.length ? out : ['en-US', 'en']).join(',')
}
function identityOverride() {
  const full = process.versions.chrome
  const platform = { linux: 'Linux', win32: 'Windows', darwin: 'macOS' }[process.platform] || 'Linux'
  return {
    userAgent: reducedUA,
    acceptLanguage: acceptLanguages(),
    platform: { linux: 'Linux x86_64', win32: 'Win32', darwin: 'MacIntel' }[process.platform] || 'Linux x86_64',
    userAgentMetadata: {
      brands: [{ brand: 'Chromium', version: CHROME_MAJOR }, { brand: 'Not_A Brand', version: '99' }],
      fullVersionList: [{ brand: 'Chromium', version: full }, { brand: 'Not_A Brand', version: '99.0.0.0' }],
      platform,
      platformVersion: process.platform === 'linux' ? require('os').release().split('-')[0] : process.getSystemVersion?.() || '',
      architecture: process.arch.startsWith('arm') ? 'arm' : 'x86',
      bitness: process.arch.includes('64') ? '64' : '32',
      model: '',
      mobile: false,
      wow64: false,
    },
  }
}
// Applied through Chromium's own emulation hook so headers, client hints and
// navigator.* all agree.
function applyIdentity(wc) {
  try {
    if (!wc.debugger.isAttached()) wc.debugger.attach('1.3')
    wc.debugger.sendCommand('Emulation.setUserAgentOverride', identityOverride()).catch(() => {})
  } catch {}
}


const PAGES_DIR = path.join(__dirname, '../pages')
const RENDERER_DIR = path.join(__dirname, '../renderer')

function handleInternalProtocol(ctx, ses) {
  ses.protocol.handle('kite', async (req) => {
    const u = new URL(req.url)
    let file
    if (u.host === 'favicon') return ctx.favicons.serve(u.searchParams.get('u'))
    if (u.host === 'bg') {
      const f = ctx.backgrounds.file(u.pathname)
      if (!f) return new Response('Not found', { status: 404 })
      // readable by the new tab page's canvas (accent color from the photo)
      const res = await net.fetch(pathToFileURL(f).toString())
      return new Response(res.body, { headers: { 'content-type': res.headers.get('content-type') || 'image/jpeg', 'access-control-allow-origin': '*' } })
    }
    if (u.host === 'shared') file = path.join(PAGES_DIR, 'shared', u.pathname)
    else if (u.host === 'ui') file = path.join(RENDERER_DIR, u.pathname)
    else file = path.join(PAGES_DIR, (u.host || 'newtab') + '.html')
    // block path traversal outside our folders
    const norm = path.normalize(file)
    if (!norm.startsWith(PAGES_DIR) && !norm.startsWith(RENDERER_DIR)) return new Response('Not found', { status: 404 })
    return net.fetch(pathToFileURL(norm).toString()).catch(() => net.fetch(pathToFileURL(path.join(PAGES_DIR, 'error.html')).toString()))
  })
}

const ASK = new Set(['media', 'geolocation', 'notifications', 'midi', 'midiSysex', 'clipboard-read', 'idle-detection', 'hid', 'serial', 'usb', 'openExternal', 'window-management'])
const ALLOW = new Set(['fullscreen', 'clipboard-sanitized-write', 'pointerLock', 'keyboardLock', 'speaker-selection'])

function setupPermissions(ctx, ses) {
  ses.setPermissionRequestHandler(async (wc, permission, cb, details) => {
    if (ALLOW.has(permission)) return cb(true)
    if (!ASK.has(permission)) return cb(false)
    let origin = ''
    try {
      origin = new URL(details.requestingUrl || wc.getURL()).origin
    } catch {}
    if (origin.startsWith('kite://')) return cb(true)
    const perms = ctx.data.get('permissions')
    const remembered = perms[origin]?.[permission]
    if (remembered !== undefined) return cb(remembered)
    const what = permission === 'media' ? `use your ${(details.mediaTypes || ['camera', 'microphone']).join(' and ')}` : `use ${permission}`
    const r = await dialog.showMessageBox({
      type: 'question',
      buttons: ['Allow', 'Block'],
      defaultId: 1,
      cancelId: 1,
      checkboxLabel: 'Remember for this site',
      checkboxChecked: true,
      message: `${origin || 'This site'} wants to ${what}.`,
    })
    const allow = r.response === 0
    if (r.checkboxChecked) {
      perms[origin] = { ...(perms[origin] || {}), [permission]: allow }
      ctx.data.set('permissions', perms)
    }
    cb(allow)
  })
  ses.setPermissionCheckHandler((_wc, permission, origin) => {
    if (ALLOW.has(permission)) return true
    if ((origin || '').startsWith('kite://')) return true
    const p = ctx.data.get('permissions')[origin]?.[permission]
    return p === true
  })
}

function privacyHeaders(ctx, ses) {
  ses.webRequest.onBeforeSendHeaders((details, cb) => {
    const h = details.requestHeaders
    if (ctx.settings.data.doNotTrack) {
      h.DNT = '1'
      h['Sec-GPC'] = '1'
    }
    cb({ requestHeaders: h })
  })
}

// macOS hands links to the app with this event (e.g. Kite as default browser);
// it can arrive before the window exists, so queue those.
const pendingUrls = []
let openUrl = (url) => pendingUrls.push(url)
app.on('open-url', (e, url) => {
  e.preventDefault()
  openUrl(url)
})

app.whenReady().then(async () => {
  // macOS needs an app menu for ⌘C / ⌘V / ⌘Q to work in text fields.
  if (process.platform === 'darwin') Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'windowMenu' }]))
  else Menu.setApplicationMenu(null)
  const profileDir = path.join(app.getPath('userData'), 'profiles', profile)
  const ctx = {
    dev,
    profile,
    profileDir,
    settings: new JsonStore(path.join(profileDir, 'settings.json'), SETTINGS_DEFAULTS),
    data: new JsonStore(path.join(profileDir, 'data.json'), DATA_DEFAULTS),
  }
  reconcileLists(ctx.settings)
  migrate(ctx)
  ctx.backgrounds = new Backgrounds(ctx)
  ctx.favicons = new Favicons(ctx)

  ctx.tabSession = session.fromPartition(`persist:kite-${profile}`)
  ctx.panelSession = session.fromPartition(`persist:panels-${profile}`)
  for (const ses of [ctx.tabSession, ctx.panelSession]) {
    ses.setUserAgent(reducedUA, acceptLanguages())
    webSessions.add(ses)
    handleInternalProtocol(ctx, ses)
    setupPermissions(ctx, ses)
    privacyHeaders(ctx, ses)
    ses.registerPreloadScript({ id: 'kite-identity', type: 'frame', filePath: path.join(__dirname, '../preload/identity.js') })
  }
  ctx.tabSession.setSpellCheckerEnabled(true)
  // the browser UI (default session) shows site icons from kite://favicon too
  handleInternalProtocol(ctx, session.defaultSession)

  ctx.history = new History(ctx.data)
  ctx.menus = new Menus(ctx)
  ctx.actions = defineActions(ctx)
  ctx.shortcuts = new Shortcuts(ctx)
  ctx.downloads = new Downloads(ctx)
  ctx.downloads.attach(ctx.tabSession)
  ctx.downloads.attach(ctx.panelSession)
  ctx.adblock = new AdBlock(ctx)
  ctx.extensions = new Extensions(ctx)

  ctx.isBookmarked = (url) => !!url && ctx.data.get('bookmarks').some((b) => b.url === url)
  // The star / Ctrl+D asks where to save it (bookmarks bar or a folder);
  // on an already-bookmarked page it opens the same box to edit or remove.
  ctx.toggleBookmark = (url, title) => {
    const t = ctx.browser.active()
    url = url || (t?.wc ? t.wc.getURL() : t?.url)
    title = title || t?.title || url
    if (!url) return
    ctx.browser.emit('bookmark-dialog', { url, title })
  }
  // Instant add/remove without asking (kept for internal use)
  ctx.quickToggleBookmark = (url, title) => {
    const t = ctx.browser.active()
    url = url || (t?.wc ? t.wc.getURL() : t?.url)
    title = title || t?.title || url
    if (!url) return
    let list = ctx.data.get('bookmarks')
    const had = list.some((b) => b.url === url)
    list = had ? list.filter((b) => b.url !== url) : [...list, { id: 'b' + Date.now(), title, url, folder: 'Bookmarks bar', added: Date.now() }]
    ctx.data.set('bookmarks', list)
    ctx.browser.emit('data:bookmarks', list)
    ctx.browser.emit('toast', { text: had ? 'Bookmark removed' : 'Bookmarked' })
    ctx.browser.emitTabs()
  }
  ctx.setSettings = (patch) => {
    const before = { ...ctx.settings.data }
    ctx.settings.patch(patch)
    const s = ctx.settings.data
    if ('shortcuts' in patch) ctx.shortcuts.rebuild()
    if ('adblock' in patch) ctx.adblock.apply()
    if ('theme' in patch || 'customThemes' in patch || 'themeSchedule' in patch) applyNativeTheme(s)
    if ('pageZoom' in patch) for (const t of ctx.browser.tabs.values()) if (t.wc && !t.wc.isDestroyed()) t.wc.setZoomFactor(s.pageZoom || 1)
    if ('aiProviders' in patch || 'webPanels' in patch) {
      // drop panel views whose URL changed or that were removed
      for (const key of [...ctx.browser.panels.keys()]) if (!ctx.browser.panelURL(key)) ctx.browser.destroyPanel(key)
    }
    if ('restoreSession' in patch && s.restoreSession && !before.restoreSession) ctx.browser.saveSession()
    ctx.browser.emit('settings', s)
    return s
  }

  // Websites follow the browser theme (prefers-color-scheme), including the
  // time-of-day schedule.
  function scheduledThemeId(s) {
    const sc = s.themeSchedule
    if (!sc?.enabled) return s.theme
    const mins = (v) => {
      const [h, m] = String(v || '0:0').split(':').map(Number)
      return (h || 0) * 60 + (m || 0)
    }
    const d = new Date()
    const t = d.getHours() * 60 + d.getMinutes()
    const from = mins(sc.from)
    const to = mins(sc.to)
    const dark = from <= to ? t >= from && t < to : t >= from || t < to
    return dark ? sc.dark : sc.light
  }
  function applyNativeTheme(s) {
    const id = scheduledThemeId(s)
    if (id === 'light' || id === 'dark') nativeTheme.themeSource = id
    else if (id === 'system') nativeTheme.themeSource = 'system'
    else {
      const t = (s.customThemes || []).find((x) => x.id === id)
      let dark = t?.dark
      if (dark === undefined) {
        try {
          dark = require(path.join(__dirname, '../themes', id + '.json')).dark
        } catch {}
      }
      nativeTheme.themeSource = dark === undefined ? 'system' : dark ? 'dark' : 'light'
    }
  }
  applyNativeTheme(ctx.settings.data)
  setInterval(() => ctx.settings.data.themeSchedule?.enabled && applyNativeTheme(ctx.settings.data), 60000)
  nativeTheme.on('updated', () => ctx.browser?.emit('native-theme', nativeTheme.shouldUseDarkColors))

  registerApi(ctx)

  // Extensions must be ready before tabs are created so they can attach.
  await ctx.extensions.init(ctx.tabSession)
  // bring back sign-ins kept in session cookies before any page loads
  ctx.sessionCookies = new SessionCookies(ctx)
  await ctx.sessionCookies.restore()
  ctx.sessionCookies.startAutosave()
  ctx.browser = new Browser(ctx).create()
  ctx.perf = new Performance(ctx)
  // Startup (reading settings, history, filter lists) leaves ~100 MB of
  // garbage in the main process that V8 would otherwise keep for a long time.
  ctx.freeMemory = () => {
    try {
      require('v8').setFlagsFromString('--expose-gc')
      require('vm').runInNewContext('gc')()
    } catch {}
  }
  setTimeout(ctx.freeMemory, 15000)
  require('./debug').setupDebug(ctx)
  ctx.adblock.init(ctx.tabSession) // loads in the background

  app.on('second-instance', (_e, argv) => {
    const url = argv.find((a) => /^(https?|file):/.test(a))
    if (url) ctx.browser.newTab(url)
    if (ctx.browser.win) {
      if (ctx.browser.win.isMinimized()) ctx.browser.win.restore()
      ctx.browser.win.focus()
    }
  })
  openUrl = (url) => ctx.browser.newTab(url)
  pendingUrls.splice(0).forEach(openUrl)
  const startUrl = process.argv.slice(1).find((a) => /^(https?|file):/.test(a))
  if (startUrl) ctx.browser.newTab(startUrl)

  let cleaned = false
  let cookiesSaved = false
  app.on('before-quit', async (e) => {
    ctx.browser?.saveSession(true)
    ctx.settings.flush()
    ctx.data.flush()
    // keep session cookies (and make sure all cookies reach the disk)
    if (!cookiesSaved) {
      e.preventDefault()
      cookiesSaved = true
      await ctx.sessionCookies.save()
      await Promise.all([ctx.tabSession, ctx.panelSession].map((s) => s.cookies.flushStore().catch(() => {})))
      return app.quit()
    }
    if (ctx.settings.data.clearOnExit && !cleaned) {
      e.preventDefault()
      cleaned = true
      ctx.history.clear()
      ctx.data.set('session', { tabs: [], workspace: ctx.browser?.workspace || 'default' })
      ctx.data.flush()
      await ctx.tabSession.clearStorageData().catch(() => {})
      await ctx.tabSession.clearCache().catch(() => {})
      app.quit()
    }
  })
})

app.on('window-all-closed', () => app.quit())

// Shutdown signals (logging out, system shutdown, `kill`) quit cleanly, so
// open tabs and sign-ins are saved instead of the process just dying.
for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(sig, () => app.quit())

// Every tab, side panel and sign-in popup gets the browser identity.
const webSessions = new Set() // the sessions web pages run in (tabs, panels)
app.on('web-contents-created', (_e, wc) => {
  if (wc.getType() === 'backgroundPage' || !webSessions.has(wc.session)) return
  applyIdentity(wc)
})

// The ad blocker injects cosmetic scripts without catching failures (common on
// YouTube); those are harmless, so keep them out of the log.
process.on('unhandledRejection', (e) => {
  if (/Script failed to execute/.test(String(e?.message || e))) return
  console.error('Unhandled rejection:', e)
})

// The browser used to be called "Wowzer". Move its data folder, partitions
// (logins/cookies) and kite:// URLs over so nothing is lost.
function migrateFromOldName() {
  const fs = require('fs')
  const userData = app.getPath('userData')
  const old = path.join(app.getPath('appData'), 'Wowzer')
  try {
    // Electron may already have created an empty Kite folder at startup, so
    // move the old folder's contents in unless Kite already has profiles.
    if (!process.env.KITE_USERDATA && fs.existsSync(path.join(old, 'profiles')) && !fs.existsSync(path.join(userData, 'profiles'))) {
      fs.mkdirSync(userData, { recursive: true })
      for (const entry of fs.readdirSync(old)) {
        if (entry.startsWith('Singleton')) continue
        const to = path.join(userData, entry)
        if (fs.existsSync(to)) fs.rmSync(to, { recursive: true, force: true }) // fresh, empty copies from this launch
        fs.renameSync(path.join(old, entry), to)
      }
      fs.rmSync(old, { recursive: true, force: true }) // only lock files are left
    }
    const parts = path.join(userData, 'Partitions')
    if (fs.existsSync(parts)) {
      for (const d of fs.readdirSync(parts)) {
        const to = path.join(parts, d.replace(/^wowzer-/, 'kite-'))
        if (d.startsWith('wowzer-') && !fs.existsSync(to)) fs.renameSync(path.join(parts, d), to)
      }
    }
    const profiles = path.join(userData, 'profiles')
    if (fs.existsSync(profiles)) {
      for (const p of fs.readdirSync(profiles)) {
        for (const f of ['settings.json', 'data.json', 'backgrounds/daily/index.json']) {
          const file = path.join(profiles, p, f)
          if (!fs.existsSync(file)) continue
          const txt = fs.readFileSync(file, 'utf8')
          if (txt.includes('wowzer://')) fs.writeFileSync(file, txt.replaceAll('wowzer://', 'kite://'))
        }
      }
    }
  } catch (e) {
    console.error('[migrate] could not move old Wowzer data:', e.message)
  }
}

// One-time upgrades of older settings/data files.
const ICON_NAMES = ['home', 'briefcase', 'code', 'book', 'music', 'gamepad', 'heart', 'cart', 'coffee', 'user', 'flask', 'plane', 'camera', 'star', 'sparkles', 'globe', 'layers', 'chat', 'zap', 'moon']
function migrate(ctx) {
  const s = ctx.settings.data
  if (ctx.settings.savedVersion < 2) {
    if (s.newtab?.greeting === 'Kite.') s.newtab.greeting = ''
    if (s.searchEngine === 'duckduckgo') s.searchEngine = 'google'
    s.settingsVersion = Math.max(s.settingsVersion, 2)
    ctx.settings.save()
  }
  if (ctx.settings.savedVersion < 4) {
    if (s.newtab?.greeting) s.newtab.greetingMode = 'custom'
    s.settingsVersion = 4
    ctx.settings.save()
  }
  if (ctx.settings.savedVersion < 3) {
    s.showBookmarksBar = true
    if (s.newtab?.wallpaper) s.newtab.background = { ...s.newtab.background, type: 'image', image: s.newtab.wallpaper }
    delete s.newtab?.wallpaper
    s.settingsVersion = Math.max(s.settingsVersion, 3)
    ctx.settings.save()
  }
  const ws = ctx.data.get('workspaces')
  let changed = false
  for (const w of ws) {
    if (!ICON_NAMES.includes(w.icon)) {
      w.icon = w.id === 'default' ? 'home' : 'layers'
      changed = true
    }
  }
  if (changed) ctx.data.save()
}

// Keep the toolbar / sidebar tool lists in sync with the defaults when new
// items are added in a later version.
function reconcileLists(store) {
  for (const key of ['toolbar', 'sidebarTools']) {
    const cur = store.data[key] || []
    for (const item of SETTINGS_DEFAULTS[key]) if (!cur.find((c) => c.id === item.id)) cur.push({ ...item })
    store.data[key] = cur.filter((c) => SETTINGS_DEFAULTS[key].find((d) => d.id === c.id))
  }
  store.data.shortcuts = { ...SETTINGS_DEFAULTS.shortcuts, ...store.data.shortcuts }
  store.data.aiProviders = { ...store.data.aiProviders }
}
