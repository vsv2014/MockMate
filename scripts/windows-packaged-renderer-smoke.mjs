// Verify that the *packaged Electron Chromium renderer* boots the compiled
// React/Vite app. Service readiness alone does not catch a blank UI, missing
// renderer chunks, preload/IPC failure or a React ErrorBoundary crash.
//
// This script only connects to the temporary loopback DevTools endpoint that
// windows-packaged-smoke.ps1 enables for the CI validation process.
const debuggerUrl = process.env.MOCKMATE_SMOKE_CDP_URL || 'http://127.0.0.1:9228'
const rendererOrigins = new Set(['http://localhost:3002', 'http://127.0.0.1:3002'])
const deadline = Date.now() + 30_000

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

async function getRendererTarget() {
  const res = await fetch(debuggerUrl + '/json/list', { signal: AbortSignal.timeout(2_000) })
  if (!res.ok) throw new Error('DevTools target discovery returned HTTP ' + res.status)
  const targets = await res.json()
  return targets.find(t => (
    t.type === 'page' && typeof t.webSocketDebuggerUrl === 'string'
    && rendererOrigins.has((() => { try { return new URL(t.url).origin } catch { return '' } })())
  ))
}

async function evaluate(target, expression) {
  return new Promise((resolve, reject) => {
    let settled = false
    let timer
    let ws
    const complete = (error, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try { ws?.close() } catch {}
      if (error) reject(error)
      else resolve(value)
    }
    timer = setTimeout(() => complete(new Error('DevTools evaluation timed out')), 5_000)
    try {
      ws = new WebSocket(target.webSocketDebuggerUrl)
      ws.addEventListener('error', () => complete(new Error('Cannot connect to packaged Electron renderer DevTools')))
      ws.addEventListener('open', () => {
        ws.send(JSON.stringify({
          id: 1,
          method: 'Runtime.evaluate',
          params: { expression, returnByValue: true, awaitPromise: true },
        }))
      })
      ws.addEventListener('message', ({ data }) => {
        let msg
        try { msg = JSON.parse(String(data)) } catch { return }
        if (msg.id !== 1) return
        if (msg.error || msg.result?.exceptionDetails) {
          complete(new Error('Renderer evaluation failed: ' + JSON.stringify(msg.error || msg.result.exceptionDetails)))
          return
        }
        complete(null, msg.result?.result?.value)
      })
    } catch (e) {
      complete(e)
    }
  })
}

let mostRecent = 'renderer not discovered'
while (Date.now() < deadline) {
  try {
    const target = await getRendererTarget()
    if (!target) throw new Error('No main app renderer target at ' + [...rendererOrigins].join(' or '))
    const state = await evaluate(target, `(() => {
      const root = document.getElementById('root')
      const visibleText = (root?.innerText || '').trim()
      return {
        readyState: document.readyState,
        reactMounted: Boolean(root && root.childElementCount > 0),
        hasRealContent: visibleText.length >= 12,
        hasElectronBridge: window.electronAPI?.isElectron === true,
        hasErrorBoundary: visibleText.includes('Something broke'),
        hasChunk: [...document.scripts].some(s => s.type === 'module' && /assets\\/.+\\.js/.test(s.src)),
        title: document.title,
        contentChars: visibleText.length,
      }
    })()`)
    if (state?.hasErrorBoundary) throw new Error('React ErrorBoundary is showing: ' + JSON.stringify(state))
    if (
      state?.readyState === 'complete'
      && state.reactMounted && state.hasRealContent
      && state.hasElectronBridge && state.hasChunk
    ) {
      // React 19 event handlers must work too, not just paint static HTML.
      // The CI runner uses a fresh profile, so its initial auth screen is the
      // Welcome view (or Login if a profile somehow already exists).
      const action = await evaluate(target, `(() => {
        if (document.getElementById('mm-email') && document.getElementById('mm-password')) {
          return 'login-already-visible'
        }
        const signIn = [...document.querySelectorAll('button')]
          .find(b => /^Sign in$/i.test((b.textContent || '').trim()))
        if (!signIn) return 'sign-in-button-missing'
        signIn.click()
        return 'sign-in-clicked'
      })()`)
      if (action === 'sign-in-button-missing') {
        throw new Error('Packaged auth view has no usable Sign in control')
      }
      if (action === 'sign-in-clicked') {
        let loginMounted = false
        for (let i = 0; i < 20; i += 1) {
          const login = await evaluate(target, `Boolean(
            document.getElementById('mm-email')
            && document.getElementById('mm-password')
          )`)
          if (login) { loginMounted = true; break }
          await sleep(250)
        }
        if (!loginMounted) throw new Error('React 19 button handler failed to render Login form')
      }
      console.log('Packaged Electron/React renderer and auth navigation smoke passed:', JSON.stringify({ ...state, authNavigation: action }))
      process.exit(0)
    }
    mostRecent = JSON.stringify(state)
  } catch (e) {
    mostRecent = e?.message || String(e)
  }
  await sleep(500)
}
console.error('Packaged Electron/React renderer smoke FAILED:', mostRecent)
process.exit(1)
