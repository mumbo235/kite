// Performance monitor + limiter.
// - Measures CPU and RAM of every Kite process once a second.
// - RAM limit: when Kite uses more than the limit, the least-recently-used
//   background tabs are put to sleep (their memory is freed; they reload when
//   you open them again).
// - CPU limit: background tabs get a lower OS priority, and when Kite stays
//   over the limit the busiest background tab is frozen (Chrome's page
//   freezing: JavaScript pauses, the page keeps its state).
// - Auto-sleep: tabs you haven't looked at for a while go to sleep.
const { app } = require('electron')
const os = require('os')

// A view's webContents disappears once the window has closed
const dead = (v) => !v || !v.webContents || v.webContents.isDestroyed()

const HISTORY = 60

class Performance {
  constructor(ctx) {
    this.ctx = ctx
    this.cores = os.cpus().length || 1
    this.cpuHist = []
    this.memHist = []
    this.overCpu = 0
    this.watchers = 0
    this.lastAction = ''
    this.niced = new Map() // pid -> priority we set
    this.timer = setInterval(() => this.tick(), 1000)
  }

  get cfg() {
    return { ramLimitMB: 0, cpuLimit: 100, sleepAfterMin: 0, ...(this.ctx.settings.data.perf || {}) }
  }

  get b() {
    return this.ctx.browser
  }

  tabsByPid() {
    const map = new Map()
    for (const t of this.b?.tabs.values() || []) {
      if (!t.wc || t.wc.isDestroyed()) continue
      const pid = t.wc.getOSProcessId()
      if (!map.has(pid)) map.set(pid, [])
      map.get(pid).push(t)
    }
    return map
  }

  sample() {
    const metrics = app.getAppMetrics()
    const byPid = this.tabsByPid()
    const panelPids = new Map()
    for (const [key, v] of this.b?.panels || []) if (!dead(v)) panelPids.set(v.webContents.getOSProcessId(), key)
    let cpu = 0
    let mem = 0
    const tabs = new Map() // tab id -> { cpu, mem }
    const panels = []
    let browserMem = 0
    let browserCpu = 0
    for (const m of metrics) {
      const c = m.cpu?.percentCPUUsage || 0
      const kb = m.memory?.workingSetSize || 0
      cpu += c
      mem += kb
      const owners = byPid.get(m.pid)
      if (owners) {
        // processes can be shared; split evenly
        for (const t of owners) tabs.set(t.id, { cpu: c / owners.length, mem: kb / owners.length, pid: m.pid })
      } else if (panelPids.has(m.pid)) panels.push({ key: panelPids.get(m.pid), cpu: c, mem: kb })
      else {
        browserMem += kb
        browserCpu += c
      }
    }
    return { cpu: cpu / this.cores, cpuRaw: cpu, mem: mem / 1024, tabs, panels, browser: { cpu: browserCpu / this.cores, mem: browserMem / 1024 } }
  }

  tick() {
    if (!this.b?.win) return
    // No limits set and the panel closed: nothing needs measuring. (Run one
    // last time after limits are switched off, to undo lowered priorities.)
    const c = this.cfg
    const active = this.watchers > 0 || c.ramLimitMB > 0 || c.cpuLimit < 100 || c.sleepAfterMin > 0
    if (!active && !this.wasActive) return
    this.wasActive = active
    let s
    try {
      s = this.sample()
    } catch {
      return
    }
    this.last = s
    this.cpuHist.push(Math.round(s.cpu * 10) / 10)
    this.memHist.push(Math.round(s.mem))
    if (this.cpuHist.length > HISTORY) this.cpuHist.shift()
    if (this.memHist.length > HISTORY) this.memHist.shift()
    this.enforce(s)
    if (this.watchers > 0) this.b.emit('perf', this.snapshot())
  }

  background() {
    const b = this.b
    return [...b.tabs.values()].filter((t) => t.view && t.id !== b.activeId && !t.audible && !(t.wc && !t.wc.isDestroyed() && t.wc.isCurrentlyAudible()))
  }

  enforce(s) {
    const cfg = this.cfg
    const b = this.b
    const now = Date.now()

    // auto-sleep tabs you haven't looked at in a while
    if (cfg.sleepAfterMin > 0) {
      for (const t of this.background()) {
        if (now - (t.lastActive || now) > cfg.sleepAfterMin * 60000) {
          b.sleep(t.id)
          this.note(`Put “${short(t.title)}” to sleep (inactive)`)
        }
      }
    }

    // RAM limit: sleep least-recently-used background tabs until under it
    if (cfg.ramLimitMB > 0 && s.mem > cfg.ramLimitMB) {
      const victim = this.background().sort((a, z) => (a.lastActive || 0) - (z.lastActive || 0))[0]
      if (victim) {
        b.sleep(victim.id)
        this.note(`RAM over limit: put “${short(victim.title)}” to sleep`)
      }
    }

    // CPU limit: lower priority of background tabs; freeze the busiest if needed
    const limited = cfg.cpuLimit < 100
    // Lower background priority only where it can be undone: on Linux and
    // macOS a normal program can't raise a process's priority back, so a tab
    // would stay slow even after you switch to it.
    const canRestore = process.platform === 'win32'
    const nice = limited && canRestore ? Math.round(((100 - cfg.cpuLimit) / 90) * 15) : 0
    const activePid = b.active()?.wc && !b.active().wc.isDestroyed() ? b.active().wc.getOSProcessId() : null
    for (const [, info] of s.tabs) {
      const want = info.pid === activePid ? 0 : nice
      if ((this.niced.get(info.pid) || 0) !== want) {
        try {
          os.setPriority(info.pid, want)
          this.niced.set(info.pid, want)
        } catch {}
      }
    }
    if (limited && s.cpu > cfg.cpuLimit) this.overCpu++
    else this.overCpu = 0
    if (this.overCpu >= 3) {
      this.overCpu = 0
      const busiest = this.background()
        .filter((t) => !t.frozen)
        .map((t) => ({ t, cpu: s.tabs.get(t.id)?.cpu || 0 }))
        .sort((a, z) => z.cpu - a.cpu)[0]
      if (busiest && busiest.cpu > 1) {
        this.freeze(busiest.t, true)
        this.note(`CPU over limit: froze “${short(busiest.t.title)}”`)
      }
    }
    // limit lifted: undo only the freezes the limiter made (not manual ones)
    if (!limited) for (const t of b.tabs.values()) if (t.frozen && t.autoFrozen) this.unfreeze(t)
  }

  // A tab you switch to gets full CPU priority right away (instead of on the
  // next once-a-second check), so it never feels sluggish.
  boost(tab) {
    try {
      if (!tab?.wc || tab.wc.isDestroyed()) return
      const pid = tab.wc.getOSProcessId()
      if ((this.niced.get(pid) || 0) !== 0) {
        os.setPriority(pid, 0)
        this.niced.set(pid, 0)
      }
    } catch {}
  }

  note(text) {
    this.lastAction = text
    this.lastActionAt = Date.now()
  }

  async freeze(tab, auto = false) {
    const wc = tab.wc
    if (!wc || wc.isDestroyed() || tab.frozen) return
    try {
      if (!wc.debugger.isAttached()) wc.debugger.attach('1.3')
      await wc.debugger.sendCommand('Page.setWebLifecycleState', { state: 'frozen' })
      tab.frozen = true
      tab.autoFrozen = auto
      this.b.emitTabs()
    } catch {
      // DevTools open or page refuses: fall back to sleeping it
      this.b.sleep(tab.id)
    }
  }

  async unfreeze(tab) {
    const wc = tab.wc
    tab.frozen = false
    tab.autoFrozen = false
    if (!wc || wc.isDestroyed()) return
    try {
      // (stay attached: the browser-identity override lives on this connection)
      await wc.debugger.sendCommand('Page.setWebLifecycleState', { state: 'active' })
    } catch {}
    this.b.emitTabs()
  }

  snapshot() {
    const s = this.last || { cpu: 0, mem: 0, tabs: new Map(), panels: [], browser: { cpu: 0, mem: 0 } }
    const b = this.b
    const rows = []
    for (const t of b.tabs.values()) {
      const m = s.tabs.get(t.id)
      rows.push({
        id: t.id,
        title: t.title || t.url,
        url: t.wc && !t.wc.isDestroyed() ? t.wc.getURL() : t.url,
        cpu: m ? Math.round((m.cpu / this.cores) * 10) / 10 : 0,
        mem: m ? Math.round(m.mem / 1024) : 0,
        state: !t.view ? 'sleeping' : t.frozen ? 'frozen' : t.id === b.activeId ? 'active' : 'awake',
      })
    }
    rows.sort((a, z) => z.mem - a.mem)
    const panels = s.panels.map((p) => ({ key: p.key, mem: Math.round(p.mem / 1024), cpu: Math.round((p.cpu / this.cores) * 10) / 10 }))
    return {
      cpu: Math.round(s.cpu * 10) / 10,
      mem: Math.round(s.mem),
      totalMem: Math.round(os.totalmem() / 1048576),
      cores: this.cores,
      cpuHist: this.cpuHist,
      memHist: this.memHist,
      tabs: rows,
      panels,
      browser: { cpu: Math.round(s.browser.cpu * 10) / 10, mem: Math.round(s.browser.mem) },
      lastAction: this.lastActionAt && Date.now() - this.lastActionAt < 15000 ? this.lastAction : '',
      cfg: this.cfg,
    }
  }

  watch(on) {
    this.watchers = Math.max(0, this.watchers + (on ? 1 : -1))
    return this.snapshot()
  }
}

const short = (s) => (s || '').slice(0, 40)

module.exports = { Performance }
