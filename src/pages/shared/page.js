// Shared bootstrap for kite:// pages: applies the theme and live-updates it.
import { applyTheme, onSystemThemeChange } from 'kite://ui/js/theme.js'

export const api = window.kite
export const $ = (s, r = document) => r.querySelector(s)
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

export let settings = null
export let themes = []
const subs = []
export const onSettings = (cb) => subs.push(cb)

let workspaceColor = null
const extra = () => ({ workspaceColor })
const paint = () => applyTheme(settings, themes, undefined, extra())

export async function init() {
  let st
  ;[settings, themes, st] = await Promise.all([api.call('settings.get'), api.call('themes.list'), api.call('tabs.state').catch(() => null)])
  const wsColor = (s) => s?.workspaces?.find((w) => w.id === s.workspace)?.color || null
  workspaceColor = wsColor(st)
  paint()
  api.on('tabs', (s) => {
    const c = wsColor(s)
    if (c !== workspaceColor) {
      workspaceColor = c
      if (settings.workspaceAccent) paint()
    }
  })
  document.documentElement.classList.add('ready')
  api.on('settings', async (s) => {
    if ((s.customThemes || []).length !== themes.filter((t) => !t.builtin).length) themes = await api.call('themes.list')
    settings = s
    paint()
    subs.forEach((cb) => cb(s))
  })
  onSystemThemeChange(paint)
  return settings
}

export function setThemes(t) {
  themes = t
}
