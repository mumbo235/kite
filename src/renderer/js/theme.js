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

export function resolveTheme(settings, themes) {
  let id = settings.theme
  if (id === 'system') id = darkQuery.matches ? 'dark' : 'light'
  return themes.find((t) => t.id === id) || themes.find((t) => t.id === 'light') || themes[0]
}

export function applyTheme(settings, themes, root = document.documentElement) {
  if (!settings || !themes?.length) return
  const theme = resolveTheme(settings, themes)
  const colors = { ...theme.colors }
  if (settings.accent) colors.accent = settings.accent
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
}
