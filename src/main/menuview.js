// Kite's own menus. Every menu Kite opens (right-click on pages and panels,
// tabs, the ⋯ menu, bookmarks, extensions...) is drawn in a see-through layer
// over the window in Kite's theme, instead of the system's plain menus.
// Electron Menu / MenuItem objects are accepted as-is, so menus built by
// libraries (extension context menu items) keep working.
const { WebContentsView, ipcMain, webContents: allWebContents } = require('electron')
const path = require('path')

const HTML = path.join(__dirname, '../renderer/menu/menu.html')
const PRELOAD = path.join(__dirname, '../preload/menu.js')

class MenuView {
  constructor(ctx) {
    this.ctx = ctx
    this.view = null
    this.ready = null
    this.items = new Map() // id -> MenuItem
    this.open = false
    this.vars = {} // theme colors pushed by the browser UI
    ipcMain.on('menu:pick', (e, id) => {
      if (e.sender !== this.view?.webContents) return
      const item = this.items.get(id)
      const target = this.target
      this.hide()
      if (item) this.run(item, target)
    })
    ipcMain.on('menu:close', (e) => {
      if (e.sender === this.view?.webContents) this.hide()
    })
  }

  get b() {
    return this.ctx.browser
  }

  ensure() {
    if (this.view && !this.view.webContents.isDestroyed()) return this.view
    this.view = new WebContentsView({ webPreferences: { preload: PRELOAD, sandbox: true, contextIsolation: true } })
    this.view.setBackgroundColor('#00000000')
    this.view.setVisible(false)
    this.ready = new Promise((r) => this.view.webContents.once('did-finish-load', r))
    this.view.webContents.loadFile(HTML)
    // losing focus (clicking another app, the window going away) closes it
    this.view.webContents.on('blur', () => setTimeout(() => this.open && !this.view.webContents.isFocused() && this.hide(), 80))
    return this.view
  }

  // Turn a Menu (or array of MenuItems) into plain data for the layer
  serialize(items) {
    const out = []
    for (const it of items) {
      if (it.visible === false) continue
      const id = 'm' + this.items.size
      this.items.set(id, it)
      let icon = ''
      try {
        if (it.icon && typeof it.icon.toDataURL === 'function' && !it.icon.isEmpty()) icon = it.icon.resize({ width: 16, height: 16 }).toDataURL()
        else if (typeof it.icon === 'string') icon = it.icon
      } catch {}
      let accel = it.accelerator || ''
      if (typeof accel !== 'string') accel = ''
      const sub = it.submenu ? this.serialize(it.submenu.items || it.submenu) : null
      out.push({
        id,
        type: it.type === 'submenu' ? 'normal' : it.type || 'normal',
        label: it.label || roleLabel(it.role),
        enabled: it.enabled !== false,
        checked: !!it.checked,
        accel,
        icon,
        danger: !!it.danger,
        sub: sub && sub.length ? sub : null,
      })
    }
    return out
  }

  // menu: Electron Menu or array of MenuItems; x/y in window coordinates;
  // target: the webContents the menu is about (for roles like copy/paste)
  async show(menu, x, y, target) {
    const b = this.b
    if (!b?.win) return
    this.items.clear()
    const items = this.serialize(menu.items || menu)
    if (!items.length) return
    const v = this.ensure()
    await this.ready
    if (!b.win) return
    this.prevFocus = target && !target.isDestroyed() && target.isFocused() ? target : allWebContents.getFocusedWebContents()
    this.target = target || b.active()?.wc
    b.hidePopup?.()
    const { width, height } = b.win.getContentBounds()
    v.setBounds({ x: 0, y: 0, width, height })
    b.win.contentView.addChildView(v) // on top of everything
    v.setVisible(true)
    this.open = true
    v.webContents.send('menu:show', { items, x: Math.round(x), y: Math.round(y), vars: this.vars, noAnim: this.ctx.settings.data.animations === false })
    v.webContents.focus()
  }

  hide() {
    if (!this.open) return
    this.open = false
    this.view?.setVisible(false)
    const back = this.prevFocus
    this.prevFocus = null
    if (back && !back.isDestroyed()) back.focus()
  }

  run(item, target) {
    try {
      const win = this.b?.win
      const wc = target && !target.isDestroyed() ? target : this.b?.active()?.wc
      // Electron's own click handling: flips checkboxes and performs roles
      // (copy, paste...) on the webContents we pass
      if (typeof item.click === 'function') item.click({ triggeredByAccelerator: false }, win, wc)
    } catch (e) {
      console.error('[menu] item failed:', e.message)
    }
  }
}

const ROLE_LABELS = { undo: 'Undo', redo: 'Redo', cut: 'Cut', copy: 'Copy', paste: 'Paste', pasteAndMatchStyle: 'Paste as plain text', delete: 'Delete', selectAll: 'Select all', reload: 'Reload', toggleDevTools: 'Developer tools' }
const roleLabel = (r) => (r ? ROLE_LABELS[r] || r : '')

module.exports = { MenuView }
