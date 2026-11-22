// Chrome extension support: chrome.* APIs, toolbar actions/popups, and
// installing straight from the Chrome Web Store.
const { session: electronSession, dialog } = require('electron')
const path = require('path')

class Extensions {
  constructor(ctx) {
    this.ctx = ctx
    this.api = null
    this.disabledPaths = {}
  }

  async init(session) {
    this.session = session
    const exts = session.extensions || session
    try {
      const { ElectronChromeExtensions } = require('electron-chrome-extensions')
      this.api = new ElectronChromeExtensions({
        session,
        createTab: async (details) => {
          const t = this.ctx.browser.newTab(details.url, { active: details.active !== false })
          return [t.wc, this.ctx.browser.win]
        },
        selectTab: (wc) => {
          if (this.addingTab) return // the library auto-selects new tabs; ignore that
          const t = this.ctx.browser.byWebContents(wc)
          if (t && t.id !== this.ctx.browser.activeId) this.ctx.browser.activate(t.id)
        },
        removeTab: (wc) => {
          const t = this.ctx.browser.byWebContents(wc)
          if (t) this.ctx.browser.closeTab(t.id)
        },
        createWindow: async (details) => {
          // Single-window browser: open requested URLs as tabs instead.
          const urls = [].concat(details.url || [])
          for (const u of urls) this.ctx.browser.newTab(u)
          return this.ctx.browser.win
        },
      })
      // The UI page shows extension buttons, so it needs the crx:// protocol.
      const { handleCRXProtocol } = require('electron-chrome-extensions').ElectronChromeExtensions
      for (const ses of [electronSession.defaultSession, session]) {
        try {
          handleCRXProtocol(ses)
        } catch {}
      }
    } catch (e) {
      console.error('[extensions] API init failed:', e.message)
    }

    try {
      const { installChromeWebStore } = require('electron-chrome-web-store')
      await installChromeWebStore({
        session,
        extensionsPath: path.join(this.ctx.profileDir, 'Extensions'),
        allowUnpackedExtensions: false,
        beforeInstall: async (details) => {
          const r = await dialog.showMessageBox({
            type: 'question',
            buttons: ['Add extension', 'Cancel'],
            defaultId: 0,
            cancelId: 1,
            title: 'Add extension',
            message: `Add “${details.localizedName || details.manifest?.name || details.id}” to Kite?`,
            icon: details.icon,
          })
          return { action: r.response === 0 ? 'allow' : 'deny' }
        },
      })
    } catch (e) {
      console.error('[extensions] web store init failed:', e.message)
    }

    for (const p of this.ctx.settings.data.unpackedExtensions || []) {
      try {
        await exts.loadExtension(p, { allowFileAccess: true })
      } catch (e) {
        console.error('[extensions] could not load', p, e.message)
      }
    }
    // "Disabled" extensions are simply unloaded for this session.
    for (const id of this.ctx.settings.data.disabledExtensions || []) {
      const ext = exts.getExtension(id)
      if (ext) {
        this.disabledPaths[id] = ext.path
        exts.removeExtension(id)
      }
    }
    // a turned-off extension is unloaded, so remember where it lives
    for (const [id, p] of Object.entries(this.ctx.settings.data.disabledExtensionPaths || {})) this.disabledPaths[id] ||= p
    exts.on?.('extension-loaded', () => this.emit())
    exts.on?.('extension-unloaded', () => this.emit())
  }

  emit() {
    this.ctx.browser?.emit('extensions', this.list())
  }

  addTab(wc, win) {
    this.addingTab = true
    try {
      this.api?.addTab(wc, win)
    } catch {}
    this.addingTab = false
    // keep the extension system's idea of the active tab in sync with Kite's
    const active = this.ctx.browser?.active()
    if (active?.wc && active.wc !== wc) this.selectTab(active.wc)
  }

  selectTab(wc) {
    try {
      this.api?.selectTab(wc)
    } catch {}
  }

  getContextMenuItems(wc, params) {
    return this.api ? this.api.getContextMenuItems(wc, params) : []
  }

  list() {
    const exts = this.session.extensions || this.session
    const loaded = exts.getAllExtensions().map((e) => ({
      id: e.id,
      name: e.name,
      version: e.version,
      description: e.manifest?.description || '',
      path: e.path,
      enabled: true,
      unpacked: (this.ctx.settings.data.unpackedExtensions || []).includes(e.path),
    }))
    const names = this.ctx.settings.data.extensionNames || {}
    const unpinned = new Set(this.ctx.settings.data.unpinnedExtensions || [])
    for (const e of loaded) e.pinned = !unpinned.has(e.id)
    const disabled = (this.ctx.settings.data.disabledExtensions || []).map((id) => ({ id, name: names[id] || id, version: '', description: 'Turned off', path: this.disabledPaths[id], enabled: false, pinned: !unpinned.has(id) }))
    return [...loaded, ...disabled.filter((d) => !loaded.find((l) => l.id === d.id))]
  }

  async toggle(id) {
    const exts = this.session.extensions || this.session
    const s = this.ctx.settings.data
    const disabled = new Set(s.disabledExtensions)
    const names = { ...(s.extensionNames || {}) }
    const paths = { ...(s.disabledExtensionPaths || {}) }
    if (disabled.has(id)) {
      disabled.delete(id)
      const p = this.disabledPaths[id]
      if (p) await exts.loadExtension(p, { allowFileAccess: true }).catch(() => {})
    } else {
      const ext = exts.getExtension(id)
      if (ext) {
        this.disabledPaths[id] = ext.path
        names[id] = ext.name
        paths[id] = ext.path
        exts.removeExtension(id)
      }
      disabled.add(id)
    }
    this.ctx.setSettings({ disabledExtensions: [...disabled], extensionNames: names, disabledExtensionPaths: paths })
    this.emit()
  }

  async remove(id) {
    const exts = this.session.extensions || this.session
    const ext = exts.getExtension(id)
    const unpacked = this.ctx.settings.data.unpackedExtensions || []
    if (ext && unpacked.includes(ext.path)) {
      exts.removeExtension(id)
      this.ctx.setSettings({ unpackedExtensions: unpacked.filter((p) => p !== ext.path) })
    } else {
      try {
        await require('electron-chrome-web-store').uninstallExtension(id, { session: this.session, extensionsPath: path.join(this.ctx.profileDir, 'Extensions') })
      } catch {
        if (ext) exts.removeExtension(id)
      }
    }
    const s = this.ctx.settings.data
    const without = (o) => Object.fromEntries(Object.entries(o || {}).filter(([k]) => k !== id))
    this.ctx.setSettings({
      disabledExtensions: (s.disabledExtensions || []).filter((d) => d !== id),
      unpinnedExtensions: (s.unpinnedExtensions || []).filter((d) => d !== id),
      extensionNames: without(s.extensionNames),
      disabledExtensionPaths: without(s.disabledExtensionPaths),
    })
    this.emit()
  }

  // Show on the toolbar, or keep it in the Extensions (puzzle) menu
  setPinned(id, pinned) {
    const list = new Set(this.ctx.settings.data.unpinnedExtensions || [])
    if (pinned) list.delete(id)
    else list.add(id)
    this.ctx.setSettings({ unpinnedExtensions: [...list] })
    this.emit()
  }

  // Ask before removing (it deletes the extension and its data)
  async confirmRemove(id) {
    const ext = this.list().find((e) => e.id === id)
    if (!ext) return
    const r = await dialog.showMessageBox(this.ctx.browser.win, {
      type: 'question',
      buttons: ['Remove', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      title: 'Remove extension',
      message: `Remove “${ext.name}” from Kite?`,
      detail: 'Its settings and data are deleted too. You can add it again from the Chrome Web Store.',
    })
    if (r.response === 0) await this.remove(id)
  }

  // Items the extension added to its own button's menu (chrome.contextMenus)
  ownMenuItems(id) {
    try {
      return this.api?.ctx?.store?.buildMenuItems?.(id, 'browser_action') || []
    } catch {
      return []
    }
  }

  optionsURL(id) {
    const exts = this.session.extensions || this.session
    const ext = exts.getExtension(id)
    const page = ext?.manifest?.options_page || ext?.manifest?.options_ui?.page
    return page ? `${ext.url.replace(/\/$/, '')}/${page.replace(/^\//, '')}` : null
  }

  homepage(id) {
    const exts = this.session.extensions || this.session
    const ext = exts.getExtension(id)
    return ext?.manifest?.homepage_url || `https://chromewebstore.google.com/detail/${id}`
  }

  async loadUnpacked() {
    const r = await dialog.showOpenDialog({ title: 'Load unpacked extension', properties: ['openDirectory'] })
    if (r.canceled || !r.filePaths[0]) return null
    const p = r.filePaths[0]
    const exts = this.session.extensions || this.session
    const ext = await exts.loadExtension(p, { allowFileAccess: true })
    const list = new Set(this.ctx.settings.data.unpackedExtensions || [])
    list.add(p)
    this.ctx.setSettings({ unpackedExtensions: [...list] })
    this.emit()
    return ext?.name
  }
}

module.exports = { Extensions }
