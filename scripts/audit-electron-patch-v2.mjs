import fs from 'node:fs'

const file = 'electron/main.cjs'
let text = fs.readFileSync(file, 'utf8')
function sub(re, replacement, label) {
  const matches = [...text.matchAll(new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g'))]
  if (matches.length !== 1) throw new Error(`${label}: expected one match, found ${matches.length}`)
  text = text.replace(re, () => replacement)
}

sub(/let mainWindow, setupWindow, apiServer, backendServer\nlet diagnostics = null/, `let mainWindow, setupWindow, apiServer, backendServer
let diagnostics = null
let appQuitting = false
let apiIntentionalStop = false
let apiRestartAttempts = 0
let backendRestartAttempts = 0
let meetingPollBusy = false`, 'lifecycle globals')

sub(/function diag\(component, event, fields = \{\}, level = 'info'\) \{\n  try \{ diagnostics\?\.event\(component, event, fields, level\) \} catch \{\}\n\}/, `function diag(component, event, fields = {}, level = 'info') {
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
}`, 'external helper')

sub(/  apiServer\.on\('error', e => console\.error\('\[API\] fork error:', e\.message\)\)\n\n  let done = false/, `  apiServer.on('error', e => console.error('[API] fork error:', e.message))

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
    setTimeout(() => {
      if (appQuitting || apiServer) return
      startApiServer(() => {
        apiRestartAttempts = 0
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.loadURL(PROD_URL)
      })
    }, Math.min(4000, 500 * apiRestartAttempts))
  })`, 'api child supervision')

sub(/    backendServer\.on\('exit', code => \{\n      if \(code\) console\.error\('\[backend\] exited with code', code\)\n      if \(!settled\) finish\(reject, new Error\(`auth backend exited before ready \(\$\{code \?\? 'unknown'\}\)`\)\)\n    \}\)/, `    backendServer.on('exit', code => {
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
    })`, 'backend child supervision')

sub(/  setupWindow\.webContents\.setWindowOpenHandler\(\(\{ url \}\) => \{\n    if \(url\.startsWith\('http'\)\) shell\.openExternal\(url\)\n    return \{ action: 'deny' \}\n  \}\)/, `  setupWindow.webContents.setWindowOpenHandler(({ url }) => {
    openAllowedExternal(url)
    return { action: 'deny' }
  })`, 'setup external links')

sub(/  mainWindow\.webContents\.setWindowOpenHandler\(\(\{ url \}\) => \{\n    if \(\/\^https\?:\\\/\\\/\/\.test\(url\)\) shell\.openExternal\(url\)\n    return \{ action: 'deny' \}\n  \}\)/, `  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openAllowedExternal(url)
    return { action: 'deny' }
  })`, 'window.open external links')

sub(/    if \(\/\^https\?:\\\/\\\/\/\.test\(url\) && !sameOrigin\) \{ e\.preventDefault\(\); shell\.openExternal\(url\) \}/, `    if (/^https?:\\/\\//.test(url) && !sameOrigin) { e.preventDefault(); openAllowedExternal(url) }`, 'navigation external links')

sub(/  globalShortcut\.register\('Alt\+H', stealthOrToggle\)\n  globalShortcut\.register\('CommandOrControl\+Shift\+H', stealthOrToggle\)/, `  const registerShortcut = (accelerator, handler) => {
    let ok = false
    try { ok = globalShortcut.register(accelerator, handler) } catch {}
    if (!ok) diag('shortcut', 'registration_failed', { accelerator }, 'warn')
    return ok
  }
  registerShortcut('Alt+H', stealthOrToggle)
  registerShortcut('CommandOrControl+Shift+H', stealthOrToggle)`, 'shortcut registration helper')
text = text.replace("  globalShortcut.register('Alt+C', () => {", "  registerShortcut('Alt+C', () => {")
text = text.replace("  globalShortcut.register('CommandOrControl+Shift+U', captureScreen)\n  try { globalShortcut.register('F7', captureScreen) } catch {}", "  registerShortcut('CommandOrControl+Shift+U', captureScreen)\n  registerShortcut('F7', captureScreen)")

sub(/app\.on\('browser-window-created', \(_, win\) => \{\n  try \{ win\.setContentProtection\(false\) \} catch \{\}\n\}\)/, `app.on('browser-window-created', (_, win) => {
  try { win.setContentProtection(process.platform !== 'linux') } catch {}
})`, 'new-window protection')

sub(/ipcMain\.handle\('install-update', \(\) => \{\n  if \(!autoUpdaterRef\) return \{ ok: false, error: 'Updater is unavailable\.' \}\n  try \{ autoUpdaterRef\.quitAndInstall\(\); return \{ ok: true \} \}/, `ipcMain.handle('install-update', () => {
  if (!autoUpdaterRef) return { ok: false, error: 'Updater is unavailable.' }
  if (lastWindowMode === 'overlay' || lastWindowMode === 'pill') return { ok: false, error: 'End the active interview and return Home before installing the update.' }
  try { autoUpdaterRef.quitAndInstall(); return { ok: true } }`, 'update active-session guard')

sub(/app\.on\('will-quit', \(\) => \{\n  diag\('app', 'will_quit'\)\n  try \{ diagnostics\?\.flush\(\) \} catch \{\}\n  globalShortcut\.unregisterAll\(\)\n  try \{ apiServer\?\.kill\('SIGKILL'\) \} catch \{\}\n  try \{ backendServer\?\.kill\('SIGKILL'\) \} catch \{\}\n  try \{ copilotWindow\?\.destroy\(\) \} catch \{\}\n\}\)/, `app.on('will-quit', () => {
  appQuitting = true
  diag('app', 'will_quit')
  try { diagnostics?.flushSync?.() } catch {}
  globalShortcut.unregisterAll()
  try { apiServer?.kill('SIGTERM') } catch {}
  try { backendServer?.kill('SIGTERM') } catch {}
  try { copilotWindow?.destroy() } catch {}
})`, 'graceful child shutdown')

sub(/if \(process\.platform !== 'linux'\) setInterval\(async \(\) => \{\n  if \(!mainWindow \|\| mainWindow\.isDestroyed\(\)\) return\n  try \{/, `if (process.platform !== 'linux') setInterval(async () => {
  if (!mainWindow || mainWindow.isDestroyed() || meetingPollBusy) return
  meetingPollBusy = true
  try {`, 'poll single flight')
sub(/    if \(coding !== codingWasActive\) \{ codingWasActive = coding; mainWindow\.webContents\.send\('coding-detected', coding\) \}\n  \} catch \{\}\n\}, 3000\)/, `    if (coding !== codingWasActive) { codingWasActive = coding; mainWindow.webContents.send('coding-detected', coding) }
  } catch {}
  finally { meetingPollBusy = false }
}, 3000)`, 'poll release')

sub(/    const owner = BrowserWindow\.getFocusedWindow\(\) \|\| BrowserWindow\.fromWebContents\(e\.sender\)\n    owner\?\.setContentProtection\(true\)/, `    const senderWindow = BrowserWindow.fromWebContents(e.sender)
    const focused = BrowserWindow.getFocusedWindow()
    const owner = focused && focused !== mainWindow && focused !== setupWindow && focused !== copilotWindow ? focused : senderWindow
    owner?.setContentProtection(true)`, 'capture target')

sub(/  \} else if \(apiServer\) \{\n    \/\/ Prod: forked server read its env at fork time — restart it to pick up new keys\.\n    try \{ apiServer\.kill\(\) \} catch \{\}\n    apiServer = null/, `  } else if (apiServer) {
    // Prod: forked server read its env at fork time — restart it to pick up new keys.
    apiIntentionalStop = true
    try { apiServer.kill('SIGTERM') } catch {}
    apiServer = null`, 'intentional api restart')

sub(/const ALLOWED_EXTERNAL = [^\n]+\nipcMain\.handle\('open-external', \(_e, url\) => \{[^\n]+\}\)/, `ipcMain.handle('open-external', (_e, url) => {
  const ok = typeof url === 'string' && openAllowedExternal(url)
  return ok ? { ok: true } : { ok: false, error: 'External URL is not allowlisted.' }
})`, 'ipc external links')

fs.writeFileSync(file, text)
console.log('electron audit patch complete')
