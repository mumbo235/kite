// Applies a theme + appearance settings as CSS variables.
// Shared by the browser UI and the kite:// pages.

const MAP = {
  bg: '--bg',
  surface: '--surface',
  surface2: '--surface-2',
  surface3: '--surface-3',
  text: '--text',
  muted: '--muted',
  border: '--border',
  accent: '--accent',
  accentText: '--accent-text',
  danger: '--danger',
  success: '--success',
}

const darkQuery = matchMedia('(prefers-color-scheme: dark)')
let lastKey = null
let fadeTimer = null

// Is it currently inside the "dark" window of the theme schedule?
export function isScheduledDark(sched, now = new Date()) {
  const mins = (hhmm) => {
    const [h, m] = String(hhmm || '0:0').split(':').map(Number)
    return (h || 0) * 60 + (m || 0)
  }
  const t = now.getHours() * 60 + now.getMinutes()
  const from = mins(sched.from)
  const to = mins(sched.to)
  return from <= to ? t >= from && t < to : t >= from || t < to // window may cross midnight
}

export function resolveTheme(settings, themes) {
  let id = settings.theme
  const sched = settings.themeSchedule
  if (sched?.enabled) id = isScheduledDark(sched) ? sched.dark : sched.light
  if (id === 'system') id = darkQuery.matches ? 'dark' : 'light'
  return themes.find((t) => t.id === id) || themes.find((t) => t.id === 'light') || themes[0]
}

// The accent in effect: workspace tint > color from the new tab photo >
// the chosen accent > the theme's own.
export function effectiveAccent(settings, extra = {}) {
  if (settings.workspaceAccent && extra.workspaceColor) return extra.workspaceColor
  if (settings.accentFromWallpaper && settings.wallpaperAccent) return settings.wallpaperAccent
  return settings.accent || ''
}

function readableOn(hex) {
  const n = parseInt(String(hex).replace('#', '').slice(0, 6), 16)
  if (Number.isNaN(n)) return null
  const lum = 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)
  return lum > 170 ? '#111318' : '#ffffff'
}

export function applyTheme(settings, themes, root = document.documentElement, extra = {}) {
  if (!settings || !themes?.length) return
  const theme = resolveTheme(settings, themes)
  const colors = { ...theme.colors }
  const accent = effectiveAccent(settings, extra)
  if (accent) {
    colors.accent = accent
    colors.accentText = readableOn(accent) || colors.accentText
  }
  const key = JSON.stringify(colors)
  if (lastKey && key !== lastKey && settings.animations !== false) {
    root.classList.add('theme-fade')
    clearTimeout(fadeTimer)
    fadeTimer = setTimeout(() => root.classList.remove('theme-fade'), 380)
  }
  lastKey = key
  for (const [k, v] of Object.entries(MAP)) if (colors[k]) root.style.setProperty(v, colors[k])
  root.style.setProperty('--radius', settings.radius + 'px')
  root.style.setProperty('--fs', settings.fontSize + 'px')
  root.style.setProperty('--font', settings.font && settings.font !== 'system-ui' ? `${settings.font}, system-ui, sans-serif` : '')
  if (!settings.font || settings.font === 'system-ui') root.style.removeProperty('--font')
  root.style.setProperty('--speed', String(settings.animationSpeed || 1))
  root.style.colorScheme = theme.dark ? 'dark' : 'light'
  root.classList.toggle('dark', !!theme.dark)
  root.classList.toggle('no-anim', settings.animations === false)
  document.body?.classList.remove('density-compact', 'density-comfortable', 'density-spacious')
  document.body?.classList.add('density-' + (settings.density || 'comfortable'))
  return theme
}

export function onSystemThemeChange(cb) {
  darkQuery.addEventListener('change', cb)
  // re-check every minute so a theme schedule switches on time
  setInterval(cb, 60000)
}
