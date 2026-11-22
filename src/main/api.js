// IPC surface for the UI and internal kite:// pages.
// The renderer calls window.kite.call('method', ...args).
const { ipcMain, dialog, shell, net, app, nativeTheme } = require('electron')
const fs = require('fs')
const path = require('path')
const { currentEngine, engines, toURL, isInternal, searchURL } = require('./urls')
const { SETTINGS_DEFAULTS, DEFAULT_SHORTCUTS, SEARCH_ENGINES } = require('./defaults')

const DATA_KEYS = new Set(['bookmarks', 'bookmarkFolders', 'notes', 'todos', 'workspaces'])

function registerApi(ctx) {
  const b = () => ctx.browser

  const methods = {
    // settings
    'settings.get': () => ctx.settings.data,
    'settings.set': (patch) => ctx.setSettings(patch),
    'settings.reset': (keys) => {
      const patch = {}
      for (const k of keys || Object.keys(SETTINGS_DEFAULTS)) patch[k] = structuredClone(SETTINGS_DEFAULTS[k])
      ctx.setSettings(patch)
    },
    'settings.export': async () => {
      const r = await dialog.showSaveDialog({ defaultPath: 'kite-settings.json' })
      if (!r.canceled) fs.writeFileSync(r.filePath, JSON.stringify(ctx.settings.data, null, 2))
    },
    'settings.import': async () => {
      const r = await dialog.showOpenDialog({ filters: [{ name: 'JSON', extensions: ['json'] }] })
      if (r.canceled) return
      ctx.setSettings(JSON.parse(fs.readFileSync(r.filePaths[0], 'utf8')))
    },
    'defaults.get': () => ({ settings: SETTINGS_DEFAULTS, shortcuts: DEFAULT_SHORTCUTS, engines: SEARCH_ENGINES }),
    'engines.list': () => engines(ctx.settings.data),

    // user data
    'data.get': (key) => (DATA_KEYS.has(key) ? ctx.data.get(key) : null),
    'data.set': (key, value) => {
      if (!DATA_KEYS.has(key)) return
      ctx.data.set(key, value)
      b().emit('data:' + key, value)
      if (key === 'bookmarks') b().emitTabs()
      if (key === 'workspaces') b().emitTabs()
    },

    // tabs
    'tabs.state': () => b().state(),
    'tabs.new': (url, opts) => void b().newTab(url ? toURL(ctx.settings.data, url) : undefined, opts),
    'tabs.close': (id) => b().closeTab(id),
    'tabs.activate': (id) => b().activate(id),
    'tabs.move': (id, index) => b().moveTab(id, index),
    'tabs.pin': (id) => b().togglePin(id),
    'tabs.mute': (id) => b().toggleMute(id),
    'tabs.menu': (id, x, y) => ctx.menus.tab(id, x, y),
    'tabs.toWorkspace': (id, ws) => b().moveToWorkspace(id, ws),

    // navigation
    'nav.go': (input, opts) => b().navigate(input, opts),
    'nav.back': () => b().back(),
    'nav.forward': () => b().forward(),
    'nav.reload': (hard) => b().reload(hard),
    'nav.stop': () => b().stop(),
    'nav.focusPage': () => b().active()?.wc?.focus(),
    'find.run': (text, opts) => b().find(text, opts),
    'find.stop': () => b().stopFind(),
    'zoom.by': (d) => b().zoom(d),

    // layout reported by the UI
    'layout.content': (r) => b().setContentBounds(r),
    'layout.panel': (r) => b().setPanelBounds(r),
    'layout.overlay': (on) => b().setOverlay(!!on),
    'layout.freeze': () => b().freeze(),
    'layout.capture': () => b().capture(),
    'layout.lift': (on) => b().lift(!!on),
    'layout.animate': (args) => b().animateContent(args),
    'layout.viewport': () => b().viewport(),
    'popup.show': (rect, html, vars, fresh, mode) => b().showPopup(rect, html, vars, fresh, mode),
    'popup.hide': () => b().hidePopup(),
    'layout.thaw': () => b().thaw(),

    // side panels
    'panel.open': (key) => b().openPanel(key),
    'panel.close': () => b().closePanel(),
    'panel.reload': () => b().panelView()?.webContents.reload(),
    'panel.home': () => {
      const v = b().panelView()
      if (v) v.webContents.loadURL(b().panelURL(b().activePanel))
    },
    'panel.back': () => {
      const n = b().panelView()?.webContents.navigationHistory
      if (n?.canGoBack()) n.goBack()
    },
    'panel.openInTab': () => {
      const v = b().panelView()
      if (v) b().newTab(v.webContents.getURL())
    },
    'panel.remove': (key) => b().destroyPanel(key),

    // address bar suggestions
    suggest: async (text) => suggest(ctx, text),

    // history
    'history.search': (q, limit) => ctx.history.search(q, limit),
    'history.remove': (url) => ctx.history.remove(url),
    'history.clear': () => ctx.history.clear(),

    // bookmarks
    'bookmarks.toggle': (url, title) => ctx.toggleBookmark(url, title),

    // downloads
    'downloads.list': () => ctx.downloads.list(),
    'downloads.open': (id) => ctx.downloads.open(id),
    'downloads.show': (id) => ctx.downloads.show(id),
    'downloads.cancel': (id) => ctx.downloads.cancel(id),
    'downloads.pause': (id) => ctx.downloads.pause(id),
    'downloads.clear': () => ctx.downloads.clear(),
    'downloads.folder': () => shell.openPath(app.getPath('downloads')),

    // commands
    'actions.list': () => ctx.actions.list(),
    'actions.run': (id) => ctx.actions.run(id),
    'shortcuts.recording': (on) => (ctx.shortcuts.recording = !!on),

    // menus
    'menu.app': (x, y) => ctx.menus.app(x, y),
    'menu.bookmarks': (list, x, y) => ctx.menus.bookmarks(list || [], x, y),
    'menu.bookmark': (id, x, y) => ctx.menus.bookmark(id, x, y),
    'menu.extension': (id, x, y) => ctx.menus.extension(id, x, y),
    'menu.extensions': (x, y, anchor) => ctx.menus.extensions(x, y, anchor),
    'extensions.setPinned': (id, pinned) => ctx.extensions.setPinned(id, pinned),

    // window
    'window.minimize': () => b().win.minimize(),
    'window.maximize': () => (b().win.isMaximized() ? b().win.unmaximize() : b().win.maximize()),
    'window.close': () => b().win.close(),
    'window.state': () => b().windowState(),

    // privacy
    'adblock.stats': () => ctx.adblock.stats(),
    'adblock.toggleSite': () => ctx.adblock.toggleSite(b().active()?.wc?.getURL() || ''),
    'privacy.clearData': async (what = ['cookies', 'cache', 'storage', 'history']) => {
      if (what.includes('history')) ctx.history.clear()
      if (what.includes('cache')) await ctx.tabSession.clearCache()
      const storages = []
      if (what.includes('cookies')) storages.push('cookies')
      if (what.includes('storage')) storages.push('localstorage', 'indexdb', 'websql', 'serviceworkers', 'cachestorage', 'filesystem')
      if (storages.length) await ctx.tabSession.clearStorageData({ storages })
      return true
    },
    'privacy.clearPanels': async () => {
      await ctx.panelSession.clearStorageData()
      return true
    },
    'permissions.list': () => ctx.data.get('permissions'),
    'permissions.set': (v) => ctx.data.set('permissions', v),

    // extensions
    'extensions.list': () => ctx.extensions.list(),
    'extensions.toggle': (id) => ctx.extensions.toggle(id),
    'extensions.remove': (id) => ctx.extensions.remove(id),
    'extensions.loadUnpacked': () => ctx.extensions.loadUnpacked(),

    // themes
    'themes.list': () => listThemes(ctx),
    'themes.import': async () => {
      const r = await dialog.showOpenDialog({ title: 'Import theme', filters: [{ name: 'Theme JSON', extensions: ['json'] }] })
      if (r.canceled) return null
      const theme = JSON.parse(fs.readFileSync(r.filePaths[0], 'utf8'))
      if (!theme.colors) throw new Error('Not a Kite theme (missing "colors")')
      theme.id = theme.id || 'custom-' + Date.now()
      const list = (ctx.settings.data.customThemes || []).filter((t) => t.id !== theme.id)
      ctx.setSettings({ customThemes: [...list, theme], theme: theme.id })
      return theme.id
    },
    'themes.export': async (theme) => {
      const r = await dialog.showSaveDialog({ defaultPath: (theme.name || 'theme').replace(/\W+/g, '-').toLowerCase() + '.json' })
      if (!r.canceled) fs.writeFileSync(r.filePath, JSON.stringify(theme, null, 2))
    },
    'theme.dark': () => nativeTheme.shouldUseDarkColors,

    // profiles
    'profiles.list': () => ({ current: ctx.profile, all: listProfiles(ctx) }),
    'profiles.switch': (name) => {
      const clean = String(name).replace(/[^\w-]/g, '').slice(0, 40)
      if (!clean) return
      app.relaunch({ args: [...process.argv.slice(1).filter((a) => !a.startsWith('--profile=')), '--profile=' + clean] })
      app.quit()
    },

    // workspaces
    'workspaces.switch': (id) => b().setWorkspace(id),
    'workspaces.delete': (id) => b().deleteWorkspace(id),

    // performance
    'perf.watch': (on) => ctx.perf.watch(on),
    'perf.sleep': (id) => b().sleep(id),
    'perf.freeze': (id) => {
      const t = b().tabs.get(id)
      if (t && id !== b().activeId) return ctx.perf.freeze(t)
    },
    'perf.wake': (id) => {
      const t = b().tabs.get(id)
      if (!t) return
      if (t.frozen) return ctx.perf.unfreeze(t)
      if (!t.view) {
        b().ensureView(t)
        b().layout()
        b().emitTabs()
      }
    },

    // import / export
    'import.sources': () => require('./importer').findSources(),
    'import.run': (id, opts) => require('./importer').runImport(ctx, id, opts).finally(() => setTimeout(ctx.freeMemory, 2000)),
    'import.html': (opts) => require('./importer').importHtmlFile(ctx, opts),
    'export.html': () => require('./importer').exportHtml(ctx),

        // new tab backgrounds
    'bg.daily': () => ctx.backgrounds.daily(),
    'bg.custom': () => ctx.backgrounds.custom(),
    'bg.addCustom': () => ctx.backgrounds.addCustom(),
    'bg.removeCustom': (file) => ctx.backgrounds.removeCustom(file),
    'widgets.weather': (opts) => require('./widgets').weather(opts),
    'widgets.findPlace': (q) => require('./widgets').findPlace(q),
    'widgets.feed': (opts) => require('./widgets').feed(opts),
    'widgets.topics': () => require('./widgets').topics(),
    'widgets.ogImages': (links) => require('./widgets').ogImages(links),

    'app.info': () => ({
      version: app.getVersion(),
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
      profile: ctx.profile,
      profileDir: ctx.profileDir,
    }),
    'app.openDataFolder': () => shell.openPath(ctx.profileDir),
  }

  ipcMain.handle('wz', async (event, method, ...args) => {
    if (!trusted(ctx, event)) throw new Error('Not allowed')
    const fn = methods[method]
    if (!fn) throw new Error('Unknown method ' + method)
    return fn(...args)
  })

  // Messages from ordinary web pages (via the page preload) — limited to the
  // sending tab: gestures, mouse back/forward, and the custom context menu.
  ipcMain.on('wz:page', (event, kind, payload) => {
    const tab = b().byWebContents(event.sender)
    if (!tab) return
    if (kind === 'gesture') {
      const action = (ctx.settings.data.gestureMap || {})[payload]
      if (action) {
        if (tab.id !== b().activeId) return
        ctx.actions.run(action)
      }
    } else if (kind === 'mouse-nav') {
      payload === 'back' ? b().back() : b().forward()
    } else if (kind === 'contextmenu') {
      ctx.menus.page(tab, { ...payload, pageURL: event.sender.getURL(), frameURL: event.sender.getURL() })
    }
  })
  ipcMain.on('popup:pick', (event, index, newTab) => {
    if (event.sender === b().popup?.webContents) b().emit('popup-pick', { index, newTab })
  })
  ipcMain.on('popup:size', (event, height) => {
    if (event.sender === b().popup?.webContents) b().sizePopup(Number(height) || 0)
  })
  ipcMain.on('wz:page-config', (event) => {
    event.returnValue = { gestures: !!ctx.settings.data.gestures }
  })
}

function trusted(ctx, event) {
  const sender = event.sender
  if (sender === ctx.browser?.ui?.webContents) return true
  const url = event.senderFrame?.url || ''
  return isInternal(url) && event.senderFrame === sender.mainFrame
}

// Popular sites so typing "yo" completes to youtube.com even with no history.
const POPULAR = ['youtube.com', 'google.com', 'gmail.com', 'github.com', 'reddit.com', 'wikipedia.org', 'amazon.com', 'netflix.com', 'x.com', 'twitter.com', 'facebook.com', 'instagram.com', 'linkedin.com', 'chatgpt.com', 'claude.ai', 'gemini.google.com', 'grok.com', 'twitch.tv', 'discord.com', 'spotify.com', 'stackoverflow.com', 'news.ycombinator.com', 'maps.google.com', 'drive.google.com', 'docs.google.com', 'outlook.com', 'yahoo.com', 'ebay.com', 'tiktok.com', 'pinterest.com', 'duckduckgo.com', 'bing.com', 'imdb.com', 'weather.com', 'paypal.com']

const bare = (u) => u.replace(/^[a-z]+:\/\//i, '').replace(/^www\./i, '')

// Best host to inline-complete what the user typed, e.g. "yo" -> "youtube.com".
function completion(ctx, text, history) {
  const q = bare(text.trim().toLowerCase())
  if (!q || /\s/.test(q)) return null
  const hosts = []
  for (const h of history) {
    try {
      hosts.push(new URL(h.url).host)
    } catch {}
  }
  for (const list of [ctx.data.get('bookmarks'), ctx.settings.data.newtab?.shortcuts || []]) {
    for (const b of list) {
      try {
        hosts.push(new URL(b.url).host)
      } catch {}
    }
  }
  hosts.push(...POPULAR)
  for (const h of hosts) {
    const host = bare(h.toLowerCase())
    if (host.startsWith(q) && host !== q) return { host, url: 'https://' + h.replace(/^www\./i, (m) => m) }
  }
  return null
}

async function suggest(ctx, text) {
  text = (text || '').trim()
  if (!text) return { items: [], complete: null }
  const out = []
  const seen = new Set()
  const push = (s) => {
    if (seen.has(s.url)) return
    seen.add(s.url)
    out.push(s)
  }
  const lower = text.toLowerCase()
  for (const bm of ctx.data.get('bookmarks')) {
    if (bm.url.toLowerCase().includes(lower) || (bm.title || '').toLowerCase().includes(lower)) push({ type: 'bookmark', title: bm.title, url: bm.url })
    if (out.length >= 3) break
  }
  for (const t of ctx.browser.order.map((id) => ctx.browser.tabs.get(id))) {
    if (t.id === ctx.browser.activeId) continue
    const url = t.wc ? t.wc.getURL() : t.url
    if (url.startsWith('kite://')) continue
    if ((t.title || '').toLowerCase().includes(lower) || url.toLowerCase().includes(lower)) out.push({ type: 'tab', title: t.title, url, tabId: t.id })
    if (out.length >= 5) break
  }
  const hist = ctx.history.suggest(text, 6)
  for (const h of hist) push({ type: 'history', title: h.title, url: h.url })
  const complete = completion(ctx, text, hist)

  const engine = currentEngine(ctx.settings.data)
  const settings = ctx.settings.data
  if (settings.searchSuggestions && engine.suggest) {
    try {
      const res = await net.fetch(engine.suggest.replace('%s', encodeURIComponent(text)), { signal: AbortSignal.timeout(1500) })
      const json = await res.json()
      const list = Array.isArray(json) && Array.isArray(json[1]) ? json[1] : Array.isArray(json) ? json.map((x) => x.phrase).filter(Boolean) : []
      for (const q of list.slice(0, 5)) out.push({ type: 'search', title: String(q), url: searchURL(settings, String(q)) })
    } catch {}
  }
  return { items: out.slice(0, 12), complete }
}

function listThemes(ctx) {
  const dir = path.join(__dirname, '../themes')
  const builtin = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => ({ ...JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')), builtin: true }))
    .sort((a, b) => (a.order ?? 99) - (b.order ?? 99))
  return [...builtin, ...(ctx.settings.data.customThemes || [])]
}

function listProfiles(ctx) {
  try {
    return fs.readdirSync(path.join(app.getPath('userData'), 'profiles')).filter((f) => fs.statSync(path.join(app.getPath('userData'), 'profiles', f)).isDirectory())
  } catch {
    return [ctx.profile]
  }
}

module.exports = { registerApi }
