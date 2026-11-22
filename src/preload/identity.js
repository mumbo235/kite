// Runs in every web page. Real Chrome exposes window.chrome.loadTimes/csi/app;
// Electron doesn't, which sites (notably Google sign-in) use to flag embedded
// browsers. Add the same shape in the page's own JavaScript world.
const { contextBridge } = require('electron')

function shape() {
  if (window.chrome && window.chrome.loadTimes) return
  const nav = () => performance.getEntriesByType('navigation')[0] || {}
  const native = (f, name) => {
    Object.defineProperty(f, 'toString', { value: () => `function ${name}() { [native code] }` })
    return f
  }
  const c = window.chrome || {}
  c.loadTimes = native(function loadTimes() {
    const n = nav()
    const t = performance.timeOrigin / 1000
    return {
      requestTime: t,
      startLoadTime: t,
      commitLoadTime: t + (n.responseStart || 0) / 1000,
      finishDocumentLoadTime: t + (n.domContentLoadedEventEnd || 0) / 1000,
      finishLoadTime: t + (n.loadEventEnd || 0) / 1000,
      firstPaintTime: t,
      firstPaintAfterLoadTime: 0,
      navigationType: 'Other',
      wasFetchedViaSpdy: true,
      wasNpnNegotiated: true,
      npnNegotiatedProtocol: 'h2',
      wasAlternateProtocolAvailable: false,
      connectionInfo: 'h2',
    }
  }, 'loadTimes')
  c.csi = native(function csi() {
    const n = nav()
    return { startE: Math.round(performance.timeOrigin), onloadT: Math.round(performance.timeOrigin + (n.loadEventEnd || 0)), pageT: performance.now(), tran: 15 }
  }, 'csi')
  c.app = {
    isInstalled: false,
    InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' },
    RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' },
    getDetails: native(function getDetails() { return null }, 'getDetails'),
    getIsInstalled: native(function getIsInstalled() { return false }, 'getIsInstalled'),
    installState: native(function installState(cb) { cb && cb('not_installed') }, 'installState'),
    runningState: native(function runningState() { return 'cannot_run' }, 'runningState'),
  }
  window.chrome = c
}

if (location.protocol === 'https:' || location.protocol === 'http:') {
  try {
    contextBridge.executeInMainWorld({ func: shape })
  } catch {
    require('electron').webFrame.executeJavaScript(`(${shape})()`)
  }
}
