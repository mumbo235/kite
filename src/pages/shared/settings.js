// kite://settings — every customization option in one place.
import { init, api, $, esc, onSettings, setThemes } from 'kite://shared/page.js'
import { icon } from 'kite://ui/js/icons.js'

let S = await init()
document.querySelector('.logo').innerHTML = icon('kite')
let themes = await api.call('themes.list')
const defaults = await api.call('defaults.get')
let actions = await api.call('actions.list')

// ---------- helpers ----------
const get = (path) => path.split('.').reduce((o, k) => o?.[k], S)
async function set(path, value) {
  const [top, ...rest] = path.split('.')
  let patch
  if (!rest.length) patch = { [top]: value }
  else {
    const obj = structuredClone(S[top])
    let o = obj
    for (const k of rest.slice(0, -1)) o = o[k]
    o[rest[rest.length - 1]] = value
    patch = { [top]: obj }
  }
  Object.assign(S, patch)
  await api.call('settings.set', patch)
  savedPop()
}
let popT
function savedPop() {
  clearTimeout(popT)
  let el = $('.saved-pop')
  if (!el) {
    el = document.createElement('div')
    el.className = 'saved-pop'
    el.textContent = 'Saved'
    document.body.appendChild(el)
  }
  popT = setTimeout(() => el.remove(), 1200)
}

const row = (label, desc, control, cls = '') => `<div class="row ${cls}" data-search="${esc((label + ' ' + (desc || '')).toLowerCase())}"><div class="lbl"><div>${label}</div>${desc ? `<div class="d">${desc}</div>` : ''}</div>${control}</div>`
const toggle = (path) => `<input type="checkbox" class="switch" data-k="${path}" ${get(path) ? 'checked' : ''}>`
const select = (path, opts) => `<select class="input" data-k="${path}">${opts.map(([v, l]) => `<option value="${esc(v)}" ${String(get(path)) === String(v) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`
const seg = (path, opts) => `<div class="seg" data-seg="${path}">${opts.map(([v, l]) => `<button data-v="${esc(v)}" class="${String(get(path)) === String(v) ? 'on' : ''}">${esc(l)}</button>`).join('')}</div>`
const range = (path, min, max, step, unit = '') => `<input type="range" data-k="${path}" data-num min="${min}" max="${max}" step="${step}" value="${get(path)}"><span class="val" data-val="${path}">${get(path)}${unit}</span>`
const text = (path, ph = '', w = 280) => `<input class="input" style="width:${w}px" data-k="${path}" data-lazy value="${esc(get(path) ?? '')}" placeholder="${esc(ph)}" spellcheck="false">`
const group = (title, body) => `<div class="group">${title ? `<div class="group-title">${title}</div>` : ''}${body}</div>`

// ---------- sections ----------
const SECTIONS = [
  { id: 'appearance', title: 'Appearance', icon: 'moon', desc: 'Themes, colors, fonts and motion.', render: appearance },
  { id: 'layout', title: 'Layout', icon: 'sidebar', desc: 'Tabs, sidebar, toolbar and panels.', render: layout },
  { id: 'ai', title: 'AI chat', icon: 'sparkles', desc: 'The chatbot side panel.', render: ai },
  { id: 'search', title: 'Search', icon: 'search', desc: 'Search engines and address bar.', render: search },
  { id: 'newtab', title: 'Start & new tab', icon: 'home', desc: 'Home page, new tab page and session restore.', render: newtab },
  { id: 'shortcuts', title: 'Shortcuts', icon: 'command', desc: 'Rebind any keyboard shortcut.', render: shortcuts },
  { id: 'gestures', title: 'Mouse gestures', icon: 'zap', desc: 'Hold the right mouse button and draw.', render: gestures },
  { id: 'privacy', title: 'Privacy & security', icon: 'shield', desc: 'Ad blocking, tracking and site data.', render: privacy },
  { id: 'styles', title: 'Site styles', icon: 'edit', desc: 'Inject your own CSS into websites.', render: styles },
  { id: 'extensions', title: 'Extensions', icon: 'blocks', desc: 'Chrome extensions.', render: extensions },
  { id: 'import', title: 'Import & export', icon: 'download', desc: 'Bring your bookmarks and history from another browser.', render: importSection },
  { id: 'profiles', title: 'Profiles', icon: 'layers', desc: 'Separate logins, history and settings.', render: profiles },
  { id: 'about', title: 'About & backup', icon: 'zap', desc: 'Versions, data folder, import/export.', render: about },
]

let current = (location.hash || '#appearance').slice(1)

function renderNav() {
  $('#nav-links').innerHTML = SECTIONS.map((s) => `<button class="nav-link ${s.id === current ? 'on' : ''}" data-s="${s.id}">${icon(s.icon)} ${s.title}</button>`).join('')
}
$('#nav-links').onclick = (e) => {
  const b = e.target.closest('[data-s]')
  if (!b) return
  current = b.dataset.s
  $('#filter').value = ''
  history.replaceState(null, '', '#' + current)
  renderNav()
  render()
  window.scrollTo(0, 0)
}
$('#filter').oninput = () => render()

async function render() {
  const q = $('#filter').value.trim().toLowerCase()
  const list = q ? SECTIONS : SECTIONS.filter((s) => s.id === current)
  const html = []
  for (const s of list) html.push(`<section data-sec="${s.id}"><div class="sec-title"><h1>${s.title}</h1><p>${s.desc}</p></div>${await s.render()}</section>`)
  $('#content').innerHTML = html.join('')
  if (q) {
    for (const r of document.querySelectorAll('.row[data-search]')) r.style.display = r.dataset.search.includes(q) ? '' : 'none'
    for (const g of document.querySelectorAll('.group')) g.style.display = [...g.querySelectorAll('.row')].some((r) => r.style.display !== 'none') ? '' : 'none'
    for (const sec of document.querySelectorAll('section')) sec.style.display = [...sec.querySelectorAll('.group')].some((g) => g.style.display !== 'none') ? '' : 'none'
  }
  wire()
}

// Generic wiring for data-k controls.
function wire() {
  for (const el of document.querySelectorAll('[data-k]')) {
    const path = el.dataset.k
    const evt = el.type === 'checkbox' || el.tagName === 'SELECT' ? 'change' : el.hasAttribute('data-lazy') ? 'change' : 'input'
    el.addEventListener(evt, () => {
      let v = el.type === 'checkbox' ? el.checked : el.value
      if (el.hasAttribute('data-num')) v = +v
      const out = document.querySelector(`[data-val="${path}"]`)
      if (out) out.textContent = v + (out.textContent.replace(/[\d.]+/, '') || '')
      set(path, v)
    })
  }
  for (const segEl of document.querySelectorAll('[data-seg]')) {
    segEl.onclick = (e) => {
      const b = e.target.closest('button')
      if (!b) return
      segEl.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b))
      const cur = get(segEl.dataset.seg)
      set(segEl.dataset.seg, typeof cur === 'number' ? +b.dataset.v : b.dataset.v === 'true' ? true : b.dataset.v === 'false' ? false : b.dataset.v)
    }
  }
  for (const fn of after.splice(0)) fn()
}
const after = []

// ---------- Appearance ----------
function themePreview(t) {
  const c = t.colors
  return `<div class="pv" style="background:${c.bg}"><div class="sb"><i style="background:${c.muted}"></i><i style="background:${c.accent};opacity:1"></i><i style="background:${c.muted}"></i></div><div class="ct" style="background:${c.surface};box-shadow:0 0 0 1px ${c.border}"><i style="background:${c.text};width:70%"></i><i style="background:${c.muted};width:90%;opacity:.5"></i><i style="background:${c.accent};width:30%"></i></div></div>`
}

function appearance() {
  const accents = ['', '#2563eb', '#7c3aed', '#db2777', '#dc2626', '#ea580c', '#ca8a04', '#16a34a', '#0d9488', '#0891b2', '#64748b']
  const sys = { id: 'system', name: 'System', colors: themes.find((t) => t.id === 'light').colors }
  const cards = [sys, ...themes]
    .map(
      (t) =>
        `<button class="theme-card ${S.theme === t.id ? 'on' : ''}" data-theme="${esc(t.id)}">${
          t.id === 'system'
            ? `<div class="pv" style="background:linear-gradient(90deg, ${themes.find((x) => x.id === 'light').colors.bg} 50%, ${themes.find((x) => x.id === 'dark').colors.bg} 50%)"></div>`
            : themePreview(t)
        }<div class="name">${esc(t.name)}${t.builtin === false || !t.builtin ? (t.id === 'system' ? '' : ' · custom') : ''}</div></button>`
    )
    .join('')
  after.push(() => {
    for (const b of document.querySelectorAll('[data-theme]')) b.onclick = () => set('theme', b.dataset.theme).then(render)
    for (const b of document.querySelectorAll('[data-accent]')) b.onclick = () => set('accent', b.dataset.accent).then(render)
    $('#accent-custom')?.addEventListener('change', (e) => set('accent', e.target.value).then(render))
    $('#theme-import')?.addEventListener('click', async () => {
      await api.call('themes.import')
      themes = await api.call('themes.list')
      render()
    })
    $('#theme-export')?.addEventListener('click', () => {
      const t = themes.find((x) => x.id === S.theme) || themes[0]
      api.call('themes.export', { ...t, builtin: undefined })
    })
    $('#theme-create')?.addEventListener('click', () => openThemeEditor())
    $('#theme-delete')?.addEventListener('click', async () => {
      await set('customThemes', S.customThemes.filter((t) => t.id !== S.theme))
      await set('theme', 'system')
      themes = await api.call('themes.list')
      render()
    })
  })
  const isCustom = S.customThemes.some((t) => t.id === S.theme)
  const fonts = [
    ['system-ui', 'System default'],
    ['Inter', 'Inter'],
    ['"Segoe UI"', 'Segoe UI'],
    ['Ubuntu', 'Ubuntu'],
    ['Cantarell', 'Cantarell'],
    ['"Noto Sans"', 'Noto Sans'],
    ['Roboto', 'Roboto'],
    ['ui-rounded, "SF Pro Rounded", system-ui', 'Rounded'],
    ['ui-monospace, "JetBrains Mono", monospace', 'Monospace'],
    ['Georgia, serif', 'Serif'],
  ]
  if (!fonts.find((f) => f[0] === S.font)) fonts.push([S.font, S.font])
  return (
    group('Theme', `<div class="themes">${cards}</div><div class="row"><div class="lbl"><div>Your themes</div><div class="d">Create a theme from scratch, or import/export JSON theme files.</div></div><div class="btn-row"><button class="btn" id="theme-create">${icon('plus')} Create</button><button class="btn" id="theme-import">Import</button><button class="btn" id="theme-export">Export</button>${isCustom ? '<button class="btn danger" id="theme-delete">Delete</button>' : ''}</div></div>`) +
    group(
      '',
      row(
        'Accent color',
        'Overrides the theme accent.',
        `<div class="swatches">${accents.map((a) => `<button class="swatch ${S.accent === a ? 'on' : ''}" data-accent="${a}" title="${a || 'Theme default'}" style="background:${a || 'conic-gradient(#2563eb,#16a34a,#db2777,#2563eb)'}"></button>`).join('')}<input type="color" id="accent-custom" value="${S.accent || '#2563eb'}" title="Custom color"></div>`
      ) +
        row('Font', 'Used across the browser interface.', select('font', fonts)) +
        row('Text size', '', range('fontSize', 11, 17, 1, 'px')) +
        row('Corner radius', 'From sharp to round.', range('radius', 0, 18, 1, 'px')) +
        row('Density', 'Spacing of tabs and lists.', seg('density', [['compact', 'Compact'], ['comfortable', 'Comfortable'], ['spacious', 'Spacious']]))
    ) +
    group('Motion', row('Animations', 'Turn off for an instant, no-motion UI.', toggle('animations')) + row('Animation speed', 'Lower is faster.', range('animationSpeed', 0.3, 2, 0.1, '×'))) +
    group(
      'Custom CSS',
      `<div class="row stack" data-search="custom css interface style"><div class="d muted" style="font-size:12px">Restyle the browser interface itself. Example: <code>.tab.active { box-shadow: inset 3px 0 var(--accent) }</code></div><textarea class="input code" data-k="customCSS" spellcheck="false">${esc(S.customCSS)}</textarea></div>`
    )
  )
}

function openThemeEditor() {
  const base = themes.find((t) => t.id === S.theme) || themes.find((t) => t.id === 'dark')
  const keys = Object.keys(base.colors)
  const dlg = document.createElement('dialog')
  dlg.className = 'card'
  dlg.style.cssText = 'padding:20px;width:440px;color:var(--text);border:1px solid var(--border)'
  dlg.innerHTML = `<h2>New theme</h2><div style="display:flex;flex-direction:column;gap:8px">
    <input class="input" id="tn" placeholder="Theme name" value="${esc(base.name)} copy">
    <label style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="td" ${base.dark ? 'checked' : ''}> Dark theme (web pages use dark mode)</label>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">${keys.map((k) => `<label style="display:flex;justify-content:space-between;align-items:center;gap:8px;font-size:12px">${k}<input type="color" data-c="${k}" value="${base.colors[k]}"></label>`).join('')}</div>
    <div class="btn-row" style="justify-content:flex-end;margin-top:8px"><button class="btn" id="tc">Cancel</button><button class="btn primary" id="ts">Save theme</button></div></div>`
  document.body.appendChild(dlg)
  dlg.showModal()
  const preview = () => {
    for (const i of dlg.querySelectorAll('[data-c]')) document.documentElement.style.setProperty('--' + i.dataset.c.replace(/[A-Z0-9]/g, (m) => '-' + m.toLowerCase()), i.value)
  }
  dlg.oninput = preview
  dlg.querySelector('#tc').onclick = () => {
    dlg.remove()
    render()
    location.reload()
  }
  dlg.querySelector('#ts').onclick = async () => {
    const colors = {}
    for (const i of dlg.querySelectorAll('[data-c]')) colors[i.dataset.c] = i.value
    const t = { id: 'custom-' + Date.now().toString(36), name: dlg.querySelector('#tn').value || 'My theme', dark: dlg.querySelector('#td').checked, colors }
    await set('customThemes', [...S.customThemes, t])
    await set('theme', t.id)
    themes = await api.call('themes.list')
    setThemes(themes)
    dlg.remove()
    render()
  }
}

// ---------- Layout ----------
const TOOLBAR_LABELS = { back: 'Back', forward: 'Forward', reload: 'Reload', home: 'Home', address: 'Address bar', shield: 'Ad blocker shield', bookmark: 'Bookmark star', extensions: 'Extension buttons', downloads: 'Downloads', palette: 'Command palette', menu: 'Menu' }
const TOOL_LABELS = { ai: 'AI chat', bookmarks: 'Bookmarks', history: 'History', downloads: 'Downloads', notes: 'Notes', todo: 'To-do list', performance: 'Performance' }

function sortable(key, labels) {
  const items = S[key]
  after.push(() => {
    const box = document.querySelector(`[data-sortable="${key}"]`)
    let drag = null
    box.addEventListener('dragstart', (e) => {
      drag = e.target.closest('.s-item')
      drag.classList.add('dragging')
    })
    box.addEventListener('dragend', () => {
      drag?.classList.remove('dragging')
      box.querySelectorAll('.over').forEach((x) => x.classList.remove('over'))
    })
    box.addEventListener('dragover', (e) => {
      e.preventDefault()
      const over = e.target.closest('.s-item')
      box.querySelectorAll('.over').forEach((x) => x.classList.remove('over'))
      if (over && over !== drag) over.classList.add('over')
    })
    box.addEventListener('drop', (e) => {
      e.preventDefault()
      const over = e.target.closest('.s-item')
      if (!over || !drag || over === drag) return
      const list = [...S[key]]
      const from = list.findIndex((x) => x.id === drag.dataset.id)
      const [m] = list.splice(from, 1)
      list.splice(
        list.findIndex((x) => x.id === over.dataset.id),
        0,
        m
      )
      set(key, list).then(render)
    })
    box.addEventListener('change', (e) => {
      const it = e.target.closest('.s-item')
      if (!it) return
      set(
        key,
        S[key].map((x) => (x.id === it.dataset.id ? { ...x, visible: e.target.checked } : x))
      )
    })
  })
  return `<div class="sortable" data-sortable="${key}">${items.map((it) => `<div class="s-item" draggable="true" data-id="${it.id}"><span class="grip">⋮⋮</span><div class="grow">${labels[it.id] || it.id}</div><input type="checkbox" class="switch" ${it.visible ? 'checked' : ''}></div>`).join('')}</div>`
}

function layout() {
  after.push(() => {
    const box = $('#panels-list')
    box?.addEventListener('change', (e) => {
      const it = e.target.closest('[data-pid]')
      if (!it) return
      const list = S.webPanels.map((p) => (p.id === it.dataset.pid ? { ...p, [e.target.dataset.f]: e.target.value } : p))
      set('webPanels', list)
    })
    box?.addEventListener('click', (e) => {
      const del = e.target.closest('[data-del]')
      if (del) set('webPanels', S.webPanels.filter((p) => p.id !== del.dataset.del)).then(render)
    })
    $('#panel-add')?.addEventListener('click', () => set('webPanels', [...S.webPanels, { id: 'p' + Date.now().toString(36), url: 'https://', title: 'New panel' }]).then(render))
  })
  return (
    group(
      'Tabs & sidebar',
      row('Tab layout', 'Vertical tabs live in the sidebar; horizontal tabs sit on top.', seg('tabLayout', [['vertical', 'Vertical'], ['horizontal', 'Horizontal']])) +
        row('Sidebar position', '', seg('sidebarSide', [['left', 'Left'], ['right', 'Right']])) +
        row('Collapse sidebar', 'Vertical: shrink to icons. Horizontal: hide the tool rail.', toggle('sidebarCollapsed')) +
        row('Auto-hide sidebar', 'When collapsed, hover the screen edge to reveal it.', toggle('sidebarAutoHide')) +
        row('Sidebar width', '', range('sidebarWidth', 180, 480, 10, 'px')) +
        row('Top tab width', 'With tabs on top: how wide tabs are when only a few are open. They shrink as you open more.', range('tabWidth', 140, 400, 10, 'px')) +
        row('Side panel width', 'AI chat, notes, web panels…', range('panelWidth', 300, 900, 10, 'px')) +
        row('Compact mode', 'Vertical layout: moves the address bar into the sidebar for more page space.', toggle('compact')) +
        row('Bookmarks bar', 'Shows bookmarks in the “Bookmarks bar” folder.', toggle('showBookmarksBar'))
    ) +
    group('Toolbar — drag to reorder, toggle to show', sortable('toolbar', TOOLBAR_LABELS)) +
    group('Sidebar tools — drag to reorder, toggle to show', sortable('sidebarTools', TOOL_LABELS)) +
    group(
      'Web panels',
      `<div class="hint">Pin any website to the sidebar (music, mail, chat…). They keep their own logins. Right-click a panel icon in the sidebar to remove it.</div><div id="panels-list">${S.webPanels
        .map(
          (p) =>
            `<div class="s-item" data-pid="${p.id}"><div class="grow"><input class="input" style="max-width:160px" data-f="title" value="${esc(p.title)}"><input class="input" data-f="url" value="${esc(p.url)}" spellcheck="false"></div><button class="btn ghost danger" data-del="${p.id}">${icon('trash')}</button></div>`
        )
        .join('')}</div><div class="row"><button class="btn" id="panel-add">${icon('plus')} Add web panel</button></div>`
    )
  )
}

// ---------- AI ----------
function ai() {
  const entries = Object.entries(S.aiProviders)
  after.push(() => {
    const box = $('#ai-list')
    box.addEventListener('change', (e) => {
      const it = e.target.closest('[data-aid]')
      const p = structuredClone(S.aiProviders)
      p[it.dataset.aid][e.target.dataset.f] = e.target.value
      set('aiProviders', p)
    })
    box.addEventListener('click', (e) => {
      const del = e.target.closest('[data-del]')
      if (!del) return
      const p = structuredClone(S.aiProviders)
      delete p[del.dataset.del]
      set('aiProviders', p).then(() => {
        if (S.aiProvider === del.dataset.del) set('aiProvider', Object.keys(p)[0])
        render()
      })
    })
    $('#ai-add').onclick = () => {
      const id = 'ai' + Date.now().toString(36)
      set('aiProviders', { ...S.aiProviders, [id]: { name: 'New chatbot', url: 'https://' } }).then(render)
    }
    $('#ai-reset').onclick = () => api.call('settings.reset', ['aiProviders']).then(async () => {
      S = await api.call('settings.get')
      render()
    })
    $('#ai-clear').onclick = async () => {
      if (!confirm('Sign out of all AI chat and web panels? This clears their cookies and storage.')) return
      await api.call('privacy.clearPanels')
      alert('Panel data cleared.')
    }
  })
  return (
    group('', row('Default chatbot', 'Opened when you click the AI button or use “Ask AI about this”.', select('aiProvider', entries.map(([id, p]) => [id, p.name])))) +
    group(
      'Chatbots',
      `<div class="hint">Each chatbot loads its real website in the side panel, so you sign in with your normal account — no API keys. Add any other chat site you like.</div><div id="ai-list">${entries
        .map(([id, p]) => `<div class="s-item" data-aid="${id}"><div class="grow"><input class="input" style="max-width:150px" data-f="name" value="${esc(p.name)}"><input class="input" data-f="url" value="${esc(p.url)}" spellcheck="false"></div><button class="btn ghost danger" data-del="${id}" ${entries.length < 2 ? 'disabled' : ''}>${icon('trash')}</button></div>`)
        .join('')}</div><div class="row"><div class="btn-row"><button class="btn" id="ai-add">${icon('plus')} Add chatbot</button><button class="btn ghost" id="ai-reset">Reset to defaults</button></div><div class="spacer"></div><button class="btn danger" id="ai-clear">Sign out of panels</button></div>`
    )
  )
}

// ---------- Search ----------
async function search() {
  const engines = await api.call('engines.list')
  after.push(() => {
    const box = $('#eng-list')
    box?.addEventListener('change', (e) => {
      const it = e.target.closest('[data-eid]')
      set(
        'customEngines',
        S.customEngines.map((x) => (x.id === it.dataset.eid ? { ...x, [e.target.dataset.f]: e.target.value } : x))
      )
    })
    box?.addEventListener('click', (e) => {
      const del = e.target.closest('[data-del]')
      if (del) set('customEngines', S.customEngines.filter((x) => x.id !== del.dataset.del)).then(render)
    })
    $('#eng-add').onclick = () => set('customEngines', [...S.customEngines, { id: 'e' + Date.now().toString(36), name: 'My engine', url: 'https://example.com/search?q=%s', keyword: '', suggest: '' }]).then(render)
  })
  return (
    group(
      '',
      row('Search engine', 'Used in the address bar and new tab page.', select('searchEngine', Object.entries(engines).map(([id, e]) => [id, e.name]))) +
        row('Search suggestions', 'Sends what you type to the search engine to suggest queries.', toggle('searchSuggestions'))
    ) +
    group(
      'Custom search engines',
      `<div class="hint">Use <b>%s</b> where the query goes. Give it a keyword to search directly, e.g. type <span class="kbd">yt cats</span> in the address bar.</div><div id="eng-list">${S.customEngines
        .map(
          (e) =>
            `<div class="s-item" data-eid="${e.id}"><div class="grow"><input class="input" style="max-width:130px" data-f="name" value="${esc(e.name)}" placeholder="Name"><input class="input" data-f="url" value="${esc(e.url)}" placeholder="https://…?q=%s" spellcheck="false"><input class="input" style="max-width:80px" data-f="keyword" value="${esc(e.keyword || '')}" placeholder="keyword"></div><button class="btn ghost danger" data-del="${e.id}">${icon('trash')}</button></div>`
        )
        .join('')}</div><div class="row"><button class="btn" id="eng-add">${icon('plus')} Add search engine</button></div>`
    )
  )
}

// ---------- New tab ----------
function newtab() {
  return (
    group(
      'Startup',
      row('Restore tabs on startup', 'Reopen the tabs from your last session.', toggle('restoreSession')) +
        row('Home page', 'Where the home button goes.', text('homepage', 'kite://newtab')) +
        row('New tab page', 'Use kite://newtab or any URL.', text('newTabPage', 'kite://newtab'))
    ) +
    group(
      'New tab page',
      row('Greeting', '', text('newtab.greeting', 'Optional text under the clock')) +
        row('Background', 'Pick gradients, colors and your own pictures with “Customize” on the new tab page.', select('newtab.background.type', [['daily', 'Daily scenic photo'], ['gradient', 'Gradient'], ['solid', 'Solid color'], ['image', 'My picture'], ['none', 'Plain (theme color)']])) +
        row('Show Kite logo', '', toggle('newtab.showLogo')) +
        row('Show clock', '', toggle('newtab.showClock')) +
        row('Show search box', '', toggle('newtab.showSearch')) +
        row('Show shortcuts', 'Edit shortcuts directly on the new tab page.', toggle('newtab.showShortcuts'))
    )
  )
}

// ---------- Shortcuts ----------
function shortcuts() {
  const combos = S.shortcuts
  const counts = {}
  for (const c of Object.values(combos)) if (c) counts[c] = (counts[c] || 0) + 1
  after.push(() => {
    let recording = null
    const stop = () => {
      if (!recording) return
      recording.classList.remove('rec')
      recording.textContent = S.shortcuts[recording.dataset.a] || 'Not set'
      recording = null
      api.call('shortcuts.recording', false)
      window.removeEventListener('keydown', onKey, true)
    }
    const onKey = (e) => {
      e.preventDefault()
      e.stopPropagation()
      if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return
      if (e.key === 'Escape') return stop()
      const parts = []
      if (e.ctrlKey) parts.push('Ctrl')
      if (e.altKey) parts.push('Alt')
      if (e.shiftKey) parts.push('Shift')
      if (e.metaKey) parts.push('Meta')
      const map = { Equal: '=', Minus: '-', Comma: ',', Period: '.', Slash: '/', Backslash: '\\', BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: "'", Backquote: '`', Space: 'Space', ArrowLeft: 'Left', ArrowRight: 'Right', ArrowUp: 'Up', ArrowDown: 'Down' }
      let k = e.code.startsWith('Key') ? e.code.slice(3) : e.code.startsWith('Digit') ? e.code.slice(5) : map[e.code] || e.key
      if (e.key === 'Backspace' && !parts.length) k = ''
      if (k) parts.push(k)
      const combo = k ? parts.join('+') : ''
      const id = recording.dataset.a
      stop()
      set('shortcuts', { ...S.shortcuts, [id]: combo }).then(render)
    }
    for (const b of document.querySelectorAll('.kbd-btn')) {
      b.onclick = () => {
        stop()
        recording = b
        b.classList.add('rec')
        b.textContent = 'Press keys… (Esc cancel, ⌫ clear)'
        api.call('shortcuts.recording', true)
        window.addEventListener('keydown', onKey, true)
      }
    }
    $('#sc-reset').onclick = () => set('shortcuts', structuredClone(defaults.shortcuts)).then(render)
  })
  return group(
    '',
    actions
      .filter((a) => a.id in defaults.shortcuts || combos[a.id])
      .concat(actions.filter((a) => !(a.id in defaults.shortcuts) && !combos[a.id]))
      .map((a) => row(a.label, counts[combos[a.id]] > 1 ? '<span style="color:var(--danger)">Conflicts with another shortcut</span>' : '', `<button class="kbd-btn ${counts[combos[a.id]] > 1 ? 'conflict' : ''}" data-a="${a.id}">${esc(combos[a.id] || 'Not set')}</button>`))
      .join('') + `<div class="row"><div class="lbl muted">Click a shortcut, then press the new key combination.</div><button class="btn" id="sc-reset">Reset all</button></div>`
  )
}

// ---------- Gestures ----------
function gestures() {
  const map = S.gestureMap || {}
  const opts = [['', '— none —'], ...actions.map((a) => [a.id, a.label])]
  const arrows = (p) => p.replace(/L/g, '←').replace(/R/g, '→').replace(/U/g, '↑').replace(/D/g, '↓')
  after.push(() => {
    const box = $('#g-list')
    box.addEventListener('change', (e) => {
      const it = e.target.closest('[data-g]')
      const m = { ...S.gestureMap }
      if (e.target.dataset.f === 'action') m[it.dataset.g] = e.target.value
      set('gestureMap', m)
    })
    box.addEventListener('click', (e) => {
      const del = e.target.closest('[data-del]')
      if (!del) return
      const m = { ...S.gestureMap }
      delete m[del.dataset.del]
      set('gestureMap', m).then(render)
    })
    $('#g-add').onclick = () => {
      const pat = $('#g-new').value.toUpperCase().replace(/[^LRUD]/g, '')
      if (!pat) return
      set('gestureMap', { ...S.gestureMap, [pat]: 'reload' }).then(render)
    }
  })
  return (
    group('', row('Mouse gestures', 'Hold the right mouse button, draw, release. A simple right-click still opens the menu. Takes effect on newly loaded pages.', toggle('gestures'))) +
    group(
      'Gestures',
      `<div id="g-list">${Object.entries(map)
        .map(([p, a]) => `<div class="s-item" data-g="${p}"><div class="grow"><span class="kbd" style="min-width:60px;text-align:center;font-size:14px">${arrows(p)}</span><select class="input" data-f="action">${opts.map(([v, l]) => `<option value="${v}" ${v === a ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></div><button class="btn ghost danger" data-del="${p}">${icon('trash')}</button></div>`)
        .join('')}</div><div class="row"><input class="input" id="g-new" placeholder="Directions, e.g. DR or LUR (L R U D)" style="width:280px"><button class="btn" id="g-add">${icon('plus')} Add gesture</button></div>`
    )
  )
}

// ---------- Privacy ----------
async function privacy() {
  const perms = await api.call('permissions.list')
  const stats = await api.call('adblock.stats')
  after.push(() => {
    for (const b of document.querySelectorAll('[data-allow-rm]')) b.onclick = () => set('adblockAllowlist', S.adblockAllowlist.filter((d) => d !== b.dataset.allowRm)).then(render)
    for (const b of document.querySelectorAll('[data-clear]'))
      b.onclick = async () => {
        const what = b.dataset.clear.split(',')
        if (!confirm('Clear ' + what.join(', ') + '? This cannot be undone.')) return
        await api.call('privacy.clearData', what)
        b.textContent = 'Cleared'
      }
    for (const b of document.querySelectorAll('[data-perm-rm]'))
      b.onclick = async () => {
        const [origin, perm] = b.dataset.permRm.split('|')
        delete perms[origin][perm]
        if (!Object.keys(perms[origin]).length) delete perms[origin]
        await api.call('permissions.set', perms)
        render()
      }
  })
  const permRows = Object.entries(perms).flatMap(([o, ps]) => Object.entries(ps).map(([p, v]) => `<span class="chip">${esc(o.replace(/^https?:\/\//, ''))} · ${esc(p)}: <b style="color:${v ? 'var(--success)' : 'var(--danger)'}">${v ? 'allowed' : 'blocked'}</b><button data-perm-rm="${esc(o)}|${esc(p)}" title="Forget">${icon('x')}</button></span>`))
  return (
    group(
      'Blocking',
      row('Block ads & trackers', `Uses EasyList, EasyPrivacy and more. ${stats.total} blocked this session.`, toggle('adblock')) +
        row('Allowed sites', 'Sites where blocking is off. Toggle from the shield in the toolbar.', `<div class="chip-list">${S.adblockAllowlist.map((d) => `<span class="chip">${esc(d)}<button data-allow-rm="${esc(d)}" title="Remove">${icon('x')}</button></span>`).join('') || '<span class="muted">None</span>'}</div>`)
    ) +
    group(
      'Connections & tracking',
      row('HTTPS-only mode', 'Upgrade insecure http:// navigations to https://.', toggle('httpsOnly')) + row('Send “Do Not Track” and Global Privacy Control', '', toggle('doNotTrack'))
    ) +
    group(
      'Site data',
      row('Clear everything when Kite closes', 'History, cookies, cache and open tabs.', toggle('clearOnExit')) +
        row('Clear browsing data', '', `<div class="btn-row"><button class="btn" data-clear="history">History</button><button class="btn" data-clear="cache">Cache</button><button class="btn" data-clear="cookies,storage">Cookies & site data</button><button class="btn danger" data-clear="history,cache,cookies,storage">All</button></div>`) +
        row('Site permissions', 'Camera, microphone, location, notifications…', `<div class="chip-list" style="max-width:420px;justify-content:flex-end">${permRows.join('') || '<span class="muted">No saved decisions</span>'}</div>`)
    )
  )
}

// ---------- Site styles ----------
function styles() {
  after.push(() => {
    const box = $('#us-list')
    box.addEventListener('change', (e) => {
      const i = +e.target.closest('[data-i]').dataset.i
      const list = structuredClone(S.userStyles)
      list[i][e.target.dataset.f] = e.target.value
      set('userStyles', list)
    })
    box.addEventListener('click', (e) => {
      const del = e.target.closest('[data-del]')
      if (del) set('userStyles', S.userStyles.filter((_, i) => i !== +del.dataset.del)).then(render)
    })
    $('#us-add').onclick = () => set('userStyles', [...S.userStyles, { match: 'example.com', css: 'body { }' }]).then(render)
  })
  return group(
    'Your styles',
    `<div class="hint">CSS is injected when matching pages load. Use a domain (matches subdomains too) or <b>*</b> for every site.</div><div id="us-list">${S.userStyles
      .map((u, i) => `<div class="row stack" data-i="${i}"><div style="display:flex;gap:8px"><input class="input" data-f="match" value="${esc(u.match)}" placeholder="example.com" style="flex:1"><button class="btn ghost danger" data-del="${i}">${icon('trash')}</button></div><textarea class="input code" data-f="css" spellcheck="false">${esc(u.css)}</textarea></div>`)
      .join('')}</div><div class="row"><button class="btn" id="us-add">${icon('plus')} Add site style</button></div>`
  )
}

// ---------- Extensions ----------
function extensions() {
  after.push(() => {
    $('#ext-open').onclick = () => api.call('actions.run', 'openExtensions')
    $('#ext-store').onclick = () => api.call('actions.run', 'openWebStore')
  })
  return group('', row('Manage extensions', 'Enable, disable, remove or load unpacked extensions.', `<button class="btn" id="ext-open">Open extensions</button>`) + row('Chrome Web Store', 'Install extensions straight from the store — click “Add to Chrome”.', `<button class="btn" id="ext-store">${icon('external')} Open store</button>`))
}

// ---------- Import ----------
const importOpts = { bookmarks: true, history: true, toBar: true, cookies: true, panelCookies: true }
async function importSection() {
  const sources = await api.call('import.sources')
  const say = (r) =>
    `Imported ${r.bookmarks} bookmark${r.bookmarks === 1 ? '' : 's'}, ${r.history} history entr${r.history === 1 ? 'y' : 'ies'}` +
    (r.cookies != null ? ` and ${r.cookies} cookie${r.cookies === 1 ? '' : 's'}` : '') +
    `${r.skipped ? ` (${r.skipped} bookmarks already saved)` : ''}.`
  after.push(() => {
    for (const c of document.querySelectorAll('[data-iopt]')) c.onchange = () => (importOpts[c.dataset.iopt] = c.checked)
    for (const b of document.querySelectorAll('[data-import]')) {
      b.onclick = async () => {
        const out = b.parentElement.querySelector('.imp-result')
        b.disabled = true
        b.textContent = 'Importing…'
        out.textContent = importOpts.cookies && !b.dataset.import.startsWith('firefox') ? 'If a KWallet prompt appears, allow it.' : ''
        out.style.color = ''
        try {
          const r = await api.call('import.run', b.dataset.import, importOpts)
          out.textContent = say(r)
          out.style.color = 'var(--success)'
          b.textContent = 'Import again'
        } catch (e) {
          out.textContent = String(e.message || e).replace(/^Error invoking remote method 'kite': (Error: )?/, '')
          out.style.color = 'var(--danger)'
          b.textContent = 'Try again'
        }
        b.disabled = false
      }
    }
    $('#imp-html').onclick = async () => {
      const out = $('#imp-html-result')
      try {
        const r = await api.call('import.html', importOpts)
        if (r) {
          out.textContent = say(r)
          out.style.color = 'var(--success)'
        }
      } catch (e) {
        out.textContent = String(e.message || e).replace(/^Error invoking remote method 'kite': (Error: )?/, '')
        out.style.color = 'var(--danger)'
      }
    }
    $('#exp-html').onclick = async () => {
      const file = await api.call('export.html')
      if (file) $('#exp-html-result').textContent = 'Saved to ' + file
    }
  })
  const rows = sources.length
    ? sources
        .map((s) =>
          row(
            `${esc(s.browser)} <span class="muted">· ${esc(s.profile)}</span>`,
            [s.bookmarks && 'Bookmarks', s.history && 'History', s.cookies && 'Cookies'].filter(Boolean).join(' · '),
            `<span class="imp-result" style="font-size:12px;max-width:260px;text-align:right"></span><button class="btn" data-import="${esc(s.id)}">${icon('download')} Import</button>`
          )
        )
        .join('')
    : '<div class="hint">No other browsers were found on this computer. You can still import a bookmarks file below.</div>'
  return (
    group(
      'What to import',
      row('Bookmarks', '', `<input type="checkbox" class="switch" data-iopt="bookmarks" ${importOpts.bookmarks ? 'checked' : ''}>`) +
        row('History', 'Up to 5,000 most recent pages.', `<input type="checkbox" class="switch" data-iopt="history" ${importOpts.history ? 'checked' : ''}>`) +
        row('Cookies', 'Keeps you signed in to the sites you use. Chrome, Brave and Edge may ask for KWallet access. Some sites (like Google) may still ask you to sign in again.', `<input type="checkbox" class="switch" data-iopt="cookies" ${importOpts.cookies ? 'checked' : ''}>`) +
        row('Sign in AI chat & web panels too', 'Copies the cookies into the side panels as well, so ChatGPT, Claude, etc. are signed in.', `<input type="checkbox" class="switch" data-iopt="panelCookies" ${importOpts.panelCookies ? 'checked' : ''}>`) +
        row('Put bookmarks-bar items on Kite’s bookmarks bar', 'Otherwise they go in an “Imported from …” folder.', `<input type="checkbox" class="switch" data-iopt="toBar" ${importOpts.toBar ? 'checked' : ''}>`)
    ) +
    group('Browsers on this computer', rows) +
    group(
      'Files',
      row('Import bookmarks file', 'An HTML file exported from any browser (Chrome, Firefox, Safari, Edge…).', `<span id="imp-html-result" style="font-size:12px;max-width:260px;text-align:right"></span><button class="btn" id="imp-html">Choose file…</button>`) +
        row('Export bookmarks', 'Save Kite’s bookmarks as an HTML file other browsers can import.', `<span id="exp-html-result" class="muted" style="font-size:12px;max-width:260px;text-align:right"></span><button class="btn" id="exp-html">Export…</button>`)
    ) +
    `<p class="hint" style="padding:0 4px">Saved passwords can’t be imported, because other browsers encrypt them. A password manager extension such as Bitwarden can carry them over.</p>`
  )
}

// ---------- Profiles ----------
async function profiles() {
  const p = await api.call('profiles.list')
  after.push(() => {
    for (const b of document.querySelectorAll('[data-prof]')) b.onclick = () => api.call('profiles.switch', b.dataset.prof)
    $('#prof-new').onclick = () => {
      const name = $('#prof-name').value.trim().replace(/[^\w-]/g, '')
      if (name) api.call('profiles.switch', name)
    }
  })
  return group(
    'Profiles',
    `<div class="hint">Each profile has its own settings, logins, history, extensions and panels. Switching restarts Kite.</div>` +
      p.all.map((name) => row(`${esc(name)}${name === p.current ? ' <span class="muted">(current)</span>' : ''}`, '', name === p.current ? '' : `<button class="btn" data-prof="${esc(name)}">Switch</button>`)).join('') +
      `<div class="row"><input class="input" id="prof-name" placeholder="New profile name (letters, numbers)" style="width:260px"><button class="btn" id="prof-new">${icon('plus')} Create & switch</button></div>`
  )
}

// ---------- About ----------
async function about() {
  const info = await api.call('app.info')
  after.push(() => {
    $('#ab-folder').onclick = () => api.call('app.openDataFolder')
    $('#ab-export').onclick = () => api.call('settings.export')
    $('#ab-import').onclick = () => api.call('settings.import').then(async () => {
      S = await api.call('settings.get')
      render()
    })
    $('#ab-reset').onclick = async () => {
      if (!confirm('Reset all settings to defaults? Your bookmarks, notes and history are kept.')) return
      await api.call('settings.reset')
      S = await api.call('settings.get')
      render()
    }
  })
  return (
    group(
      '',
      row('Kite', `Version ${info.version} · Chromium ${info.chrome} · Electron ${info.electron} · Node ${info.node}`, '') +
        row('Profile data folder', esc(info.profileDir), `<button class="btn" id="ab-folder">${icon('folder')} Open</button>`)
    ) +
    group('Backup', row('Settings file', 'Save or load all settings as JSON.', `<div class="btn-row"><button class="btn" id="ab-export">Export</button><button class="btn" id="ab-import">Import</button></div>`) + row('Reset settings', '', `<button class="btn danger" id="ab-reset">Reset to defaults</button>`))
  )
}

// Re-render when settings change elsewhere, unless the user is typing here.
onSettings((ns) => {
  S = ns
  const active = document.activeElement
  if (active && active.closest?.('main') && /INPUT|TEXTAREA|SELECT/.test(active.tagName)) return
  render()
})
window.addEventListener('hashchange', () => {
  current = location.hash.slice(1) || 'appearance'
  renderNav()
  render()
})

renderNav()
render()
