export function canRunLanguage(language = '') {
  return /^(javascript|js|node|nodejs)$/i.test(String(language).trim())
}

export function runJavaScriptIsolated(code, { timeoutMs = 1500 } = {}) {
  return new Promise(resolve => {
    if (typeof Worker === 'undefined') return resolve({ ok: false, error: 'Isolated runner unavailable' })
    const worker = new Worker('/code-runner-worker.js')
    const id = `run_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
    let done = false
    const finish = result => {
      if (done) return
      done = true
      clearTimeout(timer)
      worker.terminate()
      resolve(result)
    }
    const timer = setTimeout(() => finish({ ok: false, timeout: true, error: `Stopped after ${timeoutMs} ms` }), timeoutMs)
    worker.onmessage = event => {
      if (event.data?.id === id) finish(event.data)
    }
    worker.onerror = event => finish({ ok: false, error: event.message || 'Runner failed' })
    worker.postMessage({ id, code: String(code || '').slice(0, 30000) })
  })
}
