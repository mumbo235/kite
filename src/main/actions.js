// Every command the browser can run. Shortcuts, gestures, the command palette
// and menus all go through here, so adding a feature = adding one entry.

function defineActions(ctx) {
  const b = () => ctx.browser
  const wc = () => ctx.browser.active()?.wc
  const toggle = (key) => () => ctx.setSettings({ [key]: !ctx.settings.data[key] })
  const ui = (name, payload) => () => b().emit(name, payload)
  const openInternal = (page) => () => {
    const [host, hash] = page.split('#')
    const url = 'kite://' + host + (hash ? '/#' + hash : '')
    const existing = [...b().tabs.values()].find((t) => (t.wc ? t.wc.getURL() : t.url).startsWith('kite://' + host))
    if (!existing) return b().newTab(url)
    b().activate(existing.id)
    if (hash) existing.wc?.loadURL(url)
  }

  const list = [
    ['newTab', 'New tab', () => b().newTab()],
    ['closeTab', 'Close tab', () => b().closeTab()],
    ['reopenTab', 'Reopen closed tab', () => b().reopenClosed()],
    ['nextTab', 'Next tab', () => b().cycleTab(1)],
    ['prevTab', 'Previous tab', () => b().cycleTab(-1)],
    ['duplicateTab', 'Duplicate tab', () => b().duplicate()],
    ['pinTab', 'Pin / unpin tab', () => b().togglePin()],
    ['muteTab', 'Mute / unmute tab', () => b().toggleMute()],
    ['focusAddress', 'Focus address bar', () => b().focusAddress()],
    ['commandPalette', 'Command palette', ui('palette')],
    ['reload', 'Reload', () => b().reload()],
    ['hardReload', 'Hard reload (ignore cache)', () => b().reload(true)],
    ['back', 'Back', () => b().back()],
    ['forward', 'Forward', () => b().forward()],
    ['home', 'Home page', () => b().navigate(ctx.settings.data.homepage)],
    ['find', 'Find in page', ui('find')],
    ['zoomIn', 'Zoom in', () => b().zoom(0.1)],
    ['zoomOut', 'Zoom out', () => b().zoom(-0.1)],
    ['zoomReset', 'Reset zoom', () => b().zoom(0)],
    ['toggleSidebar', 'Toggle sidebar', toggle('sidebarCollapsed')],
    ['toggleCompact', 'Toggle compact mode', toggle('compact')],
    ['toggleBookmarksBar', 'Toggle bookmarks bar', toggle('showBookmarksBar')],
    [
      'toggleTabLayout',
      'Switch vertical / horizontal tabs',
      () => ctx.setSettings({ tabLayout: ctx.settings.data.tabLayout === 'vertical' ? 'horizontal' : 'vertical' }),
    ],
    ['toggleSidebarSide', 'Move sidebar to other side', () => ctx.setSettings({ sidebarSide: ctx.settings.data.sidebarSide === 'left' ? 'right' : 'left' })],
    ['toggleAI', 'Toggle AI chat', ui('tool', 'ai')],
    ['toggleBookmarksPanel', 'Bookmarks panel', ui('tool', 'bookmarks')],
    ['toggleHistoryPanel', 'History panel', ui('tool', 'history')],
    ['toggleNotes', 'Notes', ui('tool', 'notes')],
    ['toggleTodo', 'To-do list', ui('tool', 'todo')],
    ['openDownloads', 'Downloads', ui('tool', 'downloads')],
    ['addWebPanel', 'Add web panel…', ui('add-web-panel')],
    ['bookmarkPage', 'Bookmark this page', () => ctx.toggleBookmark()],
    ['openHistory', 'History page', openInternal('history')],
    ['openSettings', 'Settings', openInternal('settings')],
    ['openExtensions', 'Extensions', openInternal('extensions')],
    ['importData', 'Import bookmarks & history', openInternal('settings#import')],
    ['openWebStore', 'Chrome Web Store', () => b().newTab('https://chromewebstore.google.com/')],
    ['devTools', 'Developer tools', () => wc()?.toggleDevTools()],
    ['fullscreen', 'Toggle full screen', () => b().win.setFullScreen(!b().win.isFullScreen())],
    ['print', 'Print', () => wc()?.print()],
    ['toggleAdblock', 'Toggle ad blocker', toggle('adblock')],
    ['nextWorkspace', 'Next workspace', () => b().cycleWorkspace(1)],
    ['prevWorkspace', 'Previous workspace', () => b().cycleWorkspace(-1)],
    ['newWorkspace', 'New workspace', ui('new-workspace')],
    ['scrollTop', 'Scroll to top', () => wc()?.executeJavaScript('window.scrollTo({top:0,behavior:"smooth"})')],
    ['scrollBottom', 'Scroll to bottom', () => wc()?.executeJavaScript('window.scrollTo({top:document.body.scrollHeight,behavior:"smooth"})')],
    ['clearHistory', 'Clear browsing history', () => ctx.history.clear()],
    ['lastTab', 'Go to last tab', () => b().selectIndex(-1)],
  ]
  for (let i = 1; i <= 8; i++) list.push([`tab${i}`, `Go to tab ${i}`, () => b().selectIndex(i - 1)])

  const map = new Map(list.map(([id, label, fn]) => [id, { id, label, fn }]))
  return {
    list: () => [...map.values()].map(({ id, label }) => ({ id, label, shortcut: ctx.settings.data.shortcuts[id] || '' })),
    run(id) {
      const a = map.get(id)
      if (!a) return false
      try {
        a.fn()
      } catch (e) {
        console.error('action failed', id, e)
      }
      return true
    },
  }
}

module.exports = { defineActions }
