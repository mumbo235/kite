// Shared bootstrap for kite:// pages: applies the theme and live-updates it.
import { applyTheme, onSystemThemeChange } from 'kite://ui/js/theme.js'

export const api = window.kite
export const $ = (s, r = document) => r.querySelector(s)
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

export let settings = null
export let themes = []
const subs = []
export const onSettings = (cb) => subs.push(cb)

export async function init() {
  ;[settings, themes] = await Promise.all([api.call('settings.get'), api.call('themes.list')])
  applyTheme(settings, themes)
  document.documentElement.classList.add('ready')
  api.on('settings', async (s) => {
    if ((s.customThemes || []).length !== themes.filter((t) => !t.builtin).length) themes = await api.call('themes.list')
    settings = s
    applyTheme(settings, themes)
    subs.forEach((cb) => cb(s))
  })
  onSystemThemeChange(() => applyTheme(settings, themes))
  return settings
}

export function setThemes(t) {
  themes = t
}
