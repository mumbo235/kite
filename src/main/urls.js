const { SEARCH_ENGINES } = require('./defaults')

function engines(settings) {
  const all = { ...SEARCH_ENGINES }
  for (const e of settings.customEngines || []) all[e.id] = e
  return all
}

function currentEngine(settings) {
  const all = engines(settings)
  return all[settings.searchEngine] || all.duckduckgo
}

function searchURL(settings, query, engine = currentEngine(settings)) {
  return engine.url.replace('%s', encodeURIComponent(query))
}

const LOCAL_RE = /^(localhost|127\.0\.0\.1|\[::1\]|[\w-]+\.(localhost|test|local))(:\d+)?(\/.*)?$/i
const DOMAIN_RE = /^([\w-]+\.)+[a-z]{2,}(:\d+)?(\/.*)?$/i
const IP_RE = /^\d{1,3}(\.\d{1,3}){3}(:\d+)?(\/.*)?$/

// Turn whatever the user typed in the address bar into a URL.
function toURL(settings, input) {
  const text = String(input || '').trim()
  if (!text) return null

  // Search keywords, e.g. "yt cats" when a custom engine has keyword "yt".
  const [kw, ...rest] = text.split(/\s+/)
  if (rest.length) {
    const eng = Object.values(engines(settings)).find((e) => e.keyword && e.keyword === kw)
    if (eng) return searchURL(settings, rest.join(' '), eng)
  }

  if (/^(https?|kite|file|chrome-extension|view-source|about|data):/i.test(text)) return text
  if (/\s/.test(text)) return searchURL(settings, text)
  if (LOCAL_RE.test(text) || IP_RE.test(text)) return 'http://' + text
  if (DOMAIN_RE.test(text)) return (settings.httpsOnly ? 'https://' : 'https://') + text
  return searchURL(settings, text)
}

function isInternal(url) {
  return typeof url === 'string' && url.startsWith('kite://')
}

function hostOf(url) {
  try {
    return new URL(url).hostname
  } catch {
    return ''
  }
}

module.exports = { toURL, searchURL, currentEngine, engines, isInternal, hostOf }
