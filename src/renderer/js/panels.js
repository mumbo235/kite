// Side panel: AI chat + web panels (native views) and HTML tool panels.
import { S, api, $, h, esc, setSettings, animatedChange, reportLayout } from './main.js'
import { icon } from './icons.js'
import { renderSidebar, TOOLS } from './sidebar.js'
import { fixBrokenFavicons } from './tabs.js'

const isWeb = (id) => id === 'ai' || id?.startsWith('web:')

export function openTool(id) {
  const apply = () => {
    S.tool = id
    if (id === 'ai') api.call('panel.open', 'ai:' + S.settings.aiProvider)
    else if (id.startsWith('web:')) api.call('panel.open', id)
    else api.call('panel.close')
    renderPanel(true)
    renderSidebar()
  }
  // only animate when the panel actually opens (not when switching tools)
  S.tool ? apply() : animatedChange(apply)
}

export function closeTool() {
  if (!S.tool) return
  animatedChange(() => {
    S.tool = null
    api.call('panel.close')
    renderPanel()
    renderSidebar()
  }).then(() => api.call('nav.focusPage'))
}

// Live stats only stream from the main process while the panel is open.
let perfWatching = false
function syncPerfWatch() {
  const want = S.tool === 'performance'
  if (want === perfWatching) return
  perfWatching = want
  api.call('perf.watch', want)
}
window.kite.on('perf', (p) => {
  if (S.tool === 'performance') updatePerf(p)
})

export function renderPanel(fresh) {
  syncPerfWatch()
  const panel = $('#panel')
  const wasOpen = panel.classList.contains('open')
  panel.classList.toggle('open', !!S.tool)
  if (!S.tool) return
  const head = $('#panel-head')
  const body = $('#panel-body')
  body.classList.toggle('hidden', isWeb(S.tool))
  if (S.tool === 'ai') {
    const providers = S.settings.aiProviders
    head.innerHTML = `<div class="seg">${Object.entries(providers)
      .map(([id, p]) => `<button data-p="${id}" class="${id === S.settings.aiProvider ? 'on' : ''}">${esc(p.name)}</button>`)
      .join('')}</div><div class="spacer"></div>
      <button class="icon-btn sm" data-a="home" title="New chat">${icon('plus')}</button>
      <button class="icon-btn sm" data-a="reload" title="Reload">${icon('reload')}</button>
      <button class="icon-btn sm" data-a="tab" title="Open in tab">${icon('external')}</button>
      <button class="icon-btn sm" data-a="close" title="Close">${icon('x')}</button>`
    head.onclick = (e) => {
      const p = e.target.closest('[data-p]')
      if (p) {
        setSettings({ aiProvider: p.dataset.p })
        api.call('panel.open', 'ai:' + p.dataset.p)
        return
      }
      panelAction(e)
    }
    reportLayout()
    return
  }
  if (S.tool.startsWith('web:')) {
    const p = S.settings.webPanels.find((x) => 'web:' + x.id === S.tool)
    if (!p) return closeTool()
    head.innerHTML = `<h2>${esc(p.title)}</h2>
      <button class="icon-btn sm" data-a="back" title="Back">${icon('back')}</button>
      <button class="icon-btn sm" data-a="home" title="Home">${icon('home')}</button>
      <button class="icon-btn sm" data-a="reload" title="Reload">${icon('reload')}</button>
      <button class="icon-btn sm" data-a="tab" title="Open in tab">${icon('external')}</button>
      <button class="icon-btn sm" data-a="close" title="Close">${icon('x')}</button>`
    head.onclick = panelAction
    reportLayout()
    return
  }
  const tool = TOOLS[S.tool]
  head.innerHTML = `<h2>${tool.title}</h2><button class="icon-btn sm" data-a="close" title="Close">${icon('x')}</button>`
  head.onclick = panelAction
  RENDER[S.tool]?.(body, fresh)
  reportLayout()
}

function panelAction(e) {
  const a = e.target.closest('[data-a]')?.dataset.a
  if (!a) return
  if (a === 'close') closeTool()
  else if (a === 'reload') api.call('panel.reload')
  else if (a === 'home') api.call('panel.home')
  else if (a === 'back') api.call('panel.back')
  else if (a === 'tab') api.call('panel.openInTab')
}

const fav = (url) => {
  try {
    return url ? 'kite://favicon/?u=' + encodeURIComponent(url) : ''
  } catch {
    return ''
  }
}

function dayLabel(ts) {
  const d = new Date(ts)
  const today = new Date()
  const y = new Date(Date.now() - 86400000)
  if (d.toDateString() === today.toDateString()) return 'Today'
  if (d.toDateString() === y.toDateString()) return 'Yesterday'
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })
}

// ---------- performance ----------
const RAM_STEPS = [512, 768, 1024, 1536, 2048, 3072, 4096, 6144, 8192, 12288, 16384, 24576, 32768]
const SLEEP_STEPS = [0, 5, 10, 15, 30, 60, 120]
const PRESETS = {
  saver: { name: 'Saver', ram: 2048, cpu: 40, sleep: 15 },
  balanced: { name: 'Balanced', ram: 4096, cpu: 75, sleep: 60 },
  max: { name: 'Max', ram: 0, cpu: 100, sleep: 0 },
}
const fmtMB = (mb) => (mb >= 1024 ? (mb / 1024).toFixed(mb >= 10240 ? 0 : 1) + ' GB' : Math.round(mb) + ' MB')
let perfSteps = RAM_STEPS
let perfData = null

function spark(values, max) {
  if (!values.length) return ''
  const w = 200
  const hgt = 40
  const m = Math.max(max || 0, ...values, 1)
  const pts = values.map((v, i) => `${((i / Math.max(values.length - 1, 1)) * w).toFixed(1)},${(hgt - (v / m) * (hgt - 4) - 2).toFixed(1)}`)
  return `<svg viewBox="0 0 ${w} ${hgt}" preserveAspectRatio="none"><polygon class="area" points="0,${hgt} ${pts.join(' ')} ${w},${hgt}"/><polyline points="${pts.join(' ')}"/></svg>`
}

function perfLabels(cfg) {
  $('#pf-ram-v').textContent = cfg.ramLimitMB ? fmtMB(cfg.ramLimitMB) : 'No limit'
  $('#pf-cpu-v').textContent = cfg.cpuLimit >= 100 ? 'No limit' : cfg.cpuLimit + '%'
  $('#pf-sleep-v').textContent = cfg.sleepAfterMin ? (cfg.sleepAfterMin >= 60 ? cfg.sleepAfterMin / 60 + ' h' : cfg.sleepAfterMin + ' min') : 'Never'
  const preset = Object.entries(PRESETS).find(([, p]) => p.ram === cfg.ramLimitMB && p.cpu === cfg.cpuLimit && p.sleep === cfg.sleepAfterMin)?.[0]
  for (const b of document.querySelectorAll('#pf-presets button')) b.classList.toggle('on', b.dataset.p === preset)
}

function perfCfg() {
  return { ramLimitMB: 0, cpuLimit: 100, sleepAfterMin: 0, ...(S.settings.perf || {}) }
}

function setPerf(patch) {
  const cfg = { ...perfCfg(), ...patch }
  perfLabels(cfg)
  return setSettings({ perf: cfg })
}

function updatePerf(p) {
  perfData = p
  const body = $('#panel-body')
  if (!body.querySelector('.perf')) return
  $('#pf-cpu').textContent = p.cpu.toFixed(p.cpu < 10 ? 1 : 0)
  $('#pf-mem').textContent = fmtMB(p.mem)
  $('#pf-mem-sub').textContent = `of ${fmtMB(p.totalMem)} · ${p.cores} cores`
  $('#pf-cpu-graph').innerHTML = spark(p.cpuHist, 100)
  $('#pf-mem-graph').innerHTML = spark(p.memHist, p.cfg.ramLimitMB || 0)
  $('#pf-cpu-card').classList.toggle('over', p.cfg.cpuLimit < 100 && p.cpu > p.cfg.cpuLimit)
  $('#pf-mem-card').classList.toggle('over', p.cfg.ramLimitMB > 0 && p.mem > p.cfg.ramLimitMB)
  $('#pf-action').textContent = p.lastAction || ''
  const stateIcon = { active: 'play', awake: 'zap', frozen: 'snow', sleeping: 'moon' }
  const rows = p.tabs
    .map((t) => {
      const act = t.state === 'sleeping' || t.state === 'frozen' ? `<button class="icon-btn sm" data-wake="${t.id}" title="Wake up">${icon('play')}</button>` : t.state === 'awake' ? `<button class="icon-btn sm" data-freeze="${t.id}" title="Freeze (pause, keep state)">${icon('snow')}</button><button class="icon-btn sm" data-sleep="${t.id}" title="Sleep (free memory)">${icon('moon')}</button>` : ''
      return `<div class="pf-row ${t.state}"><span class="pf-st" title="${t.state}">${icon(stateIcon[t.state])}</span><span class="pf-t">${esc(t.title)}</span><span class="pf-n">${t.state === 'sleeping' ? '—' : fmtMB(t.mem)}</span><span class="pf-n">${t.state === 'sleeping' ? '' : t.cpu.toFixed(1) + '%'}</span><span class="pf-a">${act}</span></div>`
    })
    .join('')
  const panels = p.panels.map((x) => `<div class="pf-row"><span class="pf-st">${icon(x.key.startsWith('ai:') ? 'sparkles' : 'panel')}</span><span class="pf-t">${esc(x.key.startsWith('ai:') ? 'AI chat · ' + (S.settings.aiProviders[x.key.slice(3)]?.name || '') : 'Web panel')}</span><span class="pf-n">${fmtMB(x.mem)}</span><span class="pf-n">${x.cpu.toFixed(1)}%</span><span class="pf-a"><button class="icon-btn sm" data-close-panel="${esc(x.key)}" title="Close (free memory)">${icon('x')}</button></span></div>`).join('')
  const html = rows + panels + `<div class="pf-row"><span class="pf-st">${icon('kite')}</span><span class="pf-t">Kite (browser, GPU, extensions)</span><span class="pf-n">${fmtMB(p.browser.mem)}</span><span class="pf-n">${p.browser.cpu.toFixed(1)}%</span><span class="pf-a"></span></div>`
  const list = $('#pf-list')
  if (list._html !== html) {
    list._html = html
    list.innerHTML = html
  }
}

const RENDER = {
  performance(body) {
    const cfg = perfCfg()
    const total = perfData?.totalMem || 16384
    perfSteps = RAM_STEPS.filter((m) => m <= total)
    const ramIdx = cfg.ramLimitMB ? Math.max(0, perfSteps.findIndex((m) => m >= cfg.ramLimitMB)) : perfSteps.length
    const sleepIdx = Math.max(0, SLEEP_STEPS.indexOf(cfg.sleepAfterMin))
    body.innerHTML = `<div class="perf">
      <div class="pf-cards">
        <div class="pf-card" id="pf-cpu-card"><div class="pf-lbl">CPU</div><div class="pf-big"><span id="pf-cpu">0</span><small>%</small></div><div class="pf-sub">of all cores</div><div class="pf-graph" id="pf-cpu-graph"></div></div>
        <div class="pf-card" id="pf-mem-card"><div class="pf-lbl">RAM</div><div class="pf-big" id="pf-mem">0 MB</div><div class="pf-sub" id="pf-mem-sub"></div><div class="pf-graph" id="pf-mem-graph"></div></div>
      </div>
      <div class="seg pf-presets" id="pf-presets">${Object.entries(PRESETS).map(([id, p]) => `<button data-p="${id}">${p.name}</button>`).join('')}</div>
      <div class="pf-slider"><div class="pf-sl-head"><span>RAM limit</span><b id="pf-ram-v"></b></div><input type="range" id="pf-ram" min="0" max="${perfSteps.length}" step="1" value="${ramIdx}"><div class="pf-hint">Over the limit, the tabs you used least recently go to sleep. They reload when you open them.</div></div>
      <div class="pf-slider"><div class="pf-sl-head"><span>CPU limit</span><b id="pf-cpu-v"></b></div><input type="range" id="pf-cpu-r" min="10" max="100" step="5" value="${cfg.cpuLimit}"><div class="pf-hint">Over the limit, the busiest background tab is frozen (paused, nothing lost) until you switch back to it.</div></div>
      <div class="pf-slider"><div class="pf-sl-head"><span>Sleep inactive tabs after</span><b id="pf-sleep-v"></b></div><input type="range" id="pf-sleep" min="0" max="${SLEEP_STEPS.length - 1}" step="1" value="${sleepIdx}"></div>
      <div class="pf-action" id="pf-action"></div>
      <div class="p-group">Usage</div>
      <div class="pf-list" id="pf-list"></div>
    </div>`
    perfLabels(cfg)
    const ramVal = (i) => (+i >= perfSteps.length ? 0 : perfSteps[+i])
    $('#pf-ram').oninput = (e) => perfLabels({ ...perfCfg(), ramLimitMB: ramVal(e.target.value) })
    $('#pf-ram').onchange = (e) => setPerf({ ramLimitMB: ramVal(e.target.value) })
    $('#pf-cpu-r').oninput = (e) => perfLabels({ ...perfCfg(), cpuLimit: +e.target.value })
    $('#pf-cpu-r').onchange = (e) => setPerf({ cpuLimit: +e.target.value })
    $('#pf-sleep').oninput = (e) => perfLabels({ ...perfCfg(), sleepAfterMin: SLEEP_STEPS[+e.target.value] })
    $('#pf-sleep').onchange = (e) => setPerf({ sleepAfterMin: SLEEP_STEPS[+e.target.value] })
    $('#pf-presets').onclick = (e) => {
      const b = e.target.closest('[data-p]')
      if (!b) return
      const p = PRESETS[b.dataset.p]
      setPerf({ ramLimitMB: p.ram, cpuLimit: p.cpu, sleepAfterMin: p.sleep }).then(() => RENDER.performance(body))
    }
    $('#pf-list').onclick = (e) => {
      const t = e.target.closest('button')
      if (!t) return
      if (t.dataset.wake) api.call('perf.wake', +t.dataset.wake)
      else if (t.dataset.sleep) api.call('perf.sleep', +t.dataset.sleep)
      else if (t.dataset.freeze) api.call('perf.freeze', +t.dataset.freeze)
      else if (t.dataset.closePanel) api.call('panel.remove', t.dataset.closePanel)
    }
    if (perfData) updatePerf(perfData)
    else api.call('perf.watch', false).then(() => api.call('perf.watch', true)).then(updatePerf)
  },

  // ---------- bookmarks ----------
  async bookmarks(body, fresh) {
    if (fresh || !body.querySelector('.p-search')) {
      body.innerHTML = `<div class="p-search"><input class="input" placeholder="Search bookmarks" spellcheck="false"><button class="btn" data-add title="Bookmark current page">${icon('plus')} Add</button></div><div class="list"></div>`
      body.querySelector('input').oninput = () => RENDER.bookmarks(body)
      body.querySelector('[data-add]').onclick = () => api.call('actions.run', 'bookmarkPage')
    }
    const q = body.querySelector('input').value.toLowerCase()
    const list = S.bookmarks.filter((b) => !q || b.title.toLowerCase().includes(q) || b.url.toLowerCase().includes(q))
    const folders = [...new Set(list.map((b) => b.folder || 'Other'))]
    const el = body.querySelector('.list')
    el.innerHTML = list.length
      ? folders
          .map(
            (f) =>
              `<div class="p-group">${esc(f)}</div>` +
              list
                .filter((b) => (b.folder || 'Other') === f)
                .map(
                  (b) => `<div class="p-item" data-url="${esc(b.url)}"><img src="${esc(fav(b.url))}" alt=""><div class="grow"><div class="t">${esc(b.title)}</div><div class="s">${esc(b.url)}</div></div>
                  <div class="acts"><button class="icon-btn sm" data-edit="${b.id}" title="Edit">${icon('edit')}</button><button class="icon-btn sm" data-del="${b.id}" title="Delete">${icon('trash')}</button></div></div>`
                )
                .join('')
          )
          .join('')
      : `<div class="p-empty">${icon('star')}<p>No bookmarks yet.<br>Press <span class="kbd">${esc(S.settings.shortcuts.bookmarkPage)}</span> on any page.</p></div>`
    fixBrokenFavicons(el)
    el.onclick = async (e) => {
      const del = e.target.closest('[data-del]')
      const edit = e.target.closest('[data-edit]')
      if (del) {
        S.bookmarks = S.bookmarks.filter((b) => b.id !== del.dataset.del)
        api.call('data.set', 'bookmarks', S.bookmarks)
        return RENDER.bookmarks(body)
      }
      if (edit) {
        const { prompt } = await import('./overlay.js')
        const b = S.bookmarks.find((x) => x.id === edit.dataset.edit)
        const r = await prompt({
          title: 'Edit bookmark',
          fields: [
            { name: 'title', label: 'Name', value: b.title },
            { name: 'url', label: 'URL', value: b.url },
            { name: 'folder', label: 'Folder', value: b.folder || 'Other' },
          ],
          ok: 'Save',
        })
        if (r) {
          Object.assign(b, r)
          api.call('data.set', 'bookmarks', S.bookmarks)
          RENDER.bookmarks(body)
        }
        return
      }
      const row = e.target.closest('[data-url]')
      if (row) api.call('nav.go', row.dataset.url, { newTab: e.ctrlKey || e.metaKey })
    }
    el.onauxclick = (e) => {
      const row = e.target.closest('[data-url]')
      if (row && e.button === 1) api.call('tabs.new', row.dataset.url, { active: false })
    }
  },

  // ---------- history ----------
  async history(body, fresh) {
    if (fresh || !body.querySelector('.p-search')) {
      body.innerHTML = `<div class="p-search"><input class="input" placeholder="Search history" spellcheck="false"><button class="btn" data-full title="Open full history">${icon('external')}</button></div><div class="list"></div>`
      let t
      body.querySelector('input').oninput = () => {
        clearTimeout(t)
        t = setTimeout(() => RENDER.history(body), 120)
      }
      body.querySelector('[data-full]').onclick = () => api.call('actions.run', 'openHistory')
    }
    const q = body.querySelector('input').value
    const items = await api.call('history.search', q, 300)
    const el = body.querySelector('.list')
    let last = ''
    el.innerHTML = items.length
      ? items
          .map((it) => {
            const d = dayLabel(it.time)
            const head = d !== last ? `<div class="p-group">${esc(d)}</div>` : ''
            last = d
            const time = new Date(it.time).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
            return `${head}<div class="p-item" data-url="${esc(it.url)}"><img src="${esc(fav(it.url))}" alt=""><div class="grow"><div class="t">${esc(it.title || it.url)}</div><div class="s">${time} · ${esc(it.url)}</div></div><div class="acts"><button class="icon-btn sm" data-del="${esc(it.url)}" title="Remove">${icon('x')}</button></div></div>`
          })
          .join('')
      : `<div class="p-empty">${q ? 'No matches.' : 'Nothing here yet.'}</div>`
    fixBrokenFavicons(el)
    el.onclick = (e) => {
      const del = e.target.closest('[data-del]')
      if (del) {
        api.call('history.remove', del.dataset.del).then(() => RENDER.history(body))
        return
      }
      const row = e.target.closest('[data-url]')
      if (row) api.call('nav.go', row.dataset.url, { newTab: e.ctrlKey || e.metaKey })
    }
  },

  // ---------- downloads ----------
  downloads(body) {
    const fmt = (n) => (n > 1e9 ? (n / 1e9).toFixed(1) + ' GB' : n > 1e6 ? (n / 1e6).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1e3)) + ' KB')
    const rows = S.downloads
      .map((d) => {
        const pct = d.total ? Math.round((d.received / d.total) * 100) : 0
        const status = d.state === 'progressing' ? `${fmt(d.received)}${d.total ? ' of ' + fmt(d.total) : ''}` : d.state === 'paused' ? 'Paused' : d.state === 'completed' ? fmt(d.received) : d.state === 'cancelled' ? 'Cancelled' : 'Failed'
        const live = d.state === 'progressing' || d.state === 'paused'
        return `<div class="p-item" data-id="${d.id}">${icon('download')}<div class="grow"><div class="t">${esc(d.name)}</div><div class="s">${status}</div>${live ? `<div class="progress"><div style="width:${pct}%"></div></div>` : ''}</div>
        <div class="acts" style="opacity:1">${
          live
            ? `<button class="icon-btn sm" data-a="pause" title="Pause / resume">${icon(d.state === 'paused' ? 'play' : 'pause')}</button><button class="icon-btn sm" data-a="cancel" title="Cancel">${icon('x')}</button>`
            : d.state === 'completed'
              ? `<button class="icon-btn sm" data-a="show" title="Show in folder">${icon('folder')}</button>`
              : ''
        }</div></div>`
      })
      .join('')
    body.innerHTML = `<div class="p-search"><button class="btn" data-folder>${icon('folder')} Open folder</button><div class="spacer"></div><button class="btn ghost" data-clear>Clear</button></div>${rows || '<div class="p-empty">No downloads yet.</div>'}`
    body.onclick = (e) => {
      if (e.target.closest('[data-folder]')) return api.call('downloads.folder')
      if (e.target.closest('[data-clear]')) return api.call('downloads.clear')
      const row = e.target.closest('[data-id]')
      if (!row) return
      const id = +row.dataset.id
      const a = e.target.closest('[data-a]')?.dataset.a
      if (a) api.call('downloads.' + a, id)
      else if (S.downloads.find((d) => d.id === id)?.state === 'completed') api.call('downloads.open', id)
    }
  },

  // ---------- notes ----------
  async notes(body) {
    let notes = await api.call('data.get', 'notes')
    if (!notes.length) notes = [{ id: 'n' + Date.now(), title: 'Note', body: '', updated: Date.now() }]
    let cur = notes.find((n) => n.id === RENDER._note) || notes[0]
    RENDER._note = cur.id
    body.innerHTML = `<div class="notes-wrap">
      <div class="notes-tabs">${notes.map((n) => `<button class="note-chip ${n.id === cur.id ? 'on' : ''}" data-n="${n.id}">${esc(n.title || 'Untitled')}</button>`).join('')}<button class="note-chip" data-new title="New note">+</button></div>
      <input class="note-title" placeholder="Title" value="${esc(cur.title)}">
      <textarea class="note-body" placeholder="Start typing… notes are saved automatically.">${esc(cur.body)}</textarea>
      <div class="note-foot"><span class="saved"></span><div class="spacer"></div>
        <button class="icon-btn sm" data-copy title="Copy note">${icon('copy')}</button>
        <button class="icon-btn sm" data-del title="Delete note">${icon('trash')}</button></div></div>`
    let t
    const save = () => {
      clearTimeout(t)
      t = setTimeout(() => {
        cur.title = body.querySelector('.note-title').value
        cur.body = body.querySelector('.note-body').value
        cur.updated = Date.now()
        api.call('data.set', 'notes', notes)
        body.querySelector('.saved').textContent = 'Saved'
        const chip = body.querySelector(`[data-n="${cur.id}"]`)
        if (chip) chip.textContent = cur.title || 'Untitled'
      }, 400)
    }
    body.querySelector('.note-title').oninput = save
    body.querySelector('.note-body').oninput = save
    body.querySelector('.saved').textContent = cur.updated ? 'Edited ' + new Date(cur.updated).toLocaleString() : ''
    body.querySelector('.notes-tabs').onclick = (e) => {
      const b = e.target.closest('button')
      if (!b) return
      if (b.hasAttribute('data-new')) {
        const n = { id: 'n' + Date.now(), title: '', body: '', updated: Date.now() }
        notes.push(n)
        RENDER._note = n.id
        api.call('data.set', 'notes', notes).then(() => RENDER.notes(body).then(() => body.querySelector('.note-title').focus()))
      } else {
        RENDER._note = b.dataset.n
        RENDER.notes(body)
      }
    }
    body.querySelector('[data-copy]').onclick = () => navigator.clipboard.writeText(body.querySelector('.note-body').value)
    body.querySelector('[data-del]').onclick = () => {
      if (!confirm('Delete this note?')) return
      notes = notes.filter((n) => n.id !== cur.id)
      RENDER._note = null
      api.call('data.set', 'notes', notes).then(() => RENDER.notes(body))
    }
  },

  // ---------- to-do ----------
  async todo(body, fresh) {
    let todos = await api.call('data.get', 'todos')
    RENDER._filter = RENDER._filter || 'all'
    const f = RENDER._filter
    const shown = todos.filter((t) => (f === 'all' ? true : f === 'active' ? !t.done : t.done))
    const left = todos.filter((t) => !t.done).length
    const keepInput = body.querySelector('.todo-add input')?.value || ''
    body.innerHTML = `<form class="todo-add"><input class="input" placeholder="Add a task and press Enter" value="${esc(keepInput)}"><button class="btn primary">${icon('plus')}</button></form>
      <div class="filters">${['all', 'active', 'done'].map((x) => `<button class="note-chip ${f === x ? 'on' : ''}" data-f="${x}">${x[0].toUpperCase() + x.slice(1)}</button>`).join('')}
      <div class="spacer"></div><span class="muted" style="font-size:12px;align-self:center">${left} left</span></div>
      <div class="list">${shown.map((t) => `<div class="todo ${t.done ? 'done' : ''}" data-id="${t.id}"><input type="checkbox" class="check" ${t.done ? 'checked' : ''}><span class="txt">${esc(t.text)}</span><div class="acts"><button class="icon-btn sm" data-del title="Delete">${icon('x')}</button></div></div>`).join('') || '<div class="p-empty">All clear</div>'}</div>
      ${todos.some((t) => t.done) ? '<div class="p-section"><button class="btn ghost" data-clear>Clear completed</button></div>' : ''}`
    const save = () => api.call('data.set', 'todos', todos).then(() => RENDER.todo(body))
    const input = body.querySelector('.todo-add input')
    if (fresh || keepInput) input.focus()
    body.querySelector('.todo-add').onsubmit = (e) => {
      e.preventDefault()
      const text = input.value.trim()
      if (!text) return
      input.value = ''
      todos = [{ id: 't' + Date.now(), text, done: false, created: Date.now() }, ...todos]
      save().then(() => body.querySelector('.todo-add input').focus())
    }
    body.querySelector('.filters').onclick = (e) => {
      const b = e.target.closest('[data-f]')
      if (b) {
        RENDER._filter = b.dataset.f
        RENDER.todo(body)
      }
    }
    body.querySelector('.list').onclick = (e) => {
      const row = e.target.closest('[data-id]')
      if (!row) return
      const t = todos.find((x) => x.id === row.dataset.id)
      if (e.target.closest('[data-del]')) todos = todos.filter((x) => x !== t)
      else if (e.target.classList.contains('check')) t.done = e.target.checked
      else return
      save()
    }
    body.querySelector('.list').ondblclick = async (e) => {
      const row = e.target.closest('[data-id]')
      if (!row) return
      const t = todos.find((x) => x.id === row.dataset.id)
      const { prompt } = await import('./overlay.js')
      const r = await prompt({ title: 'Edit task', fields: [{ name: 'text', label: 'Task', value: t.text }], ok: 'Save' })
      if (r?.text) {
        t.text = r.text
        save()
      }
    }
    body.querySelector('[data-clear]')?.addEventListener('click', () => {
      todos = todos.filter((t) => !t.done)
      save()
    })
  },
}
