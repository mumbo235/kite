// Developer helpers, enabled with environment variables:
//   KITE_DEBUG=1           forward UI / page console errors to the terminal
//   KITE_SHOT=/path/dir    save screenshots of the window after startup
//   KITE_SCRIPT=file.js    run a JS file of steps in main (for testing)
const fs = require('fs')
const path = require('path')

function setupDebug(ctx) {
  const b = ctx.browser
  if (process.env.KITE_DEBUG) {
    const hook = (wc, label) =>
      wc.on('console-message', (e) => {
        if (e.level === 'error' || e.level === 'warning' || process.env.KITE_DEBUG === '2') console.log(`[${label}:${e.level}] ${e.message} (${e.sourceId}:${e.lineNumber})`)
      })
    hook(b.ui.webContents, 'ui')
    require('electron').app.on('web-contents-created', (_e, wc) => hook(wc, 'wc' + wc.id))
  }
  if (process.env.KITE_SHOT || process.env.KITE_SCRIPT) {
    ctx.shot = async (name) => {
      const dir = process.env.KITE_SHOT || path.join(ctx.profileDir, 'shots')
      fs.mkdirSync(dir, { recursive: true })
      // Composite: UI view, then visible native views at their bounds.
      const ui = await b.ui.webContents.capturePage()
      const parts = [{ png: ui.toPNG(), x: 0, y: 0 }]
      const views = [...b.tabs.values()].filter((t) => t.view && t.view.getVisible()).map((t) => t.view)
      for (const v of b.panels.values()) if (v.getVisible()) views.push(v)
      if (!b.overlay) {
        for (const v of views) {
          const img = await v.webContents.capturePage()
          const r = v.getBounds()
          parts.push({ png: img.toPNG(), x: r.x, y: r.y, w: r.width, h: r.height })
        }
      }
      const out = path.join(dir, name)
      fs.mkdirSync(out, { recursive: true })
      parts.forEach((p, i) => fs.writeFileSync(path.join(out, `${i}.png`), p.png))
      fs.writeFileSync(path.join(out, 'layout.json'), JSON.stringify(parts.map(({ png, ...r }) => r)))
      return out
    }
  }
  if (process.env.KITE_SCRIPT) {
    const run = require(path.resolve(process.env.KITE_SCRIPT))
    b.ui.webContents.once('did-finish-load', () => setTimeout(() => run(ctx).catch((e) => console.error('script failed', e)), 1500))
  }
}

module.exports = { setupDebug }
