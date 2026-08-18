/* Disposable JavaScript runner. It has no DOM and MockMate terminates it after a short deadline. */
const deny = name => {
  try { Object.defineProperty(self, name, { value: undefined, writable: false, configurable: false }) } catch {}
}
for (const name of ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'importScripts', 'indexedDB', 'caches']) deny(name)

self.onmessage = async event => {
  const { id, code } = event.data || {}
  const logs = []
  const safeConsole = {}
  for (const method of ['log', 'info', 'warn', 'error']) {
    safeConsole[method] = (...args) => logs.push(args.map(value => {
      try { return typeof value === 'string' ? value : JSON.stringify(value) } catch { return String(value) }
    }).join(' '))
  }
  try {
    const fn = new Function('console', `"use strict";\n${String(code || '')}`)
    const result = await fn(safeConsole)
    self.postMessage({ id, ok: true, logs: logs.slice(0, 40), result: result === undefined ? null : String(result).slice(0, 1000) })
  } catch (error) {
    self.postMessage({ id, ok: false, logs: logs.slice(0, 40), error: String(error?.stack || error).slice(0, 1600) })
  }
}
