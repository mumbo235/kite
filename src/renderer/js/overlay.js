// Command palette, prompts and toasts.
import { S, api, $, h, esc, setOverlay } from './main.js'
import { icon, WORKSPACE_ICONS } from './icons.js'

let paletteOpen = false

export async function openPalette() {
  if (paletteOpen) return
  paletteOpen = true
  setOverlay(true)
  const [actions, openTabs] = [await api.call('actions.list'), S.tabs]
  const ov = $('#overlay')
  ov.innerHTML = ''
  const bd = h('<div class="backdrop"></div>')
  const pop = h(`<div class="popover" id="palette"><input placeholder="Type a command, tab or setting…" spellcheck="false"><div class="sugg-list"></div></div>`)
  ov.append(bd, pop)
  const input = pop.querySelector('input')
  const list = pop.querySelector('.sugg-list')
  let items = []
  let sel = 0

  const close = () => {
    if (!paletteOpen) return
    paletteOpen = false
    setOverlay(false)
    api.call('nav.focusPage')
  }

  const settingsItems = [
    ['Theme: light', { theme: 'light' }],
    ['Theme: dark', { theme: 'dark' }],
    ['Theme: follow system', { theme: 'system' }],
    ['Density: compact', { density: 'compact' }],
    ['Density: comfortable', { density: 'comfortable' }],
    ['Density: spacious', { density: 'spacious' }],
    ['Animations: on', { animations: true }],
    ['Animations: off', { animations: false }],
    ['Mouse gestures: on', { gestures: true }],
    ['Mouse gestures: off', { gestures: false }],
    ['Sidebar auto-hide: on', { sidebarAutoHide: true, sidebarCollapsed: true }],
    ['Sidebar auto-hide: off', { sidebarAutoHide: false, sidebarCollapsed: false }],
    ...Object.entries(S.settings.aiProviders).map(([id, p]) => [`AI provider: ${p.name}`, { aiProvider: id }]),
  ]
  for (const t of S.themes) if (!['light', 'dark'].includes(t.id)) settingsItems.push([`Theme: ${t.name}`, { theme: t.id }])

  const score = (text, q) => {
    text = text.toLowerCase()
    if (!q) return 1
    if (text.startsWith(q)) return 3
    if (text.includes(q)) return 2
    // fuzzy: all chars in order
    let i = 0
    for (const c of text) if (c === q[i]) i++
    return i === q.length ? 1 : 0
  }

  const draw = () => {
    const q = input.value.trim().toLowerCase()
    const all = [
      ...openTabs.map((t) => ({ kind: 'tab', label: t.title || t.url, sub: t.url, run: () => api.call('tabs.activate', t.id) })),
      ...actions.map((a) => ({ kind: 'action', label: a.label, sub: '', kbd: a.shortcut, run: () => api.call('actions.run', a.id) })),
      ...settingsItems.map(([label, patch]) => ({ kind: 'setting', label, run: () => api.call('settings.set', patch) })),
    ]
    items = all
      .map((it) => ({ ...it, s: Math.max(score(it.label, q), it.sub ? score(it.sub, q) * 0.8 : 0) }))
      .filter((it) => it.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 50)
    if (q) items.push({ kind: 'search', label: `Search or go to “${input.value.trim()}”`, run: () => api.call('nav.go', input.value.trim(), { newTab: true }) })
    sel = Math.min(sel, items.length - 1)
    const ic = { tab: 'layers', action: 'zap', setting: 'sliders', search: 'search' }
    list.innerHTML = items
      .map(
        (it, i) =>
          `<div class="sugg ${i === sel ? 'sel' : ''}" data-i="${i}"><span class="ic">${icon(ic[it.kind])}</span><span class="t">${esc(it.label)}</span><span class="u">${it.sub ? esc(it.sub) : ''}</span>${
            it.kbd ? `<span class="kbd">${esc(it.kbd)}</span>` : `<span class="tag">${it.kind === 'tab' ? 'Tab' : it.kind === 'setting' ? 'Setting' : ''}</span>`
          }</div>`
      )
      .join('')
    list.querySelector('.sel')?.scrollIntoView({ block: 'nearest' })
  }

  input.addEventListener('input', () => {
    sel = 0
    draw()
  })
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || (e.key === 'Tab' && !e.shiftKey)) {
      e.preventDefault()
      sel = (sel + 1) % items.length
      draw()
    } else if (e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey)) {
      e.preventDefault()
      sel = (sel - 1 + items.length) % items.length
      draw()
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const it = items[sel]
      close()
      it?.run()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      close()
    }
  })
  list.addEventListener('mousedown', (e) => {
    const row = e.target.closest('.sugg')
    if (!row) return
    e.preventDefault()
    const it = items[+row.dataset.i]
    close()
    it?.run()
  })
  bd.addEventListener('mousedown', close)
  draw()
  input.focus()
}

// Small form dialog. Resolves with field values, `extra.value`, or null.
export function prompt({ title, fields, ok = 'OK', extra }) {
  return new Promise((resolve) => {
    setOverlay(true)
    const ov = $('#overlay')
    ov.innerHTML = ''
    const bd = h('<div class="backdrop"></div>')
    const pop = h(`<form class="popover dialog"><h3>${esc(title)}</h3>
      ${fields
        .map((f) =>
          f.type === 'icons'
            ? `<label>${esc(f.label)}<input type="hidden" name="${f.name}" value="${esc(f.value || '')}"><div class="icon-pick">${WORKSPACE_ICONS.map((n) => `<button type="button" class="icon-btn ${n === f.value ? 'on' : ''}" data-pick="${n}" title="${n}">${icon(n)}</button>`).join('')}</div></label>`
            : `<label>${esc(f.label)}<input class="input" name="${f.name}" type="${f.type || 'text'}" value="${esc(f.value || '')}" placeholder="${esc(f.placeholder || '')}" spellcheck="false" ${f.type === 'color' ? 'style="padding:2px;height:34px"' : ''}></label>`
        )
        .join('')}
      <div class="row">${extra ? `<button type="button" class="btn ${extra.danger ? 'danger' : ''}" data-extra>${esc(extra.label)}</button><div class="spacer"></div>` : ''}
      <button type="button" class="btn" data-cancel>Cancel</button><button class="btn primary" type="submit">${esc(ok)}</button></div></form>`)
    ov.append(bd, pop)
    const done = (v) => {
      setOverlay(false)
      resolve(v)
    }
    pop.addEventListener('submit', (e) => {
      e.preventDefault()
      done(Object.fromEntries(new FormData(pop)))
    })
    pop.querySelector('[data-cancel]').onclick = () => done(null)
    pop.querySelector('[data-extra]')?.addEventListener('click', () => done(extra.value))
    pop.addEventListener('keydown', (e) => e.key === 'Escape' && done(null))
    pop.addEventListener('click', (e) => {
      const b = e.target.closest('[data-pick]')
      if (!b) return
      const box = b.parentElement
      box.querySelectorAll('.on').forEach((x) => x.classList.remove('on'))
      b.classList.add('on')
      box.previousElementSibling.value = b.dataset.pick
    })
    bd.onclick = () => done(null)
    pop.querySelector('input:not([type=hidden])')?.focus()
    pop.querySelector('input:not([type=hidden])')?.select()
  })
}

export function toast(text, action) {
  const box = $('#toasts')
  const el = h(`<div class="toast"><span>${esc(text)}</span>${action ? `<button>${esc(action.label)}</button>` : ''}</div>`)
  if (action) el.querySelector('button').onclick = () => api.call(...action.call)
  box.appendChild(el)
  while (box.children.length > 3) box.firstElementChild.remove()
  setTimeout(() => {
    el.classList.add('out')
    setTimeout(() => el.remove(), 300)
  }, 3200)
}
