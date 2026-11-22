// Native context menus and the main "⋯" app menu.
const { Menu, MenuItem, clipboard } = require('electron')
const { currentEngine } = require('./urls')

class Menus {
  constructor(ctx) {
    this.ctx = ctx
  }

  get b() {
    return this.ctx.browser
  }

  build(template) {
    const m = new Menu()
    for (const t of template) if (t) m.append(t instanceof MenuItem ? t : new MenuItem(t))
    return m
  }

  popup(menu, x, y) {
    menu.popup({ window: this.b.win, x: Math.round(x), y: Math.round(y) })
  }

  // params is Electron's ContextMenuParams, or a compatible object built by
  // the page preload when mouse gestures are on.
  page(tab, params) {
    const wc = tab.wc
    const b = this.b
    const items = []
    const sep = { type: 'separator' }
    const engine = currentEngine(this.ctx.settings.data).name
    const sel = (params.selectionText || '').trim()

    if (params.linkURL) {
      items.push(
        { label: 'Open link in new tab', click: () => b.newTab(params.linkURL, { active: false, afterActive: true }) },
        { label: 'Open link in new tab and switch', click: () => b.newTab(params.linkURL, { afterActive: true }) },
        { label: 'Copy link address', click: () => clipboard.writeText(params.linkURL) },
        sep
      )
    }
    if (params.mediaType === 'image' && params.srcURL) {
      items.push(
        { label: 'Open image in new tab', click: () => b.newTab(params.srcURL, { afterActive: true }) },
        { label: 'Copy image', click: () => wc.copyImageAt(params.x, params.y) },
        { label: 'Copy image address', click: () => clipboard.writeText(params.srcURL) },
        { label: 'Save image…', click: () => wc.downloadURL(params.srcURL) },
        sep
      )
    }
    if (params.isEditable) {
      for (const s of (params.dictionarySuggestions || []).slice(0, 4)) {
        items.push({ label: s, click: () => wc.replaceMisspelling(s) })
      }
      if (params.misspelledWord) {
        items.push({ label: 'Add to dictionary', click: () => wc.session.addWordToSpellCheckerDictionary(params.misspelledWord) }, sep)
      }
      items.push(
        { label: 'Undo', click: () => wc.undo() },
        { label: 'Redo', click: () => wc.redo() },
        sep,
        { label: 'Cut', click: () => wc.cut() },
        { label: 'Copy', click: () => wc.copy() },
        { label: 'Paste', click: () => wc.paste() },
        { label: 'Paste as plain text', click: () => wc.pasteAndMatchStyle() },
        { label: 'Select all', click: () => wc.selectAll() },
        sep
      )
    } else if (sel) {
      const short = sel.length > 24 ? sel.slice(0, 24) + '…' : sel
      items.push(
        { label: 'Copy', click: () => wc.copy() },
        { label: `Search ${engine} for “${short}”`, click: () => b.searchSelection(sel) },
        { label: 'Ask AI about this', click: () => b.askAI(sel) },
        sep
      )
    }
    if (!params.linkURL && !params.isEditable && !sel && params.mediaType !== 'image') {
      items.push(
        { label: 'Back', enabled: wc.navigationHistory.canGoBack(), click: () => wc.navigationHistory.goBack() },
        { label: 'Forward', enabled: wc.navigationHistory.canGoForward(), click: () => wc.navigationHistory.goForward() },
        { label: 'Reload', click: () => wc.reload() },
        sep,
        { label: this.ctx.isBookmarked(wc.getURL()) ? 'Remove bookmark' : 'Bookmark this page', click: () => this.ctx.toggleBookmark() },
        { label: 'Print…', click: () => wc.print() },
        { label: 'View page source', click: () => b.newTab('view-source:' + wc.getURL(), { afterActive: true }) },
        sep
      )
    }

    try {
      const ext = this.ctx.extensions?.getContextMenuItems(wc, params) || []
      if (ext.length) {
        items.push(...ext, sep)
      }
    } catch {}

    items.push({ label: 'Inspect', click: () => wc.inspectElement(params.x, params.y) })

    const bounds = b.contentBounds
    const z = wc.getZoomFactor()
    const x = params.clientX != null ? bounds.x + params.clientX * z : bounds.x + params.x
    const y = params.clientY != null ? bounds.y + params.clientY * z : bounds.y + params.y
    this.popup(this.build(items), x, y)
  }

  panel(view, params) {
    const wc = view.webContents
    const b = this.b
    const items = []
    if (params.linkURL) items.push({ label: 'Open link in new tab', click: () => b.newTab(params.linkURL) }, { label: 'Copy link address', click: () => clipboard.writeText(params.linkURL) })
    if (params.isEditable) items.push({ label: 'Cut', click: () => wc.cut() }, { label: 'Copy', click: () => wc.copy() }, { label: 'Paste', click: () => wc.paste() }, { label: 'Select all', click: () => wc.selectAll() })
    else if (params.selectionText) items.push({ label: 'Copy', click: () => wc.copy() })
    items.push({ type: 'separator' }, { label: 'Reload panel', click: () => wc.reload() }, { label: 'Open in a tab', click: () => b.newTab(wc.getURL()) }, { label: 'Inspect', click: () => wc.inspectElement(params.x, params.y) })
    const pb = b.panelBounds || { x: 0, y: 0 }
    this.popup(this.build(items), pb.x + params.x, pb.y + params.y)
  }

  tab(id, x, y) {
    const b = this.b
    const t = b.tabs.get(id)
    if (!t) return
    const ws = this.ctx.data.get('workspaces').filter((w) => w.id !== t.workspace)
    const items = [
      { label: 'New tab', click: () => b.newTab() },
      { label: 'Reload', click: () => t.wc?.reload() },
      { label: 'Duplicate', click: () => b.duplicate(id) },
      { label: t.pinned ? 'Unpin tab' : 'Pin tab', click: () => b.togglePin(id) },
      { label: t.wc?.isAudioMuted() ? 'Unmute site' : 'Mute site', click: () => b.toggleMute(id) },
      { label: 'Copy link', click: () => clipboard.writeText(t.wc ? t.wc.getURL() : t.url) },
      { label: 'Put tab to sleep', enabled: !!t.view && id !== b.activeId, click: () => b.sleep(id) },
      ws.length && { label: 'Move to workspace', submenu: ws.map((w) => ({ label: w.name, click: () => b.moveToWorkspace(id, w.id) })) },
      { type: 'separator' },
      { label: 'Close tab', click: () => b.closeTab(id) },
      {
        label: 'Close other tabs',
        click: () => b.visibleTabs().filter((i) => i !== id && !b.tabs.get(i).pinned).forEach((i) => b.closeTab(i)),
      },
      {
        label: 'Close tabs below',
        click: () => {
          const ids = b.visibleTabs()
          ids.slice(ids.indexOf(id) + 1).forEach((i) => b.closeTab(i))
        },
      },
      { label: 'Reopen closed tab', enabled: b.closed.length > 0, click: () => b.reopenClosed() },
    ]
    this.popup(this.build(items), x, y)
  }

  // `tree` is a list of { title, url } or { folder, children: tree }.
  bookmarks(tree, x, y) {
    const b = this.b
    const toItems = (nodes) =>
      nodes.map((n) =>
        n.folder != null
          ? {
              label: n.folder.slice(0, 60),
              submenu: n.children.length ? [...toItems(n.children), { type: 'separator' }, { label: 'Open all in new tabs', click: () => flat(n.children).forEach((u) => b.newTab(u, { active: false })) }] : [{ label: '(empty)', enabled: false }],
            }
          : { label: (n.title || n.url).slice(0, 60), click: () => b.navigate(n.url) }
      )
    const flat = (nodes) => nodes.flatMap((n) => (n.folder != null ? flat(n.children) : [n.url]))
    const items = tree.length ? toItems(tree) : [{ label: 'No bookmarks', enabled: false }]
    this.popup(this.build(items), x, y)
  }

  bookmark(id, x, y) {
    const b = this.b
    const bm = this.ctx.data.get('bookmarks').find((x) => x.id === id)
    if (!bm) return
    const setList = (list) => {
      this.ctx.data.set('bookmarks', list)
      b.emit('data:bookmarks', list)
      b.emitTabs()
    }
    const items = [
      { label: 'Open', click: () => b.navigate(bm.url) },
      { label: 'Open in new tab', click: () => b.newTab(bm.url, { afterActive: true }) },
      { label: 'Open in background tab', click: () => b.newTab(bm.url, { active: false, afterActive: true }) },
      { type: 'separator' },
      { label: 'Edit…', click: () => b.emit('edit-bookmark', id) },
      { label: 'Copy link', click: () => clipboard.writeText(bm.url) },
      { label: 'Move to Other bookmarks', click: () => setList(this.ctx.data.get('bookmarks').map((x) => (x.id === id ? { ...x, folder: 'Other' } : x))) },
      { type: 'separator' },
      { label: 'Delete', click: () => setList(this.ctx.data.get('bookmarks').filter((x) => x.id !== id)) },
      { label: 'Hide bookmarks bar', click: () => this.ctx.setSettings({ showBookmarksBar: false }) },
    ]
    this.popup(this.build(items), x, y)
  }

  app(x, y) {
    const run = (a) => () => this.ctx.actions.run(a)
    const s = this.ctx.settings.data
    const items = [
      { label: 'New tab', accelerator: s.shortcuts.newTab || undefined, click: run('newTab') },
      { label: 'Reopen closed tab', click: run('reopenTab') },
      { type: 'separator' },
      { label: 'History', click: run('openHistory') },
      { label: 'Bookmarks', click: run('toggleBookmarksPanel') },
      { label: 'Downloads', click: run('openDownloads') },
      { label: 'Extensions', click: run('openExtensions') },
      { label: 'Import bookmarks & history…', click: run('importData') },
      { label: 'Chrome Web Store', click: run('openWebStore') },
      { type: 'separator' },
      {
        label: 'Zoom',
        submenu: [
          { label: 'Zoom in', click: run('zoomIn') },
          { label: 'Zoom out', click: run('zoomOut') },
          { label: 'Reset', click: run('zoomReset') },
        ],
      },
      {
        label: 'Layout',
        submenu: [
          { label: 'Vertical tabs', type: 'radio', checked: s.tabLayout === 'vertical', click: () => this.ctx.setSettings({ tabLayout: 'vertical' }) },
          { label: 'Horizontal tabs', type: 'radio', checked: s.tabLayout === 'horizontal', click: () => this.ctx.setSettings({ tabLayout: 'horizontal' }) },
          { type: 'separator' },
          { label: 'Sidebar on the right', type: 'checkbox', checked: s.sidebarSide === 'right', click: (i) => this.ctx.setSettings({ sidebarSide: i.checked ? 'right' : 'left' }) },
          { label: 'Collapse sidebar', type: 'checkbox', checked: s.sidebarCollapsed, click: run('toggleSidebar') },
          { label: 'Auto-hide sidebar', type: 'checkbox', checked: s.sidebarAutoHide, click: (i) => this.ctx.setSettings({ sidebarAutoHide: i.checked }) },
          { label: 'Compact mode', type: 'checkbox', checked: s.compact, click: run('toggleCompact') },
          { label: 'Bookmarks bar', type: 'checkbox', checked: s.showBookmarksBar, click: (i) => this.ctx.setSettings({ showBookmarksBar: i.checked }) },
        ],
      },
      { label: 'Find in page…', click: run('find') },
      { label: 'Print…', click: run('print') },
      { label: 'Command palette', click: run('commandPalette') },
      { type: 'separator' },
      { label: 'Developer tools', click: run('devTools') },
      { label: 'Settings', click: run('openSettings') },
      { label: 'Quit Kite', click: () => require('electron').app.quit() },
    ]
    this.popup(this.build(items), x, y)
  }
}

module.exports = { Menus }
