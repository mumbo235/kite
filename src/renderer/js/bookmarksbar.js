// Bookmarks bar under the toolbar: shows the "Bookmarks bar" folder.
import { S, api, $, h, esc, activeTab, setOverlay } from './main.js'
import { icon } from './icons.js'
import { fixBrokenFavicons } from './tabs.js'
import { prompt, toast } from './overlay.js'

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
// existing bookmark it edits it instead, with a Remove button.
export function bookmarkDialog({ url, title, id }) {
  if (!url) return
  const existing = id ? S.bookmarks.find((x) => x.id === id) : S.bookmarks.find((x) => x.url === url)
  const choices = folderChoices()
  const current = existing?.folder || (choices.includes(lastFolder) ? lastFolder : BAR)
  setOverlay(true)
  const ov = $('#overlay')
  ov.innerHTML = ''
  // under the star when it's on the toolbar, otherwise centered
  const star = $('#toolbar [data-tb="bookmark"]')
  const r = star?.getBoundingClientRect()
  const place = r && r.width ? `left:auto;transform:none;top:${Math.round(r.bottom + 6)}px;right:${Math.max(8, Math.round(innerWidth - r.right - 4))}px;` : ''
  const bd = h(`<div class="backdrop ${place ? 'clear' : ''}"></div>`)
  const pop = h(`<form class="popover dialog bm-dialog" style="${place}width:340px">
      <h3>${icon('star')} ${existing ? 'Edit bookmark' : 'Add bookmark'}</h3>
      <label>Name<input class="input" name="title" value="${esc(existing?.title || title || url)}" spellcheck="false"></label>
      ${id ? `<label>Address<input class="input" name="url" value="${esc(existing?.url || url)}" spellcheck="false"></label>` : ''}
      <label>Save in<select class="input" name="folder">
        ${choices.map((f) => `<option value="${esc(f)}" ${f === current ? 'selected' : ''}>${esc(folderLabel(f))}</option>`).join('')}
        <option value="__new">New folder…</option>
      </select></label>
      <label class="bm-new hidden">Folder name<span class="bm-new-row"><input class="input" name="newFolder" placeholder="e.g. Recipes" spellcheck="false"><select class="input" name="parent" title="Where the new folder goes"><option value="${BAR}">on the bookmarks bar</option><option value="${OTHER}">in Other bookmarks</option></select></span></label>
      <div class="row">${existing ? `<button type="button" class="btn danger" data-remove>Remove</button><div class="spacer"></div>` : ''}<button type="button" class="btn" data-cancel>Cancel</button><button class="btn primary" type="submit">${existing ? 'Save' : 'Add'}</button></div>
    </form>`)
  ov.append(bd, pop)
  const sel = pop.elements.folder
  const newBox = pop.querySelector('.bm-new')
  sel.onchange = () => {
    newBox.classList.toggle('hidden', sel.value !== '__new')
    if (sel.value === '__new') pop.elements.newFolder.focus()
  }
  let closed = false
  const close = () => {
    if (closed) return
    closed = true
    setOverlay(false)
    api.call('nav.focusPage')
  }
  const save = (list) => {
    S.bookmarks = list
    api.call('data.set', 'bookmarks', list)
  }
  pop.addEventListener('submit', (e) => {
    e.preventDefault()
    let folder = sel.value
    if (folder === '__new') {
      const name = pop.elements.newFolder.value.trim().replace(/\//g, '-')
      if (!name) return pop.elements.newFolder.focus()
      folder = `${pop.elements.parent.value}/${name}`
    }
    const name = pop.elements.title.value.trim() || url
    const href = (id && pop.elements.url?.value.trim()) || existing?.url || url
    if (existing) save(S.bookmarks.map((x) => (x.id === existing.id ? { ...x, title: name, url: href, folder } : x)))
    else save([...S.bookmarks, { id: 'b' + Date.now(), title: name, url: href, folder, added: Date.now() }])
    lastFolder = folder
    try {
      localStorage.setItem('kite.lastBookmarkFolder', folder)
    } catch {}
    close()
    if (!existing) toast(folder === BAR ? 'Added to the bookmarks bar' : `Saved in ${folderLabel(folder)}`)
  })
  pop.querySelector('[data-cancel]').onclick = close
  pop.querySelector('[data-remove]')?.addEventListener('click', () => {
    save(S.bookmarks.filter((x) => x.id !== existing.id))
    close()
    toast('Bookmark removed')
  })
  pop.addEventListener('keydown', (e) => e.key === 'Escape' && close())
  bd.onclick = close
  pop.elements.title.focus()
  pop.elements.title.select()
}
