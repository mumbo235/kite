// Bookmarks bar under the toolbar: shows the "Bookmarks bar" folder.
import { S, api, $, h, esc, activeTab } from './main.js'
import { icon } from './icons.js'
import { fixBrokenFavicons } from './tabs.js'
import { prompt } from './overlay.js'

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
        : `<span class="bm-empty">Press the star or ${esc(S.settings.shortcuts.bookmarkPage || 'Ctrl+D')} to add pages here.</span>`
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

export async function editBookmark(id) {
  const b = S.bookmarks.find((x) => x.id === id)
  if (!b) return
  const r = await prompt({
    title: 'Edit bookmark',
    fields: [
      { name: 'title', label: 'Name', value: b.title },
      { name: 'url', label: 'URL', value: b.url },
      { name: 'folder', label: 'Folder (use “Bookmarks bar” to show it on the bar)', value: b.folder || 'Other' },
    ],
    ok: 'Save',
    extra: { label: 'Delete', danger: true, value: 'delete' },
  })
  if (!r) return
  const list = r === 'delete' ? S.bookmarks.filter((x) => x.id !== id) : S.bookmarks.map((x) => (x.id === id ? { ...x, ...r } : x))
  S.bookmarks = list
  api.call('data.set', 'bookmarks', list)
}
