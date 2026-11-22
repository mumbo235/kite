// Every user-tweakable option lives here. Edit freely: new keys are merged
// into existing settings files automatically on next launch.

const AI_PROVIDERS = {
  chatgpt: { name: 'ChatGPT', url: 'https://chatgpt.com/' },
  gemini: { name: 'Gemini', url: 'https://gemini.google.com/app' },
  claude: { name: 'Claude', url: 'https://claude.ai/new' },
  grok: { name: 'Grok', url: 'https://grok.com/' },
}

const SEARCH_ENGINES = {
  duckduckgo: { name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=%s', suggest: 'https://duckduckgo.com/ac/?type=list&q=%s' },
  google: { name: 'Google', url: 'https://www.google.com/search?q=%s', suggest: 'https://suggestqueries.google.com/complete/search?client=firefox&q=%s' },
  bing: { name: 'Bing', url: 'https://www.bing.com/search?q=%s', suggest: 'https://api.bing.com/osjson.aspx?query=%s' },
  brave: { name: 'Brave Search', url: 'https://search.brave.com/search?q=%s', suggest: 'https://search.brave.com/api/suggest?q=%s' },
  startpage: { name: 'Startpage', url: 'https://www.startpage.com/do/search?q=%s', suggest: '' },
  ecosia: { name: 'Ecosia', url: 'https://www.ecosia.org/search?q=%s', suggest: 'https://ac.ecosia.org/autocomplete?type=list&q=%s' },
}

const DEFAULT_SHORTCUTS = {
  newTab: 'Ctrl+T',
  closeTab: 'Ctrl+W',
  reopenTab: 'Ctrl+Shift+T',
  nextTab: 'Ctrl+Tab',
  prevTab: 'Ctrl+Shift+Tab',
  focusAddress: 'Ctrl+L',
  commandPalette: 'Ctrl+K',
  reload: 'Ctrl+R',
  hardReload: 'Ctrl+Shift+R',
  back: 'Alt+Left',
  forward: 'Alt+Right',
  find: 'Ctrl+F',
  zoomIn: 'Ctrl+=',
  zoomOut: 'Ctrl+-',
  zoomReset: 'Ctrl+0',
  toggleSidebar: 'Ctrl+B',
  toggleTabLayout: 'Ctrl+Shift+L',
  toggleAI: 'Ctrl+Shift+A',
  toggleNotes: 'Ctrl+Shift+N',
  bookmarkPage: 'Ctrl+D',
  openHistory: 'Ctrl+H',
  openDownloads: 'Ctrl+J',
  openSettings: 'Ctrl+,',
  devTools: 'Ctrl+Shift+I',
  fullscreen: 'F11',
  print: 'Ctrl+P',
  toggleCompact: 'Ctrl+Shift+C',
  duplicateTab: 'Ctrl+Shift+D',
  pinTab: '',
  muteTab: 'Ctrl+M',
  nextWorkspace: 'Ctrl+Alt+Right',
  prevWorkspace: 'Ctrl+Alt+Left',
  tab1: 'Ctrl+1', tab2: 'Ctrl+2', tab3: 'Ctrl+3', tab4: 'Ctrl+4',
  tab5: 'Ctrl+5', tab6: 'Ctrl+6', tab7: 'Ctrl+7', tab8: 'Ctrl+8', lastTab: 'Ctrl+9',
}

const SETTINGS_DEFAULTS = {
  settingsVersion: 3,
  // Appearance
  theme: 'system', // system | light | dark | <custom theme id>
  accent: '', // empty = theme accent
  font: 'system-ui',
  fontSize: 13,
  radius: 8,
  density: 'comfortable', // compact | comfortable | spacious
  animations: true,
  animationSpeed: 1, // multiplier
  customCSS: '',
  customThemes: [],
  userStyles: [], // [{ match: 'example.com', css: '...' }]

  // Layout
  tabLayout: 'vertical', // vertical | horizontal
  sidebarSide: 'left',
  sidebarWidth: 260,
  tabWidth: 260, // widest a top tab gets (they shrink as you open more)
  sidebarCollapsed: false,
  sidebarAutoHide: false,
  compact: false,
  panelWidth: 420,
  showBookmarksBar: true,
  toolbar: [
    { id: 'back', visible: true },
    { id: 'forward', visible: true },
    { id: 'reload', visible: true },
    { id: 'home', visible: false },
    { id: 'address', visible: true },
    { id: 'shield', visible: true },
    { id: 'bookmark', visible: true },
    { id: 'extensions', visible: true },
    { id: 'downloads', visible: true },
    { id: 'palette', visible: false },
    { id: 'menu', visible: true },
  ],
  sidebarTools: [
    { id: 'ai', visible: true },
    { id: 'bookmarks', visible: true },
    { id: 'history', visible: true },
    { id: 'downloads', visible: true },
    { id: 'notes', visible: true },
    { id: 'todo', visible: true },
    { id: 'performance', visible: true },
  ],
  webPanels: [
    // { id, url, title }
  ],

  // Browsing
  homepage: 'kite://newtab',
  newTabPage: 'kite://newtab',
  restoreSession: true,
  searchEngine: 'google',
  customEngines: [], // [{ id, name, url, keyword }]
  searchSuggestions: true,
  aiProvider: 'claude',
  aiProviders: AI_PROVIDERS,

  // New tab page
  newtab: {
    // type: daily (scenic photo, changes every day) | gradient | solid | image | none
    background: { type: 'daily', daily: 0, gradient: 'aurora', color: '#1e293b', image: '', dim: 0.2, blur: 0 },
    showLogo: true,
    showClock: true,
    showSearch: true,
    showShortcuts: true,
    greeting: '',
    shortcuts: [
      { title: 'YouTube', url: 'https://youtube.com' },
      { title: 'GitHub', url: 'https://github.com' },
      { title: 'Reddit', url: 'https://reddit.com' },
      { title: 'Wikipedia', url: 'https://wikipedia.org' },
    ],
  },

  // Privacy
  adblock: true,
  adblockAllowlist: [],
  httpsOnly: false,
  clearOnExit: false,
  doNotTrack: true,

  // Performance (0 = no limit)
  perf: { ramLimitMB: 0, cpuLimit: 100, sleepAfterMin: 0 },

  // Input
  shortcuts: DEFAULT_SHORTCUTS,
  gestures: true,
  // Right-drag directions: L R U D, combined e.g. 'DR' = down then right.
  gestureMap: { L: 'back', R: 'forward', U: 'newTab', DR: 'closeTab', UD: 'reload', DL: 'reopenTab', LR: 'prevTab', RL: 'nextTab' },

  // Extensions
  disabledExtensions: [],
  unpackedExtensions: [],
}

const DATA_DEFAULTS = {
  bookmarks: [], // [{ id, title, url, folder }]
  bookmarkFolders: ['Bookmarks bar', 'Other'],
  history: [], // [{ url, title, time }]
  notes: [{ id: 'n1', title: 'Scratchpad', body: '', updated: 0 }],
  todos: [],
  session: { tabs: [], activeId: null, workspace: 'default' },
  workspaces: [{ id: 'default', name: 'Home', icon: 'home', color: '#3b82f6' }],
  permissions: {}, // { origin: { permission: true|false } }
}

module.exports = { SETTINGS_DEFAULTS, DATA_DEFAULTS, DEFAULT_SHORTCUTS, AI_PROVIDERS, SEARCH_ENGINES }
