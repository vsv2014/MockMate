// MockMate Electron bootstrap.
// Installs narrow reliability/safety guards before loading the mature main-process runtime.
// Keep product behavior in main.cjs; this file owns process-wide invariants that must apply
// before main.cjs registers windows, IPC handlers, shortcuts, or child processes.
const electron = require('electron')
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const childProcess = require('child_process')

const { app, ipcMain, BrowserWindow, globalShortcut, dialog, shell, safeStorage, desktopCapturer } = electron
let appQuitting = false
app.on('before-quit', () => { appQuitting = true })

// ── Durable per-install auth secret ──────────────────────────────────────────
// main.cjs intentionally owns the secret's use. Bootstrap guarantees the file exists and is
// readable before main.cjs's app.whenReady callback starts the auth backend, so a failed disk
// write can never silently turn into a one-run ephemeral JWT secret.
app.whenReady().then(() => {
  const file = path.join(app.getPath('userData'), '.jwt-secret')
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8').trim().length < 64) {
      const tmp = `${file}.tmp-${process.pid}`
      fs.writeFileSync(tmp, crypto.randomBytes(48).toString('hex'), { mode: 0o600 })
      fs.renameSync(tmp, file)
    }
    const value = fs.readFileSync(file, 'utf8').trim()
    if (value.length < 64) throw new Error('JWT secret verification failed')
  } catch (error) {
    console.error('[bootstrap] JWT secret persistence failed:', error?.message)
    dialog.showErrorBox('MockMate could not start safely', 'MockMate could not persist its local sign-in secret. Check disk permissions/free space, then reopen the app.')
    app.quit()
  }
}).catch(() => {})

// ── Atomic encrypted BYOK file writes + last-known-good recovery ─────────────
const originalWriteFileSync = fs.writeFileSync.bind(fs)
const originalReadFileSync = fs.readFileSync.bind(fs)
const originalRenameSync = fs.renameSync.bind(fs)
const originalCopyFileSync = fs.copyFileSync.bind(fs)

function isEnvEnc(file) {
  try { return path.basename(String(file)) === '.env.enc' } catch { return false }
}
fs.writeFileSync = function hardenedWrite(file, data, options) {
  if (!isEnvEnc(file)) return originalWriteFileSync(file, data, options)
  const target = String(file)
  const tmp = `${target}.tmp-${process.pid}-${Date.now()}`
  const backup = `${target}.bak`
  originalWriteFileSync(tmp, data, options)
  try { if (fs.existsSync(target)) originalCopyFileSync(target, backup) } catch {}
  originalRenameSync(tmp, target)
}

const originalDecrypt = safeStorage.decryptString.bind(safeStorage)
safeStorage.decryptString = function decryptWithBackup(buffer) {
  try { return originalDecrypt(buffer) } catch (error) {
    try {
      const primary = path.join(app.getPath('userData'), '.env.enc')
      const backup = `${primary}.bak`
      if (fs.existsSync(primary) && fs.existsSync(backup)) {
        const current = originalReadFileSync(primary)
        if (Buffer.isBuffer(buffer) && current.equals(buffer)) {
          const recovered = originalDecrypt(originalReadFileSync(backup))
          console.warn('[bootstrap] recovered encrypted BYOK configuration from last-known-good backup')
          return recovered
        }
      }
    } catch {}
    throw error
  }
}

// ── External navigation policy (blast-radius review fix) ────────────────────
// main.cjs and renderer helpers all eventually call shell.openExternal. Policy is
// purpose-specific instead of one static business allowlist:
//   • KNOWN_SAFE_HOSTS — audited provider consoles / billing / updates.
//   • Any other VALIDATED URL (https; http only on loopback for local dev OAuth;
//     no embedded credentials; sane hostname and length) — covers user-initiated
//     destinations like the configured OAuth API base and job listing links
//     (Greenhouse, Lever, Workday, company ATS domains, …), which can never be
//     enumerated statically.
// Everything else is blocked. main.cjs reuses externalNavigationAllowed().
const KNOWN_SAFE_HOSTS = [
  'github.com', 'stripe.com', 'openai.com', 'platform.openai.com', 'anthropic.com',
  'console.anthropic.com', 'groq.com', 'console.groq.com', 'google.com', 'ai.google.dev',
  'aistudio.google.com', 'cerebras.ai', 'cloud.cerebras.ai', 'deepgram.com', 'console.deepgram.com',
]
function isLoopbackHost(host) { return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' }
function externalNavigationAllowed(raw) {
  try {
    const s = String(raw || '')
    if (!s || s.length > 2048) return false
    const u = new URL(s)
    if (u.username || u.password) return false
    const host = u.hostname.toLowerCase().replace(/\.$/, '')
    if (!host) return false
    if (u.protocol === 'http:') return isLoopbackHost(host)
    if (u.protocol !== 'https:') return false
    return true
  } catch { return false }
}
function externalKnownSafe(raw) {
  try {
    const host = new URL(String(raw)).hostname.toLowerCase().replace(/\.$/, '')
    return KNOWN_SAFE_HOSTS.some(root => host === root || host.endsWith(`.${root}`))
  } catch { return false }
}
const originalOpenExternal = shell.openExternal.bind(shell)
shell.openExternal = function guardedOpenExternal(url, options) {
  if (!externalNavigationAllowed(url)) {
    console.warn('[bootstrap] blocked external navigation:', String(url).slice(0, 180))
    return Promise.resolve(false)
  }
  if (!externalKnownSafe(url)) {
    console.info('[bootstrap] external navigation to non-audited host:', String(url).slice(0, 120))
  }
  return originalOpenExternal(url, options)
}
module.exports = { externalNavigationAllowed }

// ── Exact renderer configuration surface ────────────────────────────────────
const ENV_KEYS = new Set([
  'OPENAI_API_KEY','OPENAI_MODEL','OPENAI_GPT5_MODEL','OPENAI_MINI_MODEL','OPENAI_MAX_MODEL','OPENAI_BALANCED_MODEL','OPENAI_FAST_MODEL','OPENAI_EMBED_MODEL',
  'ANTHROPIC_API_KEY','ANTHROPIC_FABLE_MODEL','ANTHROPIC_OPUS_MODEL','ANTHROPIC_SONNET5_MODEL','ANTHROPIC_HAIKU_MODEL',
  'GEMINI_API_KEY','GEMINI_MODEL','GEMINI_3_MODEL','GEMINI_FLASH_LITE_MODEL','GEMINI_EMBED_MODEL',
  'GROQ_API_KEY','GROQ_MODEL','GROQ_VISION_MODEL','CEREBRAS_API_KEY','CEREBRAS_MODEL',
  'DEEPGRAM_API_KEY','VISION_API_KEY','VISION_MODEL','VISION_BASE_URL',
  'LLM_API_KEY','LLM_MODEL','LLM_BASE_URL','TAVILY_API_KEY','SERPER_API_KEY','ADZUNA_APP_ID','ADZUNA_APP_KEY',
])
function sanitizeEnvText(text) {
  const rows = []
  for (const raw of String(text || '').split(/\r?\n/)) {
    const i = raw.indexOf('=')
    if (i <= 0) continue
    const key = raw.slice(0, i).trim()
    if (!ENV_KEYS.has(key)) continue
    const value = raw.slice(i + 1).trim()
    if (value) rows.push(`${key}=${value}`)
  }
  return rows.join('\n') + (rows.length ? '\n' : '')
}

const originalHandle = ipcMain.handle.bind(ipcMain)
ipcMain.handle = function hardenedHandle(channel, handler) {
  if (channel === 'write-env') {
    return originalHandle(channel, (event, content) => handler(event, sanitizeEnvText(content)))
  }
  if (channel === 'exclude-from-capture') {
    // Round-5 review fix: this hardened handler intercepts the channel BEFORE any
    // later ipcMain.handle() call, so it must itself implement the PiP-aware
    // policy — a sender-only version here silently replaced the focused-window
    // logic in main.cjs and confirmed protection on the WRONG window. Document
    // PiP is normally the focused top-level window even though the IPC bridge
    // belongs to the opener's webContents, so protect the focused window first.
    // The response reports BOTH window ids so the renderer can verify the PiP
    // itself (not just the opener) was protected — no false-positive confirms.
    return originalHandle(channel, event => {
      if (process.platform === 'linux') return { ok: false, unsupported: true }
      try {
        const sender = BrowserWindow.fromWebContents(event.sender)
        const focused = BrowserWindow.getFocusedWindow()
        const owner = (focused && !focused.isDestroyed()) ? focused : sender
        if (!owner || owner.isDestroyed()) return { ok: false, error: 'Window owner unavailable' }
        owner.setContentProtection(true)
        return { ok: true, id: owner.id, senderId: sender && !sender.isDestroyed() ? sender.id : null }
      } catch (error) { return { ok: false, error: error?.message || 'Capture protection failed' } }
    })
  }
  return originalHandle(channel, handler)
}

// Every new Win/macOS window is protected synchronously before its first frame can be shown.
// The main window can still explicitly disable protection later when the user turns Stealth off.
app.on('browser-window-created', (_event, win) => {
  if (process.platform !== 'linux') {
    try { if (!win.isDestroyed()) win.setContentProtection(true) } catch {}
  } else {
    win.webContents?.once?.('did-finish-load', () => {
      // The Duo co-pilot is intentionally allowed on Linux, but Linux has no exclusion API.
      win.webContents.executeJavaScript(`(() => { const s=document.querySelector('.sub'); if(s && /invisible to screen capture/i.test(s.textContent||'')) s.textContent='visible to screen capture on Linux'; })()`).catch(() => {})
    })
  }
})

// ── Shortcut registration must fail visibly, never silently ─────────────────
const originalRegister = globalShortcut.register.bind(globalShortcut)
const shortcutFailures = new Set()
globalShortcut.register = function checkedRegister(accelerator, callback) {
  let ok = false
  try { ok = originalRegister(accelerator, callback) } catch {}
  if (!ok) {
    shortcutFailures.add(String(accelerator))
    console.warn('[bootstrap] global shortcut unavailable:', accelerator)
    app.whenReady().then(() => setTimeout(() => {
      if (!shortcutFailures.size || appQuitting) return
      const failed = [...shortcutFailures].join(', ')
      shortcutFailures.clear()
      dialog.showMessageBox({ type: 'warning', title: 'Some MockMate shortcuts are unavailable', message: `Another app is using: ${failed}`, detail: 'MockMate remains usable from its on-screen controls and tray.', buttons: ['OK'] }).catch(() => {})
    }, 200)).catch(() => {})
  }
  return ok
}

// ── Single-flight expensive desktop/window enumeration ──────────────────────
const originalGetSources = desktopCapturer.getSources.bind(desktopCapturer)
let windowSourcesInFlight = null
desktopCapturer.getSources = function singleFlightSources(options = {}) {
  const types = Array.isArray(options.types) ? options.types : []
  const windowOnly = types.length === 1 && types[0] === 'window'
  if (!windowOnly) return originalGetSources(options)
  if (windowSourcesInFlight) return windowSourcesInFlight
  windowSourcesInFlight = Promise.resolve(originalGetSources(options)).finally(() => { windowSourcesInFlight = null })
  return windowSourcesInFlight
}

// ── Update handoff guard ─────────────────────────────────────────────────────
// electron-updater replaces the installed EXE in-place. On Windows there can be a short
// handoff window where the already-running renderer exists but process.execPath is temporarily
// absent. child_process.fork() uses process.execPath, so starting the local auth/AI service in
// that window fails with `spawn ... MockMate.exe ENOENT`. Only when that condition is observed,
// wait for the new executable to appear and remain stable before forking the service.
const handoffSleeper = new Int32Array(new SharedArrayBuffer(4))
function waitForInstalledExecutable(maxWaitMs = 15000, stableMs = 750) {
  if (!app.isPackaged || fs.existsSync(process.execPath)) return true
  console.warn('[bootstrap] installed executable temporarily unavailable; waiting for updater handoff:', process.execPath)
  const deadline = Date.now() + maxWaitMs
  let stableSince = 0
  while (Date.now() < deadline) {
    const exists = fs.existsSync(process.execPath)
    if (exists) {
      if (!stableSince) stableSince = Date.now()
      if (Date.now() - stableSince >= stableMs) {
        console.log('[bootstrap] updater handoff complete; installed executable is stable')
        return true
      }
    } else {
      stableSince = 0
    }
    Atomics.wait(handoffSleeper, 0, 0, 100)
  }
  return false
}

// ── Child lifecycle: graceful intentional shutdown + recovery on real crash ──
const originalFork = childProcess.fork.bind(childProcess)
childProcess.fork = function supervisedFork(modulePath, args, options) {
  const isMockMateService = /(?:^|[\\/])(?:server-entry\.cjs)$/i.test(String(modulePath))
  if (isMockMateService && !waitForInstalledExecutable()) {
    const error = new Error(`MockMate is still finishing an update and its installed executable is not available yet: ${process.execPath}`)
    error.code = 'ENOENT'
    throw error
  }

  const proc = originalFork(modulePath, args, options)
  if (!isMockMateService) return proc

  let intentional = false
  const originalKill = proc.kill.bind(proc)
  proc.kill = function gracefulKill(signal) {
    intentional = true
    if (signal === 'SIGKILL') {
      let result = false
      try { result = originalKill('SIGTERM') } catch {}
      const hard = setTimeout(() => { try { if (!proc.killed && proc.exitCode == null) originalKill('SIGKILL') } catch {} }, 1800)
      hard.unref?.()
      return result
    }
    return originalKill(signal)
  }

  proc.once('exit', (code, signal) => {
    if (intentional || appQuitting) return
    const service = String(modulePath).includes(`${path.sep}backend${path.sep}`) ? 'account service' : 'AI service'
    console.error(`[bootstrap] ${service} exited unexpectedly`, { code, signal })
    app.whenReady().then(() => {
      dialog.showMessageBox({ type: 'error', title: 'MockMate service restarted', message: `The local ${service} stopped unexpectedly. MockMate will restart to recover cleanly.`, buttons: ['Restart MockMate'] })
        .finally(() => { try { app.relaunch(); app.exit(1) } catch { app.quit() } })
    }).catch(() => { try { app.relaunch(); app.exit(1) } catch {} })
  })
  return proc
}

require('./main.cjs')
