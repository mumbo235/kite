// Bookmarks bar under the toolbar: shows the "Bookmarks bar" folder.
import { S, api, $, h, esc, activeTab } from './main.js'
import { icon } from './icons.js'
import { fixBrokenFavicons } from './tabs.js'
import { cssVars } from './toolbar.js'
import { toast } from './overlay.js'

const favOf = (url) => {
  try {
    return url ? 'kite://favicon/?u=' + encodeURIComponent(url) : ''
  } catch {
    return ''
  }
}

const BAR = 'Bookmarks bar'
export function barItems() {
  return S.bookmarks.filter((b) => (b.folder || '') === BAR)
}

// Entries shown on the bar, in order: bookmarks directly on the bar plus one
// chip per sub-folder ("Bookmarks bar/Work/..." -> "Work").
function barEntries() {
  const out = []
  const seen = new Set()
  for (const b of S.bookmarks) {
    const f = b.folder || ''
    if (f === BAR) out.push({ kind: 'bm', b })
    else if (f.startsWith(BAR + '/')) {
      const name = f.split('/')[1]
      if (!seen.has(name)) {
        seen.add(name)
        out.push({ kind: 'folder', name })
      }
    }
  }
  return out
}

// Nested menu tree of bookmarks under a folder prefix.
export function treeOf(list, prefix) {
  const root = []
  const folders = new Map()
  const folderNode = (parts) => {
    let level = root
    let key = ''
    for (const p of parts) {
      key += '/' + p
      let node = folders.get(key)
      if (!node) {
        node = { folder: p, children: [] }
        folders.set(key, node)
        level.push(node)
      }
      level = node.children
    }
    return level
  }
  for (const b of list) {
    const f = b.folder || 'Other'
    const rest = prefix ? f.slice(prefix.length).replace(/^\//, '') : f
    folderNode(rest ? rest.split('/') : []).push({ title: b.title, url: b.url })
  }
  return root
}

export function renderBookmarksBar() {
  const bar = $('#bookmarks-bar')
  if (!S.settings) return
  if (!bar._ro) {
    let t
    bar._ro = new ResizeObserver(() => {
      clearTimeout(t)
      t = setTimeout(() => updateOverflow(bar), 150)
    })
    bar._ro.observe(bar)
  }
  const show = S.settings.showBookmarksBar
  bar.classList.toggle('hidden', !show)
  if (!show) return
  const items = barEntries()
  const others = S.bookmarks.filter((b) => !(b.folder || '').startsWith(BAR)).length
  const html =
    `<div class="bm-list">${
      items.length
        ? items
            .map((e) =>
              e.kind === 'folder'
                ? `<button class="bm-chip bm-folder" data-folder="${esc(e.name)}" title="${esc(e.name)}">${icon('folder')}<span>${esc(e.name)}</span></button>`
                : `<button class="bm-chip" data-id="${esc(e.b.id)}" data-url="${esc(e.b.url)}" draggable="true" title="${esc(e.b.title)}\n${esc(e.b.url)}"><img src="${esc(favOf(e.b.url))}" alt=""><span>${esc(e.b.title)}</span></button>`
            )
            .join('')
        : `<span class="bm-empty">Press the bookmark button or ${esc(S.settings.shortcuts.bookmarkPage || 'Ctrl+D')} to add pages here.</span>`
    }</div>` +
    `<button class="icon-btn sm bm-more hidden" title="More bookmarks">${icon('chevronDown')}</button>` +
    (others > 0 ? `<button class="bm-chip bm-others" title="Other bookmarks">${icon('folder')}<span>Other</span></button>` : '')
  if (bar._html !== html) {
    bar._html = html
    bar.innerHTML = html
    fixBrokenFavicons(bar)
    wire(bar)
  }
  requestAnimationFrame(() => updateOverflow(bar))
}

function updateOverflow(bar) {
  const list = bar.querySelector('.bm-list')
  if (!list) return
  const limit = list.getBoundingClientRect().right
  let hidden = 0
  for (const c of list.children) {
    const r = c.getBoundingClientRect()
    const over = r.right > limit + 1
    c.style.visibility = over ? 'hidden' : ''
    if (over) hidden++
  }
  bar.querySelector('.bm-more').classList.toggle('hidden', !hidden)
}

function wire(bar) {
  bar.onclick = (e) => {
    const more = e.target.closest('.bm-more')
    const othersBtn = e.target.closest('.bm-others')
    const folderBtn = e.target.closest('.bm-folder')
    if (more || othersBtn || folderBtn) {
      const r = (more || othersBtn || folderBtn).getBoundingClientRect()
      let tree
      if (folderBtn) {
        const prefix = BAR + '/' + folderBtn.dataset.folder
        tree = treeOf(S.bookmarks.filter((b) => b.folder === prefix || (b.folder || '').startsWith(prefix + '/')), prefix)
      } else if (othersBtn) tree = treeOf(S.bookmarks.filter((b) => !(b.folder || '').startsWith(BAR)), '')
      else {
        tree = []
        for (const c of bar.querySelectorAll('.bm-list > *')) {
          if (c.style.visibility !== 'hidden') continue
          if (c.dataset.url) tree.push({ title: c.title.split('\n')[0], url: c.dataset.url })
          else if (c.dataset.folder) {
            const prefix = BAR + '/' + c.dataset.folder
            tree.push({ folder: c.dataset.folder, children: treeOf(S.bookmarks.filter((b) => b.folder === prefix || (b.folder || '').startsWith(prefix + '/')), prefix) })
          }
        }
      }
      api.call('menu.bookmarks', tree, r.left, r.bottom + 4)
      return
    }
    const b = e.target.closest('[data-url]')
    if (b) api.call('nav.go', b.dataset.url, { newTab: e.ctrlKey || e.metaKey })
  }
  bar.onauxclick = (e) => {
    const b = e.target.closest('[data-url]')
    if (b && e.button === 1) api.call('tabs.new', b.dataset.url, { active: false })
  }
  bar.oncontextmenu = (e) => {
    const b = e.target.closest('[data-id]')
    if (!b) return
    e.preventDefault()
    api.call('menu.bookmark', b.dataset.id, e.clientX, e.clientY)
  }
  // drag to reorder within the bar
  let dragId = null
  bar.ondragstart = (e) => {
    const b = e.target.closest('[data-id]')
    if (!b) return
    dragId = b.dataset.id
    e.dataTransfer.setData('text/uri-list', b.dataset.url)
  }
  bar.ondragover = (e) => {
    if (dragId) e.preventDefault()
  }
  bar.ondrop = (e) => {
    const target = e.target.closest('[data-id]')
    if (!dragId || !target || target.dataset.id === dragId) return (dragId = null)
    e.preventDefault()
    const list = [...S.bookmarks]
    const from = list.findIndex((x) => x.id === dragId)
    const [m] = list.splice(from, 1)
    const r = target.getBoundingClientRect()
    let to = list.findIndex((x) => x.id === target.dataset.id)
    if (e.clientX > r.left + r.width / 2) to++
    list.splice(to, 0, m)
    dragId = null
    S.bookmarks = list
    api.call('data.set', 'bookmarks', list)
  }
}

export function editBookmark(id) {
  const b = S.bookmarks.find((x) => x.id === id)
  if (b) bookmarkDialog({ url: b.url, title: b.title, id })
}

// ---------- add / edit bookmark: name + where to save it ----------
const OTHER = 'Other'
const folderLabel = (f) => (f === OTHER ? 'Other bookmarks' : f.split('/').map((p) => (p === OTHER ? 'Other bookmarks' : p)).join(' › '))

function folderChoices() {
  const set = new Set([BAR, OTHER])
  for (const b of S.bookmarks) {
    const parts = (b.folder || OTHER).split('/')
    for (let i = 1; i <= parts.length; i++) set.add(parts.slice(0, i).join('/'))
  }
  // the bar and its folders first, then everything else, alphabetically
  const rank = (f) => (f === BAR || f.startsWith(BAR + '/') ? 0 : f === OTHER || f.startsWith(OTHER + '/') ? 1 : 2)
  return [...set].sort((a, z) => rank(a) - rank(z) || a.localeCompare(z))
}

let lastFolder = BAR
try {
  lastFolder = localStorage.getItem('kite.lastBookmarkFolder') || BAR
} catch {}

// Ask where to save (and under what name) before bookmarking. With an
// existing bookmark it edits it instead, with a Remove button. Drawn in the
// floating dropdown layer, so the page underneath keeps playing.
let box = null // { url, title, id, existing }

const BM_CSS = `<style>
  .bm { display: flex; flex-direction: column; gap: 10px; padding: 8px 8px 6px; }
  .bm-h { display: flex; align-items: center; gap: 8px; font-size: 14px; font-weight: 600; }
  .bm-h .icon { color: var(--accent); width: 17px; height: 17px; }
  .bm-l { display: flex; flex-direction: column; gap: 5px; font-size: 12px; color: var(--muted); }
  .bm .input { height: 32px; font-size: 13px; }
  .bm-folders { display: flex; flex-direction: column; gap: 1px; max-height: 190px; overflow-y: auto; padding: 3px; border: 1px solid var(--border); border-radius: var(--radius-sm); background: var(--surface-2); }
  .bm-f { display: flex; align-items: center; gap: 8px; height: 30px; padding: 0 8px; border-radius: calc(var(--radius-sm) - 2px); color: var(--text); font-size: 13px; cursor: default; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .bm-f:hover { background: var(--surface-3); }
  .bm-f.on { background: var(--accent-soft); color: var(--accent); font-weight: 500; }
  .bm-f .icon { width: 15px; height: 15px; flex: none; color: var(--muted); }
  .bm-f.on .icon { color: var(--accent); }
  .bm-f.sub { padding-left: calc(8px + var(--d, 1) * 16px); }
  .bm-f.new { color: var(--accent); }
  .bm-new { display: flex; flex-direction: column; gap: 6px; }
  .bm-new[hidden] { display: none; }
  .bm-seg { display: flex; gap: 2px; padding: 2px; border-radius: var(--radius-sm); background: var(--surface-2); }
  .bm-seg .bm-f { flex: 1; justify-content: center; height: 26px; font-size: 12px; }
  .bm-row { display: flex; gap: 8px; align-items: center; padding-top: 2px; }
  .bm-row .spacer { flex: 1; }
</style>`

export const bookmarkBoxOpen = () => !!box

export function closeBookmarkBox(already) {
  if (!box) return
  box = null
  $('#toolbar [data-tb="bookmark"]')?.classList.remove('pressed')
  if (!already) api.call('popup.hide')
}

export function bookmarkDialog({ url, title, id }) {
  if (!url) return
  if (box) return closeBookmarkBox() // pressing it again closes it
  const existing = id ? S.bookmarks.find((x) => x.id === id) : S.bookmarks.find((x) => x.url === url)
  const choices = folderChoices()
  const current = existing?.folder || (choices.includes(lastFolder) ? lastFolder : BAR)
  box = { url, title, id, existing }
  const row = (f) => {
    const depth = f.split('/').length - 1
    const ic = f === BAR ? 'bookmark' : 'folder'
    return `<div class="bm-f ${depth ? 'sub' : ''} ${f === current ? 'on' : ''}" style="--d:${depth}" data-choose="${esc(f)}" title="${esc(folderLabel(f))}">${icon(ic)}${esc(depth ? f.split('/').pop() : folderLabel(f))}</div>`
  }
  const html = `${BM_CSS}<form class="bm" autocomplete="off">
      <div class="bm-h">${icon('bookmark')} ${existing ? 'Edit bookmark' : 'Add bookmark'}</div>
      <label class="bm-l">Name<input class="input" name="title" value="${esc(existing?.title || title || url)}" spellcheck="false" autofocus></label>
      ${id ? `<label class="bm-l">Address<input class="input" name="url" value="${esc(existing?.url || url)}" spellcheck="false"></label>` : ''}
      <div class="bm-l">Save in
        <input type="hidden" name="folder" value="${esc(current)}">
        <div class="bm-folders" data-choices="folder">${choices.map(row).join('')}<div class="bm-f new" data-choose="__new">${icon('plus')}New folder…</div></div>
      </div>
      <div class="bm-new" data-reveal-for="folder=__new" hidden>
        <input class="input" name="newFolder" placeholder="Folder name" spellcheck="false">
        <input type="hidden" name="parent" value="${BAR}">
        <div class="bm-seg" data-choices="parent"><div class="bm-f on" data-choose="${BAR}">On the bookmarks bar</div><div class="bm-f" data-choose="${OTHER}">In Other bookmarks</div></div>
      </div>
      <div class="bm-row">${existing ? `<button type="button" class="btn danger" data-act="bm:remove">Remove</button>` : ''}<div class="spacer"></div><button type="button" class="btn" data-act="bm:cancel">Cancel</button><button class="btn primary" type="submit">${existing ? 'Save' : 'Add'}</button></div>
    </form>`
  // under the bookmark button when it's on the toolbar, else top-right
  const btn = $('#toolbar [data-tb="bookmark"]')
  btn?.classList.add('pressed')
  const r = btn?.getBoundingClientRect()
  const pad = 14
  const width = 330
  const right = r && r.width ? r.right + 4 : innerWidth - 12
  const top = r && r.width ? r.bottom + 2 : 90
  api.call('popup.show', { x: Math.max(0, Math.round(right - width - pad)), y: Math.round(top), width: width + pad * 2, maxHeight: Math.round(innerHeight - top - 10) }, html, cssVars(), true, 'form')
}

const saveList = (list) => {
  S.bookmarks = list
  api.call('data.set', 'bookmarks', list)
}

// Buttons and the submitted form from the bookmark box
export function bookmarkPick(what) {
  if (!box) return
  const { url, id, existing } = box
  if (what === 'esc' || what === 'bm:cancel') return closeBookmarkBox()
  if (what === 'bm:remove' && existing) {
    saveList(S.bookmarks.filter((x) => x.id !== existing.id))
    closeBookmarkBox()
    return toast('Bookmark removed')
  }
  if (!what.startsWith('form:')) return
  let v = {}
  try {
    v = JSON.parse(what.slice(5))
  } catch {
    return
  }
  let folder = v.folder || BAR
  if (folder === '__new') {
    const name = String(v.newFolder || '').trim().replace(/\//g, '-')
    if (!name) return // the name box is showing; nothing to save yet
    folder = `${v.parent === OTHER ? OTHER : BAR}/${name}`
  }
  const name = String(v.title || '').trim() || url
  const href = (id && String(v.url || '').trim()) || existing?.url || url
  if (existing) saveList(S.bookmarks.map((x) => (x.id === existing.id ? { ...x, title: name, url: href, folder } : x)))
  else saveList([...S.bookmarks, { id: 'b' + Date.now(), title: name, url: href, folder, added: Date.now() }])
  lastFolder = folder
  try {
    localStorage.setItem('kite.lastBookmarkFolder', folder)
  } catch {}
  closeBookmarkBox()
  api.call('nav.focusPage')
  if (!existing) toast(folder === BAR ? 'Added to the bookmarks bar' : `Saved in ${folderLabel(folder)}`)
}
