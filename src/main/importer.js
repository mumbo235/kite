// Import bookmarks and history from other browsers on this computer
// (Chrome-family and Firefox), or from a bookmarks HTML file that any
// browser can export. Also exports Kite's bookmarks as HTML.
const { app, dialog } = require('electron')
const fs = require('fs')
const os = require('os')
const path = require('path')

const HOME = os.homedir()
const LOCAL = process.env.LOCALAPPDATA || ''
const ROAMING = process.env.APPDATA || ''
const MAC = path.join(HOME, 'Library/Application Support')

// Where each browser keeps its profiles, per platform (first match wins per dir).
const CHROMIUM = [
  { id: 'chrome', name: 'Google Chrome', dirs: ['.config/google-chrome', '.var/app/com.google.Chrome/config/google-chrome', `${MAC}/Google/Chrome`, LOCAL && `${LOCAL}/Google/Chrome/User Data`] },
  { id: 'chromium', name: 'Chromium', dirs: ['.config/chromium', 'snap/chromium/common/chromium', '.var/app/org.chromium.Chromium/config/chromium', `${MAC}/Chromium`, LOCAL && `${LOCAL}/Chromium/User Data`] },
  { id: 'brave', name: 'Brave', dirs: ['.config/BraveSoftware/Brave-Browser', '.var/app/com.brave.Browser/config/BraveSoftware/Brave-Browser', 'snap/brave/current/.config/BraveSoftware/Brave-Browser', `${MAC}/BraveSoftware/Brave-Browser`, LOCAL && `${LOCAL}/BraveSoftware/Brave-Browser/User Data`] },
  { id: 'edge', name: 'Microsoft Edge', dirs: ['.config/microsoft-edge', '.var/app/com.microsoft.Edge/config/microsoft-edge', `${MAC}/Microsoft Edge`, LOCAL && `${LOCAL}/Microsoft/Edge/User Data`] },
  { id: 'vivaldi', name: 'Vivaldi', dirs: ['.config/vivaldi', '.var/app/com.vivaldi.Vivaldi/config/vivaldi', `${MAC}/Vivaldi`, LOCAL && `${LOCAL}/Vivaldi/User Data`] },
  { id: 'opera', name: 'Opera', dirs: ['.config/opera', '.var/app/com.opera.Opera/config/opera', `${MAC}/com.operasoftware.Opera`, ROAMING && `${ROAMING}/Opera Software/Opera Stable`] },
]
const FIREFOX = { id: 'firefox', name: 'Firefox', dirs: ['.mozilla/firefox', 'snap/firefox/common/.mozilla/firefox', '.var/app/org.mozilla.firefox/.mozilla/firefox', '.var/app/org.mozilla.firefox/config/mozilla/firefox', `${MAC}/Firefox`, ROAMING && `${ROAMING}/Mozilla/Firefox`] }

const abs = (d) => (path.isAbsolute(d) ? d : path.join(HOME, d))
const exists = (p) => {
  try {
    return fs.existsSync(p)
  } catch {
    return false
  }
}
const okURL = (u) => typeof u === 'string' && /^(https?|ftp|file):/i.test(u)

// ---------- discovery ----------
function findSources() {
  const out = []
  for (const b of CHROMIUM) {
    for (const base of b.dirs.filter(Boolean).map(abs)) {
      if (!exists(base)) continue
      let names = {}
      try {
        names = JSON.parse(fs.readFileSync(path.join(base, 'Local State'), 'utf8')).profile?.info_cache || {}
      } catch {}
      const dirs = [base, ...safeList(base).filter((d) => d === 'Default' || /^Profile \d+$/.test(d)).map((d) => path.join(base, d))]
      for (const dir of dirs) {
        const hasBm = exists(path.join(dir, 'Bookmarks'))
        const hasHist = exists(path.join(dir, 'History'))
        if (!hasBm && !hasHist && !exists(path.join(dir, 'Cookies')) && !exists(path.join(dir, 'Network', 'Cookies'))) continue
        const key = path.basename(dir)
        const flatpak = base.includes('/.var/app/') ? ' (Flatpak)' : base.includes('/snap/') ? ' (Snap)' : ''
        const hasCookies = exists(path.join(dir, 'Network', 'Cookies')) || exists(path.join(dir, 'Cookies'))
        out.push({ id: `${b.id}:${dir}`, kind: 'chromium', browser: b.name + flatpak, profile: names[key]?.name || (dir === base ? 'Default' : key), dir, bookmarks: hasBm, history: hasHist, cookies: hasCookies })
      }
    }
  }
  for (const base of FIREFOX.dirs.filter(Boolean).map(abs)) {
    if (!exists(base)) continue
    const flatpak = base.includes('/.var/app/') ? ' (Flatpak)' : base.includes('/snap/') ? ' (Snap)' : ''
    for (const p of firefoxProfiles(base)) {
      if (!exists(path.join(p.dir, 'places.sqlite'))) continue
      out.push({ id: `firefox:${p.dir}`, kind: 'firefox', browser: 'Firefox' + flatpak, profile: p.name, dir: p.dir, bookmarks: true, history: true, cookies: exists(path.join(p.dir, 'cookies.sqlite')) })
    }
  }
  return out
}

function safeList(dir) {
  try {
    return fs.readdirSync(dir)
  } catch {
    return []
  }
}

function firefoxProfiles(base) {
  const list = []
  try {
    const ini = fs.readFileSync(path.join(base, 'profiles.ini'), 'utf8')
    for (const block of ini.split(/\n(?=\[)/)) {
      if (!/^\[Profile/.test(block)) continue
      const get = (k) => (block.match(new RegExp(`^${k}=(.*)$`, 'm')) || [])[1]?.trim()
      const p = get('Path')
      if (!p) continue
      list.push({ name: get('Name') || p, dir: get('IsRelative') === '0' ? p : path.join(base, p) })
    }
  } catch {}
  if (!list.length) for (const d of safeList(base)) list.push({ name: d, dir: path.join(base, d) })
  return list
}

// ---------- SQLite (copied first: the other browser may have it locked) ----------
function withDb(file, fn) {
  const { DatabaseSync } = require('node:sqlite')
  const tmp = fs.mkdtempSync(path.join(app.getPath('temp'), 'kite-import-'))
  try {
    const copy = path.join(tmp, path.basename(file))
    fs.copyFileSync(file, copy)
    for (const ext of ['-wal', '-shm']) if (exists(file + ext)) fs.copyFileSync(file + ext, copy + ext)
    const db = new DatabaseSync(copy)
    try {
      return fn(db)
    } finally {
      db.close()
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}

// ---------- readers: return { bookmarks: [{title,url,path:[...],bar,added}], history: [{url,title,time}] } ----------
function readChromium(src, want) {
  const res = { bookmarks: [], history: [] }
  if (want.bookmarks && src.bookmarks) {
    const json = JSON.parse(fs.readFileSync(path.join(src.dir, 'Bookmarks'), 'utf8'))
    const walk = (node, trail, bar) => {
      if (node.type === 'url') {
        if (okURL(node.url)) res.bookmarks.push({ title: node.name || node.url, url: node.url, path: trail, bar, added: chromeTime(node.date_added) })
      } else for (const c of node.children || []) walk(c, node === json.roots.bookmark_bar || node === json.roots.other || node === json.roots.synced ? trail : [...trail, node.name], bar)
    }
    if (json.roots.bookmark_bar) walk(json.roots.bookmark_bar, [], true)
    if (json.roots.other) walk(json.roots.other, [], false)
    if (json.roots.synced) walk(json.roots.synced, ['Mobile'], false)
  }
  if (want.history && src.history) {
    res.history = withDb(path.join(src.dir, 'History'), (db) => {
      const stmt = db.prepare('SELECT url, title, last_visit_time AS t FROM urls WHERE hidden = 0 AND last_visit_time > 0 ORDER BY last_visit_time DESC LIMIT ?')
      stmt.setReadBigInts(true) // Chrome timestamps exceed Number.MAX_SAFE_INTEGER
      return stmt
        .all(want.limit)
        .map((r) => ({ url: r.url, title: r.title || '', time: chromeTime(r.t) }))
        .filter((r) => okURL(r.url))
    })
  }
  return res
}

// Chrome stores microseconds since 1601-01-01.
function chromeTime(v) {
  const n = Number(v)
  return n ? Math.round(n / 1000 - 11644473600000) : Date.now()
}

function readFirefox(src, want) {
  return withDb(path.join(src.dir, 'places.sqlite'), (db) => {
    const res = { bookmarks: [], history: [] }
    if (want.bookmarks) {
      const bmStmt = db.prepare('SELECT b.id, b.type, b.parent, b.title, b.guid, CAST(b.dateAdded / 1000 AS INTEGER) AS added, p.url FROM moz_bookmarks b LEFT JOIN moz_places p ON p.id = b.fk ORDER BY b.parent, b.position')
      const rows = bmStmt.all()
      const byId = new Map(rows.map((r) => [r.id, r]))
      const ROOTS = { toolbar_____: 'bar', menu________: 'Bookmarks menu', unfiled_____: '', mobile______: 'Mobile', root________: '', tags________: '' }
      for (const r of rows) {
        if (r.type !== 1 || !okURL(r.url)) continue
        const trail = []
        let bar = false
        let p = byId.get(r.parent)
        while (p && !(p.guid in ROOTS)) {
          trail.unshift(p.title || 'Folder')
          p = byId.get(p.parent)
        }
        if (p?.guid === 'toolbar_____') bar = true
        else if (p && ROOTS[p.guid]) trail.unshift(ROOTS[p.guid])
        if (p?.guid === 'tags________') continue
        res.bookmarks.push({ title: r.title || r.url, url: r.url, path: trail, bar, added: r.added ? Number(r.added) : Date.now() })
      }
    }
    if (want.history) {
      const stmt = db.prepare('SELECT url, title, last_visit_date AS t FROM moz_places WHERE hidden = 0 AND last_visit_date IS NOT NULL ORDER BY last_visit_date DESC LIMIT ?')
      stmt.setReadBigInts(true)
      res.history = stmt
        .all(want.limit)
        .map((r) => ({ url: r.url, title: r.title || '', time: Math.round(Number(r.t) / 1000) }))
        .filter((r) => okURL(r.url))
    }
    return res
  })
}

// Netscape bookmark file format (what every browser's "Export bookmarks" writes).
function readHtml(html) {
  const res = { bookmarks: [], history: [] }
  const stack = []
  let pending = null
  const decode = (s) =>
    s
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, '&')
      .trim()
  const re = /<(\/?)(dl|h3|a)\b([^>]*)>([^<]*)/gi
  let m
  while ((m = re.exec(html))) {
    const [, close, tagRaw, attrs, text] = m
    const tag = tagRaw.toLowerCase()
    if (tag === 'h3' && !close) pending = { name: decode(text), bar: /PERSONAL_TOOLBAR_FOLDER\s*=\s*"?true/i.test(attrs) }
    else if (tag === 'dl' && !close) {
      stack.push(pending)
      pending = null
    } else if (tag === 'dl' && close) stack.pop()
    else if (tag === 'a' && !close) {
      const href = (attrs.match(/href\s*=\s*"([^"]*)"/i) || [])[1]
      if (!okURL(href)) continue
      const added = Number((attrs.match(/add_date\s*=\s*"(\d+)"/i) || [])[1]) * 1000 || Date.now()
      const folders = stack.filter(Boolean)
      const barIdx = folders.findIndex((f) => f.bar)
      const bar = barIdx >= 0
      const trail = (bar ? folders.slice(barIdx + 1) : folders).map((f) => f.name)
      res.bookmarks.push({ title: decode(text) || href, url: decode(href), path: trail, bar, added })
    }
  }
  return res
}

// ---------- cookies ----------
// Firefox keeps cookies in plain SQLite. Chrome-family browsers encrypt the
// values with AES-128-CBC; on Linux the key is either the fixed "peanuts"
// password (v10) or a password stored in KWallet / the Secret Service (v11).
const KEYRING = {
  chrome: { kwallet: ['Chrome Keys', 'Chrome Safe Storage'], app: 'chrome' },
  chromium: { kwallet: ['Chromium Keys', 'Chromium Safe Storage'], app: 'chromium' },
  brave: { kwallet: ['Brave Keys', 'Brave Safe Storage'], app: 'brave' },
  edge: { kwallet: ['Microsoft Edge Keys', 'Microsoft Edge Safe Storage'], app: 'microsoft-edge' },
  vivaldi: { kwallet: ['Vivaldi Keys', 'Vivaldi Safe Storage'], app: 'vivaldi' },
  opera: { kwallet: ['Opera Keys', 'Opera Safe Storage'], app: 'opera' },
}

// macOS keeps the cookie password in the Keychain (account = browser name).
const MAC_KEYCHAIN = { chrome: 'Chrome', chromium: 'Chromium', brave: 'Brave', edge: 'Microsoft Edge', vivaldi: 'Vivaldi', opera: 'Opera' }

function run(cmd, args) {
  const { execFile } = require('child_process')
  return new Promise((resolve) => execFile(cmd, args, { encoding: 'utf8', timeout: 90000, maxBuffer: 1 << 20 }, (err, out) => resolve(err ? '' : String(out).trim())))
}

// Windows: the AES-256-GCM key lives in "Local State", protected by DPAPI.
async function windowsKey(src) {
  const ls = [path.join(src.dir, '..', 'Local State'), path.join(src.dir, 'Local State')].find(exists)
  if (!ls) return null
  const enc = JSON.parse(fs.readFileSync(ls, 'utf8')).os_crypt?.encrypted_key
  if (!enc) return null
  const blob = Buffer.from(enc, 'base64').subarray(5).toString('base64') // drop "DPAPI"
  const ps = `Add-Type -AssemblyName System.Security; [Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String('${blob}'), $null, 'CurrentUser'))`
  const out = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps])
  return out ? Buffer.from(out, 'base64') : null
}

async function keyringPassword(browserId) {
  if (process.platform === 'darwin') {
    const out = await run('security', ['find-generic-password', '-wa', MAC_KEYCHAIN[browserId] || 'Chrome'])
    return out || null
  }
  const { execFile } = require('child_process')
  const run = (cmd, args) => new Promise((resolve) => execFile(cmd, args, { encoding: 'utf8', timeout: 90000 }, (err, out) => resolve(err ? '' : String(out).trim())))
  const k = KEYRING[browserId]
  if (!k) return null
  const tries = [
    ['kwallet-query', ['-f', k.kwallet[0], '-r', k.kwallet[1], 'kdewallet']],
    ['secret-tool', ['lookup', 'application', k.app]],
  ]
  for (const [cmd, args] of tries) {
    const out = await run(cmd, args)
    if (out && !/failed|not found|does not exist/i.test(out)) return out
  }
  return null
}

function chromiumDecryptor(keyringPw, winKey) {
  const crypto = require('crypto')
  // Windows: AES-256-GCM with the DPAPI-protected key ("v20" = Chrome's
  // app-bound encryption, which only Chrome itself can read)
  if (winKey) {
    return (buf, stripHash) => {
      if (!buf || buf.length < 4) return null
      const prefix = buf.subarray(0, 3).toString('latin1')
      if (prefix === 'v20') return null
      if (prefix !== 'v10' && prefix !== 'v11') return null
      try {
        const d = crypto.createDecipheriv('aes-256-gcm', winKey, buf.subarray(3, 15))
        d.setAuthTag(buf.subarray(buf.length - 16))
        let out = Buffer.concat([d.update(buf.subarray(15, buf.length - 16)), d.final()])
        if (stripHash) out = out.subarray(32)
        return out.toString('utf8')
      } catch {
        return null
      }
    }
  }
  // macOS uses 1003 PBKDF2 rounds with the Keychain password; Linux uses 1
  const rounds = process.platform === 'darwin' ? 1003 : 1
  const derive = (pw) => crypto.pbkdf2Sync(pw, 'saltysalt', rounds, 16, 'sha1')
  const v10 = process.platform === 'darwin' ? (keyringPw ? [derive(keyringPw)] : []) : [derive('peanuts'), derive('')]
  const keys = { v10, v11: keyringPw ? [derive(keyringPw)] : [] }
  return (buf, stripHash) => {
    if (!buf || buf.length < 4) return null
    const prefix = buf.subarray(0, 3).toString('latin1')
    if (prefix !== 'v10' && prefix !== 'v11') return buf.toString('utf8') // old, unencrypted
    for (const key of keys[prefix]) {
      try {
        const d = crypto.createDecipheriv('aes-128-cbc', key, Buffer.alloc(16, ' '))
        let out = Buffer.concat([d.update(buf.subarray(3)), d.final()])
        if (stripHash) out = out.subarray(32) // DB version 24+: SHA-256 of the domain first
        return out.toString('utf8')
      } catch {}
    }
    return null
  }
}

const SAMESITE = { '-1': 'unspecified', 0: 'no_restriction', 1: 'lax', 2: 'strict' }

async function readChromiumCookies(src) {
  const file = [path.join(src.dir, 'Network', 'Cookies'), path.join(src.dir, 'Cookies')].find(exists)
  if (!file) return []
  const { rows, version } = withDb(file, (db) => {
    const stmt = db.prepare('SELECT host_key, name, value, encrypted_value, path, expires_utc, is_secure, is_httponly, samesite FROM cookies')
    stmt.setReadBigInts(true)
    return { rows: stmt.all(), version: Number(db.prepare("SELECT value FROM meta WHERE key = 'version'").get()?.value || 0) }
  })
  let pw = null
  let winKey = null
  const prefixes = new Set(rows.map((r) => Buffer.from(r.encrypted_value || []).subarray(0, 3).toString('latin1')))
  if (process.platform === 'win32') {
    winKey = await windowsKey(src)
    if (!winKey) throw new Error('KEYRING')
    if (prefixes.size === 1 && prefixes.has('v20')) throw new Error('APPBOUND')
  } else if (prefixes.has('v11') || (process.platform === 'darwin' && prefixes.has('v10'))) {
    pw = await keyringPassword(src.id.split(':')[0])
    if (!pw) throw new Error('KEYRING')
  }
  const decrypt = chromiumDecryptor(pw, winKey)
  {
    const out = []
    for (const r of rows) {
      const value = r.value || decrypt(Buffer.from(r.encrypted_value || []), version >= 24)
      if (value == null) continue
      const exp = Number(r.expires_utc)
      out.push({
        domain: r.host_key,
        name: r.name,
        value,
        path: r.path || '/',
        secure: !!Number(r.is_secure),
        httpOnly: !!Number(r.is_httponly),
        expires: exp ? chromeTime(exp) / 1000 : 0,
        sameSite: SAMESITE[String(Number(r.samesite))] || 'unspecified',
      })
    }
    return out
  }
}

function readFirefoxCookies(src) {
  const file = path.join(src.dir, 'cookies.sqlite')
  if (!exists(file)) return []
  return withDb(file, (db) => {
    const stmt = db.prepare("SELECT host, name, value, path, expiry, isSecure, isHttpOnly, sameSite FROM moz_cookies WHERE originAttributes = ''")
    stmt.setReadBigInts(true)
    return stmt.all().map((r) => {
      const e = Number(r.expiry)
      return {
        domain: r.host,
        name: r.name,
        value: r.value,
        path: r.path || '/',
        secure: !!Number(r.isSecure),
        httpOnly: !!Number(r.isHttpOnly),
        expires: e > 1e11 ? e / 1000 : e, // newer Firefox stores milliseconds
        sameSite: { 0: 'no_restriction', 1: 'lax', 2: 'strict' }[Number(r.sameSite)] || 'unspecified',
      }
    })
  })
}

async function setCookies(sessions, cookies) {
  const now = Date.now() / 1000
  let ok = 0
  let failed = 0
  for (const c of cookies) {
    if (c.expires && c.expires < now) continue
    const host = c.domain.replace(/^\./, '')
    const hostOnly = !c.domain.startsWith('.') || c.name.startsWith('__Host-')
    const details = {
      url: `${c.secure ? 'https' : 'http'}://${host}${c.path || '/'}`,
      name: c.name,
      value: c.value,
      path: c.path || '/',
      secure: c.secure || c.sameSite === 'no_restriction' || c.name.startsWith('__Secure-') || c.name.startsWith('__Host-'),
      httpOnly: c.httpOnly,
      sameSite: c.sameSite,
    }
    if (!hostOnly) details.domain = c.domain
    if (c.expires) details.expirationDate = c.expires
    let good = false
    for (const ses of sessions) {
      try {
        await ses.cookies.set(details)
        good = true
      } catch {}
    }
    good ? ok++ : failed++
  }
  for (const ses of sessions) await ses.cookies.flushStore().catch(() => {})
  return { ok, failed }
}

// ---------- site icons ----------
// Copy the icons the other browser already saved for these hosts, so imported
// bookmarks show their real icons immediately (even for sites that are down).
function importIcons(ctx, src, urls) {
  const fav = ctx.favicons
  if (!fav) return 0
  const want = new Set(urls.map((u) => fav.key(u)).filter(Boolean))
  if (!want.size) return 0
  const best = new Map() // host -> { data, width }
  const consider = (pageUrl, data, width) => {
    const host = fav.key(pageUrl)
    if (!host || !want.has(host) || !data?.length) return
    const w = Number(width) || 16
    const cur = best.get(host)
    // prefer ~32-64px icons; anything beats nothing
    const score = (x) => (x >= 32 && x <= 96 ? 1000 - Math.abs(64 - x) : x)
    if (!cur || score(w) > score(cur.width)) best.set(host, { data: Buffer.from(data), width: w })
  }
  try {
    if (src.kind === 'firefox') {
      const file = path.join(src.dir, 'favicons.sqlite')
      if (exists(file))
        withDb(file, (db) => {
          for (const r of db.prepare('SELECT p.page_url AS page, i.data AS data, i.width AS width FROM moz_pages_w_icons p JOIN moz_icons_to_pages ip ON ip.page_id = p.id JOIN moz_icons i ON i.id = ip.icon_id WHERE i.data IS NOT NULL').iterate()) consider(r.page, r.data, r.width)
        })
    } else {
      const file = path.join(src.dir, 'Favicons')
      if (exists(file))
        withDb(file, (db) => {
          for (const r of db.prepare('SELECT m.page_url AS page, b.image_data AS data, b.width AS width FROM icon_mapping m JOIN favicon_bitmaps b ON b.icon_id = m.icon_id WHERE b.image_data IS NOT NULL').iterate()) consider(r.page, r.data, r.width)
        })
    }
  } catch (e) {
    console.error('[import] icons:', e.message)
  }
  let n = 0
  for (const [host, { data }] of best) if (fav.store(host, data, 'import:' + src.browser, { overwrite: false })) n++
  return n
}

// ---------- merge into Kite ----------
function merge(ctx, data, opts, label) {
  const result = { bookmarks: 0, history: 0, skipped: 0 }
  if (data.bookmarks.length) {
    const list = ctx.data.get('bookmarks')
    const have = new Set(list.map((b) => b.url))
    const base = `Imported from ${label}`
    for (const bm of data.bookmarks) {
      if (have.has(bm.url)) {
        result.skipped++
        continue
      }
      have.add(bm.url)
      const root = bm.bar && opts.toBar ? 'Bookmarks bar' : bm.bar ? `${base}/Bookmarks bar` : base
      const folder = [root, ...bm.path.filter(Boolean)].join('/')
      list.push({ id: 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7), title: bm.title, url: bm.url, folder, added: bm.added })
      result.bookmarks++
    }
    ctx.data.set('bookmarks', list)
    ctx.browser.emit('data:bookmarks', list)
    ctx.browser.emitTabs()
  }
  if (data.history.length) {
    const hist = ctx.data.get('history')
    const seen = new Set(hist.map((h) => h.url + '|' + Math.round(h.time / 60000)))
    const add = data.history.filter((h) => !seen.has(h.url + '|' + Math.round(h.time / 60000)))
    const merged = [...hist, ...add].sort((a, b) => a.time - b.time).slice(-20000)
    ctx.data.set('history', merged)
    result.history = add.length
  }
  return result
}

async function runImport(ctx, sourceId, opts = {}) {
  const src = findSources().find((s) => s.id === sourceId)
  if (!src) throw new Error('That browser profile was not found.')
  const want = { bookmarks: opts.bookmarks !== false, history: opts.history !== false, limit: Math.min(Number(opts.limit) || 5000, 20000) }
  let data
  try {
    data = src.kind === 'firefox' ? readFirefox(src, want) : readChromium(src, want)
  } catch (e) {
    throw new Error(`Couldn't read ${src.browser}'s data (${e.message}). Try closing ${src.browser} and importing again.`)
  }
  const result = merge(ctx, data, { toBar: opts.toBar !== false }, src.browser.replace(/ \(.*\)$/, ''))
  // icons for imported bookmarks, existing bookmarks, new tab shortcuts and recent history
  const iconUrls = [...data.bookmarks.map((b) => b.url), ...ctx.data.get('bookmarks').map((b) => b.url), ...(ctx.settings.data.newtab?.shortcuts || []).map((s) => s.url), ...data.history.slice(0, 1000).map((h) => h.url)]
  result.icons = importIcons(ctx, src, iconUrls)
  if (opts.cookies) {
    let cookies
    try {
      cookies = src.kind === 'firefox' ? readFirefoxCookies(src) : await readChromiumCookies(src)
    } catch (e) {
      const where = process.platform === 'darwin' ? 'the Keychain prompt' : process.platform === 'win32' ? 'Windows' : 'the KWallet prompt'
      if (e.message === 'KEYRING') throw new Error(`Imported bookmarks/history, but couldn't unlock ${src.browser}'s cookies: allow access in ${where} and try again.`)
      if (e.message === 'APPBOUND') throw new Error(`Imported bookmarks/history. ${src.browser} on Windows locks its cookies to itself, so they can't be imported. Firefox cookies can.`)
      throw new Error(`Couldn't read ${src.browser}'s cookies (${e.message}). Try closing ${src.browser} and importing again.`)
    }
    const sessions = [ctx.tabSession]
    if (opts.panelCookies !== false) sessions.push(ctx.panelSession)
    const r = await setCookies(sessions, cookies)
    result.cookies = r.ok
    result.cookiesFailed = r.failed
  }
  return result
}

async function importHtmlFile(ctx, opts = {}) {
  const r = await dialog.showOpenDialog({ title: 'Import bookmarks file', filters: [{ name: 'Bookmarks HTML', extensions: ['html', 'htm'] }], properties: ['openFile'] })
  if (r.canceled || !r.filePaths[0]) return null
  const data = readHtml(fs.readFileSync(r.filePaths[0], 'utf8'))
  if (!data.bookmarks.length) throw new Error('No bookmarks found in that file.')
  return merge(ctx, data, { toBar: opts.toBar !== false }, 'file')
}

async function exportHtml(ctx) {
  const r = await dialog.showSaveDialog({ title: 'Export bookmarks', defaultPath: path.join(app.getPath('documents'), 'kite-bookmarks.html'), filters: [{ name: 'Bookmarks HTML', extensions: ['html'] }] })
  if (r.canceled || !r.filePath) return null
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  // build a folder tree from "A/B/C" folder strings
  const tree = { folders: new Map(), items: [] }
  for (const b of ctx.data.get('bookmarks')) {
    let node = tree
    for (const part of (b.folder || 'Other').split('/')) {
      if (!node.folders.has(part)) node.folders.set(part, { folders: new Map(), items: [] })
      node = node.folders.get(part)
    }
    node.items.push(b)
  }
  const out = ['<!DOCTYPE NETSCAPE-Bookmark-file-1>', '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">', '<TITLE>Bookmarks</TITLE>', '<H1>Bookmarks</H1>', '<DL><p>']
  const write = (node, depth) => {
    const pad = '    '.repeat(depth)
    for (const [name, child] of node.folders) {
      const bar = depth === 1 && name === 'Bookmarks bar' ? ' PERSONAL_TOOLBAR_FOLDER="true"' : ''
      out.push(`${pad}<DT><H3${bar}>${esc(name)}</H3>`, `${pad}<DL><p>`)
      write(child, depth + 1)
      out.push(`${pad}</DL><p>`)
    }
    for (const b of node.items) out.push(`${pad}<DT><A HREF="${esc(b.url)}" ADD_DATE="${Math.round((b.added || Date.now()) / 1000)}">${esc(b.title)}</A>`)
  }
  write(tree, 1)
  out.push('</DL><p>')
  fs.writeFileSync(r.filePath, out.join('\n'))
  return r.filePath
}

module.exports = { importIcons, findSources, runImport, importHtmlFile, exportHtml, readHtml, readFirefoxCookies, readChromiumCookies }
