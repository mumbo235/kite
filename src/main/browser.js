// The browser window: one UI view (our HTML chrome) plus one native
// WebContentsView per tab and per side panel, positioned where the UI says.
const { BaseWindow, WebContentsView, nativeTheme, shell, clipboard, webContents } = require('electron')
const path = require('path')
const { toURL, isInternal, hostOf, searchURL } = require('./urls')

const UI_PRELOAD = path.join(__dirname, '../preload/ui.js')
const PAGE_PRELOAD = path.join(__dirname, '../preload/page.js')
const UI_HTML = path.join(__dirname, '../renderer/index.html')
const POPUP_HTML = path.join(__dirname, '../renderer/popup/popup.html')
const POPUP_PRELOAD = path.join(__dirname, '../preload/popup.js')

let nextTabId = 1

// Window chrome per platform:
// - macOS: native window with the title bar hidden and the traffic lights inset
//   into Kite's own toolbar (macOS rounds the corners itself).
// - Windows: frameless with Kite's own buttons; Windows 11 rounds the corners.
// - Linux: frameless + transparent, so Kite draws its own rounded corners.
function platformWindowOptions() {
  if (process.platform === 'darwin') return { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 14, y: 14 }, backgroundColor: '#141417' }
  if (process.platform === 'win32') return { frame: false, backgroundColor: '#141417', roundedCorners: true }
  return { frame: false, transparent: true, backgroundColor: '#00000000' }
}

class Browser {
  constructor(ctx) {
    this.ctx = ctx
    this.tabs = new Map() // id -> tab
    this.order = [] // tab ids in display order
    this.activeId = null
    this.closed = [] // recently closed
    this.panels = new Map() // key -> WebContentsView
    this.activePanel = null
    this.contentBounds = { x: 0, y: 0, width: 0, height: 0 }
    this.panelBounds = null
    this.overlay = false
    this.htmlFullscreen = null
    this.emitTimer = null
    this.workspace = ctx.data.get('session').workspace || 'default'
    this.panelHiddenAt = new Map() // panel key -> when it was closed
    // Free memory nothing is using: closed side panels and background
    // kite:// pages (new tab, settings...) that reload instantly anyway.
    this.janitor = setInterval(() => this.tidy(), 20000)
  }

  tidy() {
    if (!this.win) return
    const now = Date.now()
    const perf = this.settings.perf || {}
    const panelMin = perf.unloadPanelsAfterMin ?? 5
    if (panelMin > 0) {
      for (const [key, since] of this.panelHiddenAt) {
        const v = this.panels.get(key)
        if (!v || key === this.activePanel) {
          this.panelHiddenAt.delete(key)
          continue
        }
        // keep a web panel that's playing music
        if (!v.webContents.isDestroyed() && v.webContents.isCurrentlyAudible()) continue
        if (now - since > panelMin * 60000) {
          this.destroyPanel(key)
          this.panelHiddenAt.delete(key)
        }
      }
    }
    for (const t of this.tabs.values()) {
      if (!t.view || t.id === this.activeId || t.wc.isDestroyed()) continue
      if (isInternal(t.wc.getURL()) && now - (t.hiddenAt || now) > 60000) this.sleep(t.id)
    }
  }

  get settings() {
    return this.ctx.settings.data
  }

  // ---------- window ----------
  create() {
    const saved = this.ctx.data.get('window') || {}
    this.win = new BaseWindow({
      width: saved.width || 1360,
      height: saved.height || 860,
      x: saved.x,
      y: saved.y,
      minWidth: 640,
      minHeight: 420,
      show: false,
      title: 'Kite',
      icon: path.join(__dirname, '../../build/icon.png'),
      ...platformWindowOptions(),
    })
    if (saved.maximized) this.win.maximize()

    this.ui = new WebContentsView({
      webPreferences: { preload: UI_PRELOAD, sandbox: false, contextIsolation: true, nodeIntegration: false },
    })
    this.ui.setBackgroundColor('#00000000')
    this.win.contentView.addChildView(this.ui)
    this.ui.webContents.loadFile(UI_HTML)
    this.ui.webContents.on('before-input-event', (e, input) => this.ctx.shortcuts.handle(e, input))
    this.ui.webContents.once('did-finish-load', () => {
      this.win.show()
      if (this.ctx.dev) this.ui.webContents.openDevTools({ mode: 'detach' })
    })

    const fit = () => {
      const { width, height } = this.win.getContentBounds()
      this.ui.setBounds({ x: 0, y: 0, width, height })
      if (this.htmlFullscreen) this.layout()
    }
    fit()
    this.win.on('resize', fit)
    this.win.on('resize', () => this.hidePopup())
    this.win.on('blur', () => this.hidePopup())
    this.win.on('maximize', () => this.emit('window', this.windowState()))
    this.win.on('unmaximize', () => this.emit('window', this.windowState()))
    this.win.on('enter-full-screen', () => this.emit('window', this.windowState()))
    this.win.on('leave-full-screen', () => this.emit('window', this.windowState()))
    this.win.on('focus', () => {
      const t = this.active()
      if (!t?.view || this.overlay) return
      if (this.isNewTabPage(t)) this.focusAddress()
      else t.wc.focus()
    })
    this.win.on('close', () => {
      const b = this.win.getNormalBounds ? this.win.getNormalBounds() : this.win.getBounds()
      this.ctx.data.set('window', { ...b, maximized: this.win.isMaximized() })
      this.saveSession(true)
    })
    this.win.on('closed', () => {
      this.win = null
      // WebContentsViews are not destroyed with their window; close them
      // explicitly or Electron aborts on shutdown.
      for (const t of this.tabs.values()) {
        if (t.wc && !t.wc.isDestroyed()) {
          t.wc.removeAllListeners('destroyed')
          t.wc.close()
        }
      }
      for (const v of this.panels.values()) if (!v.webContents.isDestroyed()) v.webContents.close()
      if (this.popup && !this.popup.webContents.isDestroyed()) this.popup.webContents.close()
      if (!this.ui.webContents.isDestroyed()) this.ui.webContents.close()
      clearInterval(this.janitor)
      require('electron').app.quit()
    })

    this.restore()
    return this
  }

  windowState() {
    if (!this.win) return {}
    return { maximized: this.win.isMaximized(), fullscreen: this.win.isFullScreen() }
  }

  // ---------- events to UI + internal pages ----------
  emit(name, payload) {
    if (this.ui && !this.ui.webContents.isDestroyed()) this.ui.webContents.send('wz:event', name, payload)
    for (const t of this.tabs.values()) {
      if (t.wc && !t.wc.isDestroyed() && isInternal(t.wc.getURL())) t.wc.send('wz:event', name, payload)
    }
  }

  emitTabs() {
    clearTimeout(this.emitTimer)
    this.emitTimer = setTimeout(() => {
      this.emit('tabs', this.state())
      this.saveSession()
    }, 16)
  }

  state() {
    return {
      tabs: this.order.map((id) => this.serialize(this.tabs.get(id))),
      activeId: this.activeId,
      workspace: this.workspace,
      workspaces: this.ctx.data.get('workspaces'),
      panel: this.activePanel,
    }
  }

  serialize(t) {
    const wc = t.wc && !t.wc.isDestroyed() ? t.wc : null
    let url = wc ? wc.getURL() || t.url : t.url
    if (url.startsWith('kite://error')) {
      try {
        url = new URL(url).searchParams.get('u') || url
      } catch {}
    }
    const nav = wc?.navigationHistory
    return {
      id: t.id,
      url,
      title: t.title || url,
      favicon: t.favicon,
      loading: t.loading,
      pinned: t.pinned,
      muted: wc ? wc.isAudioMuted() : !!t.muted,
      audible: t.audible,
      workspace: t.workspace,
      canGoBack: nav ? nav.canGoBack() : false,
      canGoForward: nav ? nav.canGoForward() : false,
      zoom: t.zoom || 1,
      blocked: t.blocked || 0,
      sleeping: !t.view,
      frozen: !!t.frozen,
      bookmarked: this.ctx.isBookmarked(url),
      secure: url.startsWith('https://') || isInternal(url),
    }
  }

  // ---------- tabs ----------
  active() {
    return this.tabs.get(this.activeId)
  }

  byWebContents(wc) {
    for (const t of this.tabs.values()) if (t.wc === wc) return t
    return null
  }

  newTab(url, opts = {}) {
    const id = nextTabId++
    const tab = {
      id,
      url: url || this.settings.newTabPage,
      title: opts.title || '',
      favicon: opts.favicon || '',
      pinned: !!opts.pinned,
      workspace: opts.workspace || this.workspace,
      loading: false,
      blocked: 0,
      view: null,
      wc: null,
      lastActive: Date.now(),
      hiddenAt: Date.now(), // for tabs opened in the background
    }
    this.tabs.set(id, tab)
    let index = opts.index ?? this.order.length
    if (opts.afterActive && this.activeId) {
      index = this.order.indexOf(this.activeId) + 1
      // keep a run of tabs opened from the same parent together
      while (index < this.order.length && this.tabs.get(this.order[index]).openerId === this.activeId) index++
      tab.openerId = this.activeId
    }
    this.order.splice(index, 0, id)
    if (!opts.lazy) this.ensureView(tab)
    if (opts.active !== false) this.activate(id)
    else this.emitTabs()
    return tab
  }

  ensureView(tab) {
    if (tab.view) return tab
    const view = new WebContentsView({
      webPreferences: {
        session: this.ctx.tabSession,
        preload: PAGE_PRELOAD,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        spellcheck: true,
        scrollBounce: true,
      },
    })
    view.setVisible(false)
    view.setBackgroundColor('#ffffff')
    tab.view = view
    tab.wc = view.webContents
    this.win.contentView.addChildView(view)
    if (this.overlay || this.lifted) this.win.contentView.addChildView(this.ui) // keep UI on top
    this.wireTab(tab)
    this.ctx.extensions?.addTab(tab.wc, this.win)
    tab.wc.loadURL(tab.url).catch(() => {})
    return tab
  }

  wireTab(tab) {
    const wc = tab.wc
    const update = () => this.emitTabs()
    wc.on('page-title-updated', (_e, title) => {
      tab.title = title
      this.ctx.history.updateTitle(wc.getURL(), title)
      update()
    })
    wc.on('page-favicon-updated', (_e, icons) => {
      tab.favicon = icons[0] || ''
      if (tab.favicon) this.ctx.favicons?.learn(wc.getURL(), tab.favicon)
      update()
    })
    wc.on('did-start-loading', () => {
      tab.loading = true
      update()
    })
    wc.on('did-stop-loading', () => {
      tab.loading = false
      update()
    })
    wc.on('did-start-navigation', (d) => {
      if (d.isMainFrame && !d.isSameDocument) {
        tab.blocked = 0
        tab.favicon = ''
      }
    })
    wc.on('did-navigate', (_e, url) => {
      tab.url = url
      tab.zoom = wc.getZoomFactor()
      this.ctx.history.add(url, tab.title)
      update()
    })
    wc.on('did-navigate-in-page', (_e, url, isMain) => {
      if (isMain) {
        tab.url = url
        this.ctx.history.add(url, tab.title)
        update()
      }
    })
    wc.on('focus', () => {
      if (tab.holdAddressFocusUntil > Date.now() && tab.id === this.activeId && !this.overlay) this.focusAddress()
    })
    wc.on('dom-ready', () => {
      this.applyUserStyles(tab)
      if (tab.id === this.activeId && this.isNewTabPage(tab) && !this.overlay) this.focusAddress()
    })
    wc.on('media-started-playing', () => {
      tab.audible = true
      update()
    })
    wc.on('media-paused', () => {
      tab.audible = false
      update()
    })
    wc.on('zoom-changed', (_e, dir) => this.zoom(dir === 'in' ? 0.1 : -0.1, tab))
    wc.on('found-in-page', (_e, r) => this.emit('find', { matches: r.matches, active: r.activeMatchOrdinal }))
    wc.on('did-fail-load', (_e, code, desc, url, isMain) => {
      if (!isMain || code === -3 || isInternal(url)) return
      const q = new URLSearchParams({ u: url, code: String(code), d: desc })
      wc.loadURL('kite://error?' + q.toString()).catch(() => {})
    })
    wc.on('render-process-gone', (_e, d) => {
      if (d.reason !== 'clean-exit') this.emit('toast', { text: `Tab crashed (${d.reason}). Reload to try again.` })
    })
    wc.on('enter-html-full-screen', () => {
      this.htmlFullscreen = tab
      this.layout()
    })
    wc.on('leave-html-full-screen', () => {
      this.htmlFullscreen = null
      this.layout()
    })
    wc.on('will-navigate', (e) => {
      if (this.settings.httpsOnly && e.url.startsWith('http://') && !/^http:\/\/(localhost|127\.|\[::1\])/.test(e.url)) {
        e.preventDefault()
        wc.loadURL(e.url.replace(/^http:/, 'https:'))
      }
    })
    wc.on('before-input-event', (e, input) => this.ctx.shortcuts.handle(e, input))
    wc.on('context-menu', (_e, params) => this.ctx.menus.page(tab, params))
    wc.setWindowOpenHandler((d) => {
      if (d.disposition === 'new-window' && /width|height|popup/.test(d.features || '')) {
        return { action: 'allow', overrideBrowserWindowOptions: { width: 520, height: 720, autoHideMenuBar: true } }
      }
      this.newTab(d.url, { active: d.disposition !== 'background-tab', afterActive: true })
      return { action: 'deny' }
    })
    wc.on('destroyed', () => {
      if (this.tabs.has(tab.id)) this.closeTab(tab.id, { skipHistory: true })
    })
  }

  applyUserStyles(tab) {
    const host = hostOf(tab.wc.getURL())
    for (const s of this.settings.userStyles || []) {
      if (s.css && s.match && (host === s.match || host.endsWith('.' + s.match) || s.match === '*')) {
        tab.wc.insertCSS(s.css).catch(() => {})
      }
    }
  }

  activate(id) {
    const tab = this.tabs.get(id)
    if (!tab) return
    if (tab.workspace !== this.workspace) this.setWorkspace(tab.workspace, { noActivate: true })
    const prev = this.tabs.get(this.activeId)
    if (prev && prev !== tab) prev.hiddenAt = Date.now()
    this.activeId = id
    tab.lastActive = Date.now()
    if (tab.frozen) this.ctx.perf?.unfreeze(tab)
    this.ensureView(tab)
    this.ctx.extensions?.selectTab(tab.wc)
    this.layout()
    if (!this.overlay) {
      if (this.isNewTabPage(tab)) {
        // a loading page grabs focus once; bounce it back to the address bar
        tab.holdAddressFocusUntil = Date.now() + 2000
        this.focusAddress()
      } else tab.wc.focus()
    }
    this.emitTabs()
  }

  isNewTabPage(tab) {
    const url = (tab.wc && !tab.wc.isDestroyed() ? tab.wc.getURL() : '') || tab.url || ''
    const ntp = (this.settings.newTabPage || 'kite://newtab').replace(/\/$/, '')
    return !url || url.replace(/\/$/, '') === ntp
  }

  // Give the browser UI keyboard focus, then put the cursor in the address bar.
  focusAddress() {
    if (!this.ui || this.ui.webContents.isDestroyed()) return
    this.ui.webContents.focus()
    this.emit('focus-address')
  }

  closeTab(id, opts = {}) {
    const tab = this.tabs.get(id ?? this.activeId)
    if (!tab) return
    id = tab.id
    const idx = this.order.indexOf(id)
    if (!opts.skipHistory) {
      this.closed.push({ url: tab.wc ? tab.wc.getURL() : tab.url, title: tab.title, workspace: tab.workspace, index: idx })
      if (this.closed.length > 25) this.closed.shift()
    }
    this.tabs.delete(id)
    this.order.splice(idx, 1)
    if (tab.view) {
      this.win?.contentView.removeChildView(tab.view)
      if (!tab.wc.isDestroyed()) tab.wc.close()
    }
    if (this.htmlFullscreen === tab) this.htmlFullscreen = null
    if (this.activeId === id) {
      const sameWs = this.order.filter((i) => this.tabs.get(i).workspace === this.workspace)
      // prefer the opener, then the neighbour to the right, then left
      const opener = tab.openerId && this.tabs.has(tab.openerId) ? tab.openerId : null
      const right = this.order.slice(idx).find((i) => this.tabs.get(i).workspace === this.workspace)
      const next = opener || right || sameWs[sameWs.length - 1]
      this.activeId = null
      if (next) this.activate(next)
      else if (this.win) this.newTab()
    }
    this.emitTabs()
  }

  reopenClosed() {
    const c = this.closed.pop()
    if (c) this.newTab(c.url, { index: Math.min(c.index, this.order.length), workspace: c.workspace })
  }

  moveTab(id, index) {
    const from = this.order.indexOf(id)
    if (from < 0) return
    this.order.splice(from, 1)
    this.order.splice(Math.max(0, Math.min(index, this.order.length)), 0, id)
    this.emitTabs()
  }

  visibleTabs() {
    return this.order.filter((i) => this.tabs.get(i).workspace === this.workspace)
  }

  cycleTab(step) {
    const ids = this.visibleTabs()
    if (!ids.length) return
    const i = ids.indexOf(this.activeId)
    this.activate(ids[(i + step + ids.length) % ids.length])
  }

  selectIndex(n) {
    const ids = this.visibleTabs()
    const id = n < 0 ? ids[ids.length - 1] : ids[n]
    if (id) this.activate(id)
  }

  togglePin(id = this.activeId) {
    const t = this.tabs.get(id)
    if (!t) return
    t.pinned = !t.pinned
    // pinned tabs live at the start of the list
    this.order.splice(this.order.indexOf(id), 1)
    const firstUnpinned = this.order.findIndex((i) => !this.tabs.get(i).pinned)
    this.order.splice(t.pinned ? (firstUnpinned < 0 ? this.order.length : firstUnpinned) : this.order.length, 0, id)
    this.emitTabs()
  }

  toggleMute(id = this.activeId) {
    const t = this.tabs.get(id)
    if (!t) return
    t.muted = !(t.wc ? t.wc.isAudioMuted() : t.muted)
    t.wc?.setAudioMuted(t.muted)
    this.emitTabs()
  }

  duplicate(id = this.activeId) {
    const t = this.tabs.get(id)
    if (t) this.newTab(t.wc ? t.wc.getURL() : t.url, { index: this.order.indexOf(id) + 1 })
  }

  sleep(id) {
    const t = this.tabs.get(id)
    if (!t || !t.view || t.id === this.activeId) return
    t.url = t.wc.getURL()
    t.frozen = false
    this.win.contentView.removeChildView(t.view)
    t.wc.removeAllListeners('destroyed')
    t.wc.close()
    t.view = null
    t.wc = null
    this.emitTabs()
  }

  // ---------- workspaces ----------
  setWorkspace(id, opts = {}) {
    const ws = this.ctx.data.get('workspaces')
    if (!ws.find((w) => w.id === id)) return
    this.workspace = id
    if (!opts.noActivate) {
      const ids = this.visibleTabs()
      if (ids.length) {
        const last = ids.map((i) => this.tabs.get(i)).sort((a, b) => b.lastActive - a.lastActive)[0]
        this.activate(last.id)
      } else this.newTab()
    }
    this.emitTabs()
  }

  cycleWorkspace(step) {
    const ws = this.ctx.data.get('workspaces')
    const i = ws.findIndex((w) => w.id === this.workspace)
    this.setWorkspace(ws[(i + step + ws.length) % ws.length].id)
  }

  moveToWorkspace(id, wsId) {
    const t = this.tabs.get(id)
    if (!t) return
    t.workspace = wsId
    if (id === this.activeId) {
      this.activeId = null
      const ids = this.visibleTabs()
      if (ids.length) this.activate(ids[ids.length - 1])
      else this.newTab()
    }
    this.emitTabs()
  }

  deleteWorkspace(wsId) {
    const ws = this.ctx.data.get('workspaces')
    if (ws.length <= 1) return
    const left = ws.filter((w) => w.id !== wsId)
    this.ctx.data.set('workspaces', left)
    for (const t of this.tabs.values()) if (t.workspace === wsId) t.workspace = left[0].id
    if (this.workspace === wsId) this.setWorkspace(left[0].id)
    this.emitTabs()
  }

  // ---------- navigation ----------
  navigate(input, opts = {}) {
    let url = toURL(this.settings, input)
    if (!url) return
    if (this.settings.httpsOnly) url = url.replace(/^http:\/\/(?!localhost|127\.|\[::1\])/, 'https://')
    const t = opts.newTab ? null : this.active()
    if (!t) return this.newTab(url)
    this.ensureView(t)
    t.wc.loadURL(url).catch(() => {})
    t.wc.focus()
  }

  back() {
    const n = this.active()?.wc?.navigationHistory
    if (n?.canGoBack()) n.goBack()
  }

  forward() {
    const n = this.active()?.wc?.navigationHistory
    if (n?.canGoForward()) n.goForward()
  }

  reload(hard) {
    const wc = this.active()?.wc
    if (!wc) return
    hard ? wc.reloadIgnoringCache() : wc.reload()
  }

  stop() {
    this.active()?.wc?.stop()
  }

  zoom(delta, tab = this.active()) {
    if (!tab?.wc) return
    const z = delta === 0 ? 1 : Math.min(5, Math.max(0.25, +(tab.wc.getZoomFactor() + delta).toFixed(2)))
    tab.wc.setZoomFactor(z)
    tab.zoom = z
    this.emitTabs()
  }

  find(text, opts = {}) {
    const wc = this.active()?.wc
    if (!wc) return
    if (!text) return wc.stopFindInPage('clearSelection')
    wc.findInPage(text, { forward: opts.forward !== false, findNext: !!opts.findNext, matchCase: !!opts.matchCase })
  }

  stopFind() {
    this.active()?.wc?.stopFindInPage('clearSelection')
  }

  // ---------- side panels (AI chat + web panels) ----------
  panelURL(key) {
    const [kind, id] = key.split(':')
    if (kind === 'ai') return (this.settings.aiProviders[id] || Object.values(this.settings.aiProviders)[0]).url
    if (kind === 'web') return this.settings.webPanels.find((p) => p.id === id)?.url
    return null
  }

  openPanel(key) {
    if (!key) return this.closePanel()
    const url = this.panelURL(key)
    if (!url) return
    let view = this.panels.get(key)
    if (!view) {
      view = new WebContentsView({
        webPreferences: { session: this.ctx.panelSession, sandbox: true, contextIsolation: true },
      })
      view.setBackgroundColor(nativeTheme.shouldUseDarkColors ? '#18181b' : '#ffffff')
      view.setVisible(false)
      this.win.contentView.addChildView(view)
      if (this.overlay || this.lifted) this.win.contentView.addChildView(this.ui)
      const wc = view.webContents
      wc.on('before-input-event', (e, input) => this.ctx.shortcuts.handle(e, input))
      wc.setWindowOpenHandler((d) => {
        // sign-in popups stay in the panel's session; normal links open as tabs
        if (d.disposition === 'new-window') {
          return { action: 'allow', overrideBrowserWindowOptions: { width: 520, height: 720, autoHideMenuBar: true } }
        }
        this.newTab(d.url, { afterActive: true })
        return { action: 'deny' }
      })
      wc.on('context-menu', (_e, params) => this.ctx.menus.panel(view, params))
      wc.loadURL(url).catch(() => {})
      this.panels.set(key, view)
    }
    if (this.activePanel && this.activePanel !== key) this.panelHiddenAt.set(this.activePanel, Date.now())
    this.panelHiddenAt.delete(key)
    this.activePanel = key
    this.layout()
    this.emitTabs()
  }

  closePanel() {
    if (this.activePanel) this.panelHiddenAt.set(this.activePanel, Date.now())
    this.activePanel = null
    this.layout()
    this.emitTabs()
  }

  panelView() {
    return this.activePanel ? this.panels.get(this.activePanel) : null
  }

  destroyPanel(key) {
    const v = this.panels.get(key)
    if (!v) return
    this.win.contentView.removeChildView(v)
    v.webContents.close()
    this.panels.delete(key)
    if (this.activePanel === key) this.activePanel = null
  }

  // ---------- layout ----------
  // Slide the active page from one rectangle to another in step with the UI's
  // sidebar/panel animation. Only its position changes per frame (cheap); its
  // size changes at most once, so the page never has to re-layout mid-slide.
  animateContent({ from, to, duration }) {
    const tab = this.active()
    clearInterval(this.animTimer)
    if (!tab?.view || this.htmlFullscreen || !this.win) return
    const ease = cubicBezier(0.16, 1, 0.3, 1)
    const width = Math.round(Math.max(from.width, to.width))
    const height = Math.round(Math.max(from.height, to.height))
    const isNtp = this.isNewTabPage(tab)
    const { width: winWidth, height: winHeight } = this.win.getContentBounds()
    const t0 = Date.now()
    const step = () => {
      if (!tab.view || tab.wc.isDestroyed()) return clearInterval(this.animTimer)
      const p = Math.min(1, (Date.now() - t0) / Math.max(1, duration))
      const e = ease(p)
      const x = Math.round(from.x + (to.x - from.x) * e)
      const y = Math.round(from.y + (to.y - from.y) * e)
      tab.view.setBounds({ x, y, width, height })
      // the new tab page keeps its background pinned to the window
      if (isNtp) tab.wc.send('wz:event', 'viewport', { x, y, width, height, winWidth, winHeight })
      if (p >= 1) clearInterval(this.animTimer)
    }
    step()
    this.animTimer = setInterval(step, 8)
  }

  setContentBounds(r) {
    clearInterval(this.animTimer)
    this.contentBounds = round(r)
    this.contentRadius = Math.max(0, Math.round(r.radius || 0))
    this.layout()
    this.emit('viewport', this.viewport())
  }

  // Where the page area sits inside the window (the new tab page pins its
  // background to the window with this, so resizing the sidebar never zooms it).
  viewport() {
    const { width, height } = this.win ? this.win.getContentBounds() : { width: 0, height: 0 }
    return { ...this.contentBounds, winWidth: width, winHeight: height }
  }

  setPanelBounds(r) {
    this.panelBounds = r ? round(r) : null
    this.panelRadius = Math.max(0, Math.round(r?.radius || 0))
    this.layout()
  }

  // ---------- floating popup layer (address bar suggestions) ----------
  // A small transparent view above the page, so the page stays live and
  // nothing has to be swapped for a screenshot while you type.
  ensurePopup() {
    if (this.popup) return this.popup
    this.popup = new WebContentsView({ webPreferences: { preload: POPUP_PRELOAD, sandbox: true, contextIsolation: true } })
    this.popup.setBackgroundColor('#00000000')
    this.popup.setVisible(false)
    this.popup.webContents.loadFile(POPUP_HTML)
    this.popupReady = new Promise((r) => this.popup.webContents.once('did-finish-load', r))
    this.win.contentView.addChildView(this.popup)
    return this.popup
  }

  async showPopup(rect, html, vars, fresh) {
    const p = this.ensurePopup()
    await this.popupReady
    this.popupRect = { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), maxHeight: Math.round(rect.maxHeight || 500) }
    p.webContents.send('popup:render', { html, vars, fresh })
    if (fresh || !p.getVisible()) {
      this.win.contentView.addChildView(p) // keep on top
      if (this.overlay || this.lifted) this.win.contentView.addChildView(this.ui)
    }
  }

  sizePopup(height) {
    if (!this.popup || !this.popupRect) return
    const r = this.popupRect
    this.popup.setBounds({ x: r.x, y: r.y, width: r.width, height: Math.min(height, r.maxHeight) })
    this.popup.setVisible(true)
  }

  hidePopup() {
    this.popupRect = null
    this.popup?.setVisible(false)
  }

  setOverlay(on) {
    if (this.overlay === on || !this.win) return
    this.overlay = on
    // re-adding a child view moves it to the top of the stack
    if (on) this.win.contentView.addChildView(this.ui)
    else if (!this.lifted) this.win.contentView.addChildView(this.ui, 0)
    if (on) this.ui.webContents.focus()
  }

  // Lift the UI above the pages (without taking focus) while it animates
  // screenshots of them; the real pages keep rendering underneath.
  lift(on) {
    if (!this.win || this.lifted === on) return
    this.lifted = on
    if (on) this.win.contentView.addChildView(this.ui)
    else if (!this.overlay) this.win.contentView.addChildView(this.ui, 0)
  }

  layout() {
    if (!this.win) return
    const active = this.active()
    const { width, height } = this.win.getContentBounds()
    for (const t of this.tabs.values()) {
      if (!t.view) continue
      if (t === active) {
        if (this.htmlFullscreen === t) {
          this.win.contentView.addChildView(t.view)
          t.view.setBounds({ x: 0, y: 0, width, height })
          t.view.setBorderRadius(0)
        } else {
          t.view.setBounds(this.contentBounds)
          t.view.setBorderRadius(0) // square: rounded page corners left dark notches
        }
        t.view.setVisible(!this.frozen && (this.contentBounds.width > 0 || this.htmlFullscreen === t))
      } else t.view.setVisible(false)
    }
    for (const [key, v] of this.panels) {
      const show = key === this.activePanel && this.panelBounds && this.panelBounds.width > 0 && !this.htmlFullscreen
      if (show) {
        v.setBounds(this.panelBounds)
        v.setBorderRadius(0)
      }
      v.setVisible(!!show && !this.frozen)
    }
  }

  // Native views can't be animated, so while the UI animates the sidebar or a
  // panel we show screenshots of the page/panel in their place, then swap the
  // real views back in at their final size ("thaw").
  // Screenshots of the visible page and side panel (without hiding them).
  async capture() {
    if (!this.win || this.htmlFullscreen) return {}
    const grab = async (view) => {
      if (!view || !view.getVisible()) return null
      try {
        const img = await view.webContents.capturePage()
        return img.isEmpty() ? null : { src: 'data:image/jpeg;base64,' + img.toJPEG(88).toString('base64') }
      } catch {
        return null
      }
    }
    const [page, panel] = await Promise.all([grab(this.active()?.view), grab(this.panelView())])
    return { page, panel }
  }

  async freeze() {
    if (!this.win || this.htmlFullscreen) return {}
    const grab = async (view) => {
      if (!view || !view.getVisible()) return null
      try {
        const img = await view.webContents.capturePage()
        if (img.isEmpty()) return null
        const { width } = img.getSize()
        const scale = view.getBounds().width / width // device pixels -> CSS px
        return { src: 'data:image/jpeg;base64,' + img.toJPEG(88).toString('base64'), scale }
      } catch {
        return null
      }
    }
    const tab = this.active()
    const [page, panel] = await Promise.all([grab(tab?.view), grab(this.panelView())])
    this.frozen = true
    this.layout()
    clearTimeout(this.thawTimer)
    this.thawTimer = setTimeout(() => this.thaw(), 2000) // safety net
    return { page, panel }
  }

  thaw() {
    clearTimeout(this.thawTimer)
    if (!this.frozen) return
    this.frozen = false
    this.layout()
  }

  // ---------- session ----------
  restore() {
    const s = this.ctx.data.get('session')
    const ws = this.ctx.data.get('workspaces')
    if (!ws.find((w) => w.id === this.workspace)) this.workspace = ws[0].id
    let activeNew = null
    if (this.settings.restoreSession && s.tabs?.length) {
      for (const t of s.tabs) {
        const wsId = ws.find((w) => w.id === t.workspace) ? t.workspace : ws[0].id
        const tab = this.newTab(t.url, { lazy: true, active: false, pinned: t.pinned, title: t.title, favicon: t.favicon, workspace: wsId })
        if (t.active) activeNew = tab.id
      }
    }
    const firstVisible = this.visibleTabs()[0]
    if (activeNew && this.tabs.get(activeNew).workspace === this.workspace) this.activate(activeNew)
    else if (firstVisible) this.activate(firstVisible)
    else this.newTab()
  }

  saveSession(now) {
    if (!this.settings.restoreSession) return
    clearTimeout(this.saveTimer)
    const doSave = () => {
      const tabs = this.order.map((id) => {
        const t = this.tabs.get(id)
        const url = t.wc && !t.wc.isDestroyed() ? t.wc.getURL() || t.url : t.url
        return { url, title: t.title, favicon: t.favicon, pinned: t.pinned, workspace: t.workspace, active: id === this.activeId }
      })
      this.ctx.data.set('session', { tabs, workspace: this.workspace })
      if (now) this.ctx.data.flush()
    }
    if (now) doSave()
    else this.saveTimer = setTimeout(doSave, 1500)
  }

  // ---------- AI helpers ----------
  async askAI(text) {
    const provider = this.settings.aiProvider
    const key = 'ai:' + provider
    this.openPanel(key)
    this.emit('panel-open', key)
    clipboard.writeText(text)
    const wc = this.panels.get(key)?.webContents
    if (!wc) return
    const inject = async () => {
      const js = `(() => {
        const els = [...document.querySelectorAll('textarea, [contenteditable="true"]')]
          .filter(e => e.offsetParent !== null);
        const el = els[els.length - 1];
        if (!el) return false;
        el.focus();
        return document.execCommand('insertText', false, ${JSON.stringify(text)});
      })()`
      try {
        return await wc.executeJavaScript(js, true)
      } catch {
        return false
      }
    }
    if (wc.isLoading()) await new Promise((r) => wc.once('did-stop-loading', r))
    wc.focus()
    const ok = await inject()
    if (!ok) this.emit('toast', { text: 'Copied to clipboard. Paste it into the chat.' })
  }

  searchSelection(text) {
    this.newTab(searchURL(this.settings, text), { afterActive: true })
  }
}

// CSS-style cubic-bezier easing (same curve as the UI's animation).
function cubicBezier(x1, y1, x2, y2) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by
  const sx = (t) => ((ax * t + bx) * t + cx) * t
  const sy = (t) => ((ay * t + by) * t + cy) * t
  const dx = (t) => (3 * ax * t + 2 * bx) * t + cx
  return (x) => {
    let t = x
    for (let i = 0; i < 8; i++) {
      const d = dx(t)
      if (Math.abs(d) < 1e-6) break
      t -= (sx(t) - x) / d
    }
    return sy(Math.min(1, Math.max(0, t)))
  }
}

function round(r) {
  return { x: Math.round(r.x), y: Math.round(r.y), width: Math.max(0, Math.round(r.width)), height: Math.max(0, Math.round(r.height)) }
}

module.exports = { Browser }
