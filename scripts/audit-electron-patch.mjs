import fs from 'node:fs'

const file = 'electron/main.cjs'
function read() { return fs.readFileSync(file, 'utf8') }
function write(text) { fs.writeFileSync(file, text) }
function once(before, after) {
  const text = read()
  const count = text.split(before).length - 1
  if (count !== 1) throw new Error(`${file}: expected one match, found ${count}: ${before.slice(0, 120)}`)
  write(text.replace(before, after))
}

once(
  'let mainWindow, setupWindow, apiServer, backendServer\nlet diagnostics = null',
  `let mainWindow, setupWindow, apiServer, backendServer
let diagnostics = null
let appQuitting = false
let apiIntentionalStop = false
let apiRestartAttempts = 0
let backendRestartAttempts = 0
let meetingPollBusy = false`,
)

once(
`function diag(component, event, fields = {}, level = 'info') {
  try { diagnostics?.event(component, event, fields, level) } catch {}
}`,
`function diag(component, event, fields = {}, level = 'info') {
  try { diagnostics?.event(component, event, fields, level) } catch {}
}

const EXTERNAL_HOSTS = new Set([
  'github.com', 'stripe.com', 'openai.com', 'platform.openai.com', 'anthropic.com', 'console.anthropic.com',
  'google.com', 'aistudio.google.com', 'ai.google.dev', 'groq.com', 'console.groq.com',
  'cerebras.ai', 'cloud.cerebras.ai', 'deepgram.com', 'console.deepgram.com',
])
function externalUrlAllowed(raw) {
  try {
    const u = new URL(String(raw || ''))
    if (u.protocol !== 'https:') return false
    const host = u.hostname.toLowerCase()
    return [...EXTERNAL_HOSTS].some(allowed => host === allowed || host.endsWith('.' + allowed))
  } catch { return false }
}
function openAllowedExternal(raw) {
  if (!externalUrlAllowed(raw)) return false
  shell.openExternal(raw)
  return true
}`,
)

once(
`  apiServer.on('error', e => console.error('[API] fork error:', e.message))

  let done = false`,
`  apiServer.on('error', e => console.error('[API] fork error:', e.message))

  let done = false
  apiServer.on('exit', (code, signal) => {
    const wasReady = done
    apiServer = null
    if (appQuitting) return
    if (apiIntentionalStop) { apiIntentionalStop = false; return }
    if (!wasReady) return
    apiRestartAttempts += 1
    diag('api', 'child_exited', { code: code ?? 0, signal: signal || '', restartAttempt: apiRestartAttempts }, 'error')
    if (apiRestartAttempts > 3) {
      dialog.showErrorBox('MockMate AI service stopped', 'The local AI service crashed repeatedly. Restart MockMate to recover.')
      return
    }
    const delay = Math.min(4000, 500 * apiRestartAttempts)
    setTimeout(() => {
      if (appQuitting || apiServer) return
      startApiServer(() => {
        apiRestartAttempts = 0
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.loadURL(PROD_URL)
      })
    }, delay)
  })
`,
)

once(
`    backendServer.on('exit', code => {
      if (code) console.error('[backend] exited with code', code)
      if (!settled) finish(reject, new Error(\`auth backend exited before ready (\${code ?? 'unknown'})\`))
    })`,
`    backendServer.on('exit', code => {
      if (code) console.error('[backend] exited with code', code)
      backendServer = null
      if (!settled) { finish(reject, new Error(\`auth backend exited before ready (\${code ?? 'unknown'})\`)); return }
      if (appQuitting) return
      backendRestartAttempts += 1
      diag('backend', 'child_exited', { code: code ?? 0, restartAttempt: backendRestartAttempts }, 'error')
      if (backendRestartAttempts > 3) {
        dialog.showErrorBox('MockMate account service stopped', 'The local account service crashed repeatedly. Interviews can continue in BYOK mode; restart MockMate to restore sign-in.')
        return
      }
      setTimeout(() => {
        if (appQuitting || backendServer) return
        startBackend().then(() => { backendRestartAttempts = 0; diag('backend', 'restarted') }).catch(e => diag('backend', 'restart_failed', { message: e.message }, 'error'))
      }, Math.min(4000, 500 * backendRestartAttempts))
    })`,
)

once(
`  setupWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) shell.openExternal(url)
    return { action: 'deny' }
  })`,
`  setupWindow.webContents.setWindowOpenHandler(({ url }) => {
    openAllowedExternal(url)
    return { action: 'deny' }
  })`,
)

once(
`  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })`,
`  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openAllowedExternal(url)
    return { action: 'deny' }
  })`,
)

once(
`    if (/^https?:\/\//.test(url) && !sameOrigin) { e.preventDefault(); shell.openExternal(url) }`,
`    if (/^https?:\/\//.test(url) && !sameOrigin) { e.preventDefault(); openAllowedExternal(url) }`,
)

once(
`  globalShortcut.register('Alt+H', stealthOrToggle)
  globalShortcut.register('CommandOrControl+Shift+H', stealthOrToggle)`,
`  const registerShortcut = (accelerator, handler) => {
    let ok = false
    try { ok = globalShortcut.register(accelerator, handler) } catch {}
    if (!ok) diag('shortcut', 'registration_failed', { accelerator }, 'warn')
    return ok
  }
  registerShortcut('Alt+H', stealthOrToggle)
  registerShortcut('CommandOrControl+Shift+H', stealthOrToggle)`,
)
once("  globalShortcut.register('Alt+C', () => {", "  registerShortcut('Alt+C', () => {")
once("  globalShortcut.register('CommandOrControl+Shift+U', captureScreen)\n  try { globalShortcut.register('F7', captureScreen) } catch {}", "  registerShortcut('CommandOrControl+Shift+U', captureScreen)\n  registerShortcut('F7', captureScreen)")

once(
`app.on('browser-window-created', (_, win) => {
  try { win.setContentProtection(false) } catch {}
})`,
`app.on('browser-window-created', (_, win) => {
  // Privacy-safe default: no newly-created MockMate window gets a capturable first frame.
  // Individual normal windows can explicitly opt out later when the user disables protection.
  try { win.setContentProtection(process.platform !== 'linux') } catch {}
})`,
)

once(
`ipcMain.handle('install-update', () => {
  if (!autoUpdaterRef) return { ok: false, error: 'Updater is unavailable.' }
  try { autoUpdaterRef.quitAndInstall(); return { ok: true } }`,
`ipcMain.handle('install-update', () => {
  if (!autoUpdaterRef) return { ok: false, error: 'Updater is unavailable.' }
  if (lastWindowMode === 'overlay' || lastWindowMode === 'pill') {
    return { ok: false, error: 'End the active interview and return Home before installing the update.' }
  }
  try { autoUpdaterRef.quitAndInstall(); return { ok: true } }`,
)

once(
`app.on('will-quit', () => {
  diag('app', 'will_quit')
  try { diagnostics?.flush() } catch {}
  globalShortcut.unregisterAll()
  try { apiServer?.kill('SIGKILL') } catch {}
  try { backendServer?.kill('SIGKILL') } catch {}
  try { copilotWindow?.destroy() } catch {}
})`,
`app.on('will-quit', () => {
  appQuitting = true
  diag('app', 'will_quit')
  try { diagnostics?.flushSync?.() } catch {}
  globalShortcut.unregisterAll()
  // Give children their normal shutdown handlers; never hard-kill persistence/provider work on
  // an ordinary app quit/update. The OS will clean up only if a child ignores termination.
  try { apiServer?.kill('SIGTERM') } catch {}
  try { backendServer?.kill('SIGTERM') } catch {}
  try { copilotWindow?.destroy() } catch {}
})`,
)

once(
`if (process.platform !== 'linux') setInterval(async () => {
  if (!mainWindow || mainWindow.isDestroyed()) return
  try {`,
`if (process.platform !== 'linux') setInterval(async () => {
  if (!mainWindow || mainWindow.isDestroyed() || meetingPollBusy) return
  meetingPollBusy = true
  try {`,
)
once(
`    if (coding !== codingWasActive) { codingWasActive = coding; mainWindow.webContents.send('coding-detected', coding) }
  } catch {}
}, 3000)`,
`    if (coding !== codingWasActive) { codingWasActive = coding; mainWindow.webContents.send('coding-detected', coding) }
  } catch {}
  finally { meetingPollBusy = false }
}, 3000)`,
)

once(
`    const owner = BrowserWindow.getFocusedWindow() || BrowserWindow.fromWebContents(e.sender)
    owner?.setContentProtection(true)`,
`    const senderWindow = BrowserWindow.fromWebContents(e.sender)
    const focused = BrowserWindow.getFocusedWindow()
    // Prefer a focused auxiliary MockMate window (e.g. PiP) only when it is not one of the known
    // chrome windows; otherwise protect the IPC sender. Never blindly protect whichever app window
    // happened to gain focus during the IPC hop.
    const owner = focused && focused !== mainWindow && focused !== setupWindow && focused !== copilotWindow
      ? focused : senderWindow
    owner?.setContentProtection(true)`,
)

once(
`  } else if (apiServer) {
    // Prod: forked server read its env at fork time — restart it to pick up new keys.
    try { apiServer.kill() } catch {}
    apiServer = null`,
`  } else if (apiServer) {
    // Prod: forked server read its env at fork time — restart it to pick up new keys.
    apiIntentionalStop = true
    try { apiServer.kill('SIGTERM') } catch {}
    apiServer = null`,
)

once(
`const ALLOWED_EXTERNAL = /^https:\/\/([a-z0-9-]+\.)*(stripe\.com|github\.com)\//i
ipcMain.handle('open-external', (_e, url) => { if (typeof url === 'string' && ALLOWED_EXTERNAL.test(url)) shell.openExternal(url); return { ok: true } })`,
`ipcMain.handle('open-external', (_e, url) => {
  const ok = typeof url === 'string' && openAllowedExternal(url)
  return ok ? { ok: true } : { ok: false, error: 'External URL is not allowlisted.' }
})`,
)

console.log('electron audit patch complete')
