// Electron main — overlay window with setContentProtection(true):
//   Windows → WDA_EXCLUDEFROMCAPTURE,  macOS → NSWindowSharingNone
//   (Linux has no equivalent — overlay IS visible in screen share there.)
const { app, BrowserWindow, ipcMain, screen, desktopCapturer, globalShortcut, Notification, shell, dialog, safeStorage, powerMonitor } = require('electron')
const path = require('path')
const fs = require('fs')
const crypto = require('crypto')
const net = require('net')
const { fork, execSync } = require('child_process')

// Crash/error reporting — inert unless SENTRY_DSN is set. beforeSend strips request bodies
// so a candidate's resume/transcript never leaves the device via Sentry (privacy-first).
try {
  const Sentry = require('@sentry/electron/main')
  if (process.env.SENTRY_DSN) Sentry.init({ dsn: process.env.SENTRY_DSN, sendDefaultPii: false, beforeSend(e) { if (e.request) delete e.request.data; return e } })
} catch {}

const isProd = app.isPackaged
const DEV_URL = 'http://localhost:5174'
const PROD_URL = 'http://localhost:3002'

let mainWindow, setupWindow, apiServer, backendServer
// Pin default ON — Live overlay stays when switching to Zoom; unpin → collapse to pill on blur.
let pinnedState = true
// Ignore blur-hide/collapse during screenshot, mode switches, and brief focus handoffs.
let suppressBlurUntil = 0
function suppressBlurHide(ms = 1200) { suppressBlurUntil = Date.now() + ms }
let lastWindowMode = null
// Remember Live HUD size so set-window-mode('overlay') never resets a user resize to 300×360.
let lastOverlaySize = { w: 300, h: 360 }
let copilotWindow = null

function isOwnWindowFocused() {
  try {
    const focused = BrowserWindow.getFocusedWindow()
    if (!focused || focused.isDestroyed()) return false
    if (mainWindow && focused.id === mainWindow.id) return true
    if (setupWindow && !setupWindow.isDestroyed() && focused.id === setupWindow.id) return true
    if (copilotWindow && !copilotWindow.isDestroyed() && focused.id === copilotWindow.id) return true
    return false
  } catch { return false }
}

function applyPillGeometry() {
  if (!mainWindow || mainWindow.isDestroyed()) return
  const { width } = screen.getPrimaryDisplay().workAreaSize
  const s = 72
  try { mainWindow.setIgnoreMouseEvents(false) } catch {}
  mainWindow.setSize(s, s)
  mainWindow.setPosition(Math.max(0, width - s - 16), 16)
  if (!mainWindow.isVisible()) {
    try { mainWindow.showInactive() } catch { mainWindow.show() }
  }
  try { mainWindow.setAlwaysOnTop(true, pinnedState ? 'screen-saver' : 'floating') } catch {
    try { mainWindow.setAlwaysOnTop(true) } catch {}
  }
  lastWindowMode = 'pill'
}

// Auth/SaaS backend. Base URL is env-configurable so we can point the app at a
// hosted backend later with no code change; default is the local fork.
const BACKEND_PORT = process.env.MOCKMATE_BACKEND_PORT || '4000'
const API_BASE = process.env.MOCKMATE_API_BASE || `http://localhost:${BACKEND_PORT}`

// Assets ship via extraFiles — next to the exe, not inside resources/app
function assetsPath(...parts) {
  return path.join(path.dirname(app.getPath('exe')), 'assets', ...parts)
}

// The window/dock icon. In a packaged build it sits beside the exe (extraFiles);
// in dev that path doesn't exist (exe is the Electron binary), so the icon shows
// blank — fall back to the repo's assets/icon.png there.
function iconPath() {
  const shipped = assetsPath('icon.png')
  if (fs.existsSync(shipped)) return shipped
  return path.join(app.getAppPath(), 'assets', 'icon.png')
}

// Load .env from every place it might live, in PRIORITY order. dotenv does NOT
// override an already-set key, so the first file that defines a key wins:
//   1. userData/.env  — keys a user typed into the in-app setup (their override)
//   2. exe-dir/.env   — shipped beside the packaged binary (prod), if present
//   3. appPath/.env   — the BUNDLED .env (dev: project root; prod: resources/app)
// DELIBERATE PRODUCT DECISION: the bundled .env (3) ships with our keys so every
// user works out-of-box with no setup — see .env for the security caveat. A user
// who enters their OWN key (1) overrides ours because userData is read first.
// Both dev and prod read the same bundled file, so hasApiKeys() in the main
// process now matches what the server actually sees (that mismatch was the whole
// dev/prod confusion + the "still says no keys" bug).
// BYOK keys: prefer encrypted userData/.env.enc (safeStorage). Plaintext userData/.env
// is migrated on first read when encryption is available, then deleted.
function userEnvPaths() {
  const dir = app.getPath('userData')
  return { enc: path.join(dir, '.env.enc'), plain: path.join(dir, '.env') }
}
function parseEnvText(txt) {
  return Object.fromEntries((txt || '').split('\n')
    .map(l => l.trim()).filter(l => l && !l.startsWith('#') && l.includes('='))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] }))
}
function applyEnvMap(map, { override = false } = {}) {
  for (const [k, v] of Object.entries(map || {})) {
    if (!k) continue
    if (!override && process.env[k] !== undefined) continue
    process.env[k] = v
  }
}
function readUserEnvText() {
  const { enc, plain } = userEnvPaths()
  if (fs.existsSync(enc) && safeStorage.isEncryptionAvailable()) {
    try { return safeStorage.decryptString(fs.readFileSync(enc)) } catch (e) {
      console.warn('[MockMate] failed to decrypt .env.enc:', e.message)
    }
  }
  if (fs.existsSync(plain)) {
    const txt = fs.readFileSync(plain, 'utf8')
    // Migrate plaintext → encrypted at rest when the OS keychain is available.
    if (txt && safeStorage.isEncryptionAvailable()) {
      try {
        fs.writeFileSync(enc, safeStorage.encryptString(txt), { mode: 0o600 })
        fs.rmSync(plain, { force: true })
        console.log('[MockMate] migrated BYOK keys to encrypted userData/.env.enc')
      } catch (e) { console.warn('[MockMate] BYOK encrypt migrate failed:', e.message) }
    }
    return txt
  }
  return ''
}
function writeUserEnvText(txt) {
  const { enc, plain } = userEnvPaths()
  fs.mkdirSync(path.dirname(plain), { recursive: true })
  if (safeStorage.isEncryptionAvailable()) {
    fs.writeFileSync(enc, safeStorage.encryptString(String(txt || '')), { mode: 0o600 })
    try { fs.rmSync(plain, { force: true }) } catch {}
    return { encrypted: true }
  }
  fs.writeFileSync(plain, String(txt || ''), { mode: 0o600 })
  return { encrypted: false }
}
function loadEnv() {
  // Priority: user BYOK (override) → exe-dir → bundled app .env (fill gaps only).
  const userTxt = readUserEnvText()
  if (userTxt) applyEnvMap(parseEnvText(userTxt), { override: true })
  for (const envPath of [
    path.join(path.dirname(app.getPath('exe')), '.env'),
    path.join(app.getAppPath(), '.env'),
  ]) {
    if (fs.existsSync(envPath)) require('dotenv').config({ path: envPath })
  }
}

function hasApiKeys() {
  return !!(process.env.GROQ_API_KEY || process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY
    || process.env.ANTHROPIC_API_KEY || process.env.CEREBRAS_API_KEY || process.env.LLM_API_KEY)
}

function portInUse(port) {
  return new Promise(resolve => {
    const s = net.createServer()
    s.once('error', () => resolve(true))
    s.once('listening', () => s.close(() => resolve(false)))
    try { s.listen(port, '127.0.0.1') } catch { resolve(true) }
  })
}

// Free a loopback port held by an orphaned MockMate child after a hard kill.
function freePort(port) {
  try {
    if (process.platform === 'win32') {
      const out = execSync('netstat -ano', { encoding: 'utf8', windowsHide: true })
      const pids = new Set()
      for (const line of out.split(/\r?\n/)) {
        if (!line.includes(`:${port}`) || !/LISTENING/i.test(line)) continue
        const parts = line.trim().split(/\s+/)
        const pid = parts[parts.length - 1]
        if (/^\d+$/.test(pid) && pid !== '0') pids.add(pid)
      }
      for (const pid of pids) {
        try { execSync(`taskkill /PID ${pid} /F`, { stdio: 'ignore', windowsHide: true }) } catch {}
      }
    } else {
      try { execSync(`fuser -k ${port}/tcp`, { stdio: 'ignore' }) } catch {}
      try {
        const out = execSync(`lsof -ti tcp:${port} -sTCP:LISTEN`, { encoding: 'utf8' }).trim()
        for (const pid of out.split(/\s+/).filter(Boolean)) {
          try { process.kill(Number(pid), 'SIGKILL') } catch {}
        }
      } catch {}
    }
  } catch (e) {
    console.warn('[MockMate] freePort', port, e.message)
  }
}

async function ensurePortFree(port, label) {
  if (!(await portInUse(port))) return
  console.warn(`[MockMate] ${label} port ${port} in use — reclaiming orphan process`)
  freePort(port)
  await new Promise(r => setTimeout(r, 400))
  if (await portInUse(port)) {
    console.error(`[MockMate] ${label} port ${port} still busy after reclaim`)
  }
}

function startApiServer(onReady) {
  const serverEntry = path.join(app.getAppPath(), 'server-entry.cjs')
  // Reclaim stale :3002 before fork (orphans after Task Manager / SIGKILL).
  ensurePortFree(3002, 'API').then(() => {
  apiServer = fork(serverEntry, [], {
    env: { ...process.env, PORT: '3002', NODE_ENV: 'production' },
    cwd: app.getAppPath(), stdio: 'pipe'
  })
  apiServer.stdout?.on('data', d => console.log('[API]', d.toString().trim()))
  apiServer.stderr?.on('data', d => console.error('[API]', d.toString().trim()))
  apiServer.on('error', e => console.error('[API] fork error:', e.message))

  let done = false
  const fire = () => { if (!done) { done = true; onReady() } }
  apiServer.on('message', msg => {
    if (msg?.type === 'ready') fire()
    // The server couldn't bind the port (e.g. a stale process is holding it). Don't
    // silently fall through to loading a dead URL — tell the user what happened.
    else if (msg?.type === 'server-error') {
      const hint = msg.code === 'EADDRINUSE'
        ? 'Port 3002 is already in use — another MockMate may still be running. Quit it (or reboot) and reopen MockMate.'
        : `The local server failed to start: ${msg.message || msg.code || 'unknown error'}`
      dialog.showErrorBox('MockMate could not start', hint)
      app.quit()
    }
  })
  setTimeout(fire, 6000)   // fallback if 'ready' never arrives
  }).catch(e => {
    console.error('[API] ensurePortFree failed:', e.message)
    onReady?.()
  })
}

// Persistent per-install JWT secret. Generated once, kept in userData (0600),
// and handed to the forked backend so tokens stay valid across app restarts.
function getJwtSecret() {
  const f = path.join(app.getPath('userData'), '.jwt-secret')
  try { if (fs.existsSync(f)) return fs.readFileSync(f, 'utf8').trim() } catch {}
  const secret = crypto.randomBytes(48).toString('hex')
  try { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, secret, { mode: 0o600 }) } catch {}
  return secret
}

// Fork the auth backend (Express). File-backed by default (offline-safe, no
// MongoDB needed); set MONGO_URI to switch to Mongo. Data lives in userData.
function startBackend() {
  const entry = path.join(app.getAppPath(), 'backend', 'server-entry.cjs')
  if (!fs.existsSync(entry)) return Promise.reject(new Error(`backend entry not found: ${entry}`))
  return ensurePortFree(Number(BACKEND_PORT) || 4000, 'backend').then(() => new Promise((resolve, reject) => {
    let settled = false
    const finish = (fn, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      fn(value)
    }
    backendServer = fork(entry, [], {
      cwd: path.join(app.getAppPath(), 'backend'),
      env: {
        ...process.env,
        PORT: BACKEND_PORT,
        JWT_SECRET: getJwtSecret(),
        JWT_EXPIRES: process.env.JWT_EXPIRES || '7d',
        MOCKMATE_DATA_DIR: app.getPath('userData'),   // file store lives beside the user's keys
        NODE_ENV: 'production',
      },
      stdio: 'pipe',
    })
    const timer = setTimeout(() => finish(reject, new Error(`auth backend did not become ready on port ${BACKEND_PORT}`)), 10_000)
    backendServer.stdout?.on('data', d => console.log('[backend]', d.toString().trim()))
    backendServer.stderr?.on('data', d => console.error('[backend]', d.toString().trim()))
    backendServer.on('message', msg => {
      if (msg?.type === 'ready') finish(resolve, msg)
      else if (msg?.type === 'server-error') finish(reject, new Error(msg.message || msg.code || 'backend startup failed'))
    })
    backendServer.on('error', e => finish(reject, e))
    backendServer.on('exit', code => {
      if (code) console.error('[backend] exited with code', code)
      if (!settled) finish(reject, new Error(`auth backend exited before ready (${code ?? 'unknown'})`))
    })
  }))
}

function createSetupWindow() {
  // When the overlay is already up (user clicked "Add / manage API keys"), open
  // the key window as a MODAL CHILD of it — one taskbar entry, not two apps.
  const asChild = !!(mainWindow && !mainWindow.isDestroyed())
  setupWindow = new BrowserWindow({
    width: 520, height: 700, resizable: false, center: true,
    title: 'MockMate — Setup',
    icon: iconPath(),
    parent: asChild ? mainWindow : undefined,
    modal: asChild,
    skipTaskbar: asChild,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  })
  setupWindow.setMenuBarVisibility(false)
  setupWindow.loadFile(path.join(app.getAppPath(), 'setup.html'))
  setupWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) shell.openExternal(url)
    return { action: 'deny' }
  })
  setupWindow.on('closed', () => { setupWindow = null; if (!mainWindow) app.quit() })
}

function createMainWindow() {
  const { width } = screen.getPrimaryDisplay().workAreaSize
  // Linux compositors often render transparent frameless windows as fully invisible,
  // and Linux has no screen-protection benefit from transparency anyway — so use an
  // opaque, framed window there. Windows/macOS keep the transparent floating overlay.
  const isLinux = process.platform === 'linux'
  mainWindow = new BrowserWindow({
    // Launch at app (dashboard) size, centered; the renderer switches to the compact
    // overlay via set-window-mode when entering Live/Solo.
    width: Math.min(1200, width - 80), height: 760, center: true,
    minWidth: 280, minHeight: 180,
    alwaysOnTop: true,
    frame: isLinux,                                   // Linux: normal window chrome so it's visible + movable
    transparent: !isLinux,                            // transparent overlay only on Win/macOS
    backgroundColor: isLinux ? '#08090e' : '#00000000',
    resizable: true, skipTaskbar: !isLinux,
    icon: iconPath(),
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  })
  // Privacy-first startup: protect immediately so there is no brief capturable
  // frame before React mounts. The user can explicitly turn Stealth off to
  // test/demo the overlay.
  mainWindow.setContentProtection(process.platform !== 'linux')
  // Default pinned (matches renderer mm-pinned default) so Live stays when switching to Zoom.
  pinnedState = true
  try {
    mainWindow.setAlwaysOnTop(true, 'screen-saver')
    mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  } catch {}

  // Pin policy:
  // - pinned: stay above Zoom (reassert always-on-top; do NOT showInactive every blur — avoids flicker)
  // - unpinned: collapse to on-screen pill (never vanish); ignore child windows / screenshots / mode switches
  mainWindow.on('blur', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    setTimeout(() => {
      if (!mainWindow || mainWindow.isDestroyed()) return
      if (Date.now() < suppressBlurUntil) return
      if (mainWindow.isFocused()) return
      if (isOwnWindowFocused()) return

      if (pinnedState) {
        try { mainWindow.setAlwaysOnTop(true, 'screen-saver') } catch {}
        return
      }

      // Already a pill — leave the icon on screen.
      if (lastWindowMode === 'pill') return

      // Always collapse to on-screen pill (dashboard + Live) — never vanish to tray.
      try { mainWindow.webContents.send('blur-collapse') } catch {}
      suppressBlurHide(600)
      applyPillGeometry()
    }, 60)
  })

  // External links (e.g. "get a free API key" in Settings) must open in the user's real browser,
  // never inside the app window. Handle both target=_blank/window.open and plain <a href> clicks.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (e, url) => {
    // Allow the app's own SPA origin (dev Vite server / bundled server / file://); send anything
    // external out to the browser instead of navigating away from the app.
    const current = mainWindow.webContents.getURL()
    const sameOrigin = (() => { try { return new URL(url).origin === new URL(current).origin } catch { return false } })()
    if (/^https?:\/\//.test(url) && !sameOrigin) { e.preventDefault(); shell.openExternal(url) }
  })

  mainWindow.webContents.on('did-fail-load', (_e, code) => {
    if (code === -3) return   // ERR_ABORTED — normal during reloads, not a real failure
    // Retry the URL for THIS environment (dev = Vite, prod = bundled server).
    // Previously this always reloaded PROD_URL, which in dev pointed at the wrong
    // server and left the window stuck/black after a reload.
    setTimeout(() => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.loadURL(isProd ? PROD_URL : DEV_URL) }, 800)
  })

  if (isProd) {
    startApiServer(() => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.loadURL(PROD_URL) })
  } else {
    mainWindow.loadURL(DEV_URL)
  }

  mainWindow.on('closed', () => { mainWindow = null; app.quit() })
}

function launchTrayAndShortcuts() {
  const showMain = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    mainWindow.show(); mainWindow.focus()
  }
  const toggleVisibility = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    if (mainWindow.isVisible()) mainWindow.hide()
    else showMain()
  }
  // Alt+H: ask the renderer first (Live → collapse to on-screen pill; elsewhere → hide).
  // If the window is already hidden, always restore.
  const stealthOrToggle = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    if (!mainWindow.isVisible()) { showMain(); return }
    try { mainWindow.webContents.send('shortcut-stealth') } catch { toggleVisibility() }
  }
  globalShortcut.register('Alt+H', stealthOrToggle)
  globalShortcut.register('CommandOrControl+Shift+H', stealthOrToggle)
  // Force-disable click-through when the overlay traps the user (region miss / stuck ignore).
  globalShortcut.register('Alt+C', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    try { mainWindow.setIgnoreMouseEvents(false) } catch {}
    try { mainWindow.webContents.send('shortcut-clickthrough-off') } catch {}
  })

  const { Tray, Menu, nativeImage } = require('electron')
  const trayIcon = (() => { try { return nativeImage.createFromPath(iconPath()) } catch { return nativeImage.createEmpty() } })()
  try {
    const tray = new Tray(trayIcon)
    tray.setToolTip('MockMate — Click to show/hide')
    tray.on('click', toggleVisibility)
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Show MockMate', click: showMain },
      { label: 'Quit', click: () => app.quit() }
    ]))
    if (Notification.isSupported()) {
      new Notification({
        title: 'MockMate is running',
        body: '— / Alt+H collapses to a pill icon (click to restore). Tray icon always works.',
        icon: trayIcon
      }).show()
    }
  } catch {}

  // Screen solve: Ctrl+Shift+U (avoids Zoom/browser stealing lone F-keys) + F7 alias.
  globalShortcut.register('CommandOrControl+Shift+U', captureScreen)
  try { globalShortcut.register('F7', captureScreen) } catch {}
}

// Capture the primary screen and hand a compressed JPEG to the renderer for vision analysis.
// Called by the Ctrl+Shift+U shortcut AND by the in-app "Solve it" button (ipc).
// Keep resolution/quality modest: full 1920×1080 PNGs routinely trip vision 429s ("busy")
// and slow TTFT; 1280-wide JPEG is enough for code/diagrams and fails over far more reliably.
async function captureScreen(opts = {}) {
  // Linux/Wayland routes desktopCapturer through the pipewire ScreenCast portal, which is
  // unreliable/absent here and can HANG or crash the process (SIGKILL). The screenshot-solve
  // feature just isn't available on Linux — notify instead of attempting the portal.
  if (process.platform === 'linux') {
    try { if (Notification.isSupported()) new Notification({ title: 'Screen capture unavailable on Linux', body: 'The screenshot-solve feature needs Windows or macOS (Wayland blocks it).' }).show() } catch {}
    return { error: 'linux_unsupported' }
  }
  suppressBlurHide(2500)
  try {
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1280, height: 720 } })
    if (!sources.length) return { error: 'no_sources' }
    const primaryId = String(screen.getPrimaryDisplay().id)
    const preferredId = opts.displayId != null ? String(opts.displayId) : null
    // Prefer explicit display → primary → first. display_id is Electron's link to Display.id when available.
    const chosen = (preferredId && sources.find(s => String(s.display_id) === preferredId || s.id === preferredId))
      || sources.find(s => String(s.display_id) === primaryId)
      || sources[0]
    let payload
    try {
      const img = chosen.thumbnail.resize({ width: 1280, quality: 'better' })
      const size = img.getSize?.() || { width: 1280, height: 720 }
      const jpeg = img.toJPEG(72)
      payload = {
        mime: 'image/jpeg',
        base64: jpeg.toString('base64'),
        width: size.width || 1280,
        height: size.height || 720,
        bytes: jpeg.length,
        displayId: chosen.display_id || chosen.id || null,
        displayName: chosen.name || null,
      }
    } catch {
      const png = chosen.thumbnail.toPNG()
      const size = chosen.thumbnail.getSize?.() || { width: 1280, height: 720 }
      payload = {
        mime: 'image/png',
        base64: png.toString('base64'),
        width: size.width,
        height: size.height,
        bytes: png.length,
        displayId: chosen.display_id || chosen.id || null,
        displayName: chosen.name || null,
      }
    }
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('screen-captured', payload)
    return payload
  } catch (e) {
    console.error('Screen capture failed:', e.message)
    return { error: e.message || 'capture_failed' }
  } finally { suppressBlurHide(800) }
}

async function listScreenDisplays() {
  if (process.platform === 'linux') return { displays: [], unsupported: true }
  try {
    const displays = screen.getAllDisplays().map(d => ({
      id: String(d.id),
      label: d.label || `Display ${d.id}`,
      bounds: d.bounds,
      primary: d.id === screen.getPrimaryDisplay().id,
    }))
    // Cross-check capturer source ids (display_id may be empty on some platforms).
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } })
    return {
      displays,
      sources: sources.map(s => ({ id: s.id, displayId: s.display_id || null, name: s.name })),
      // Abstraction note: when display_id is missing, UI should fall back to source.id.
    }
  } catch (e) {
    return { displays: [], error: e.message }
  }
}

// New windows start unprotected. Explicit protected-hints actions opt their
// window in; normal MockMate windows remain visible in capture when Stealth is off.
app.on('browser-window-created', (_, win) => {
  try { win.setContentProtection(false) } catch {}
})

// Silent auto-update: download new releases in the background and install on the
// NEXT quit. No prompt/notification on purpose — a toast during a screen share
// would expose the app. The user just gets the new version next time they reopen.
let autoUpdaterRef = null
let updaterStarted = false
function sendUpdate(payload) { try { mainWindow?.webContents?.send('update-status', payload) } catch {} }
function setupAutoUpdate() {
  if (!isProd || updaterStarted) return   // guard re-entry: don't double-register listeners / interval
  updaterStarted = true
  try {
    const { autoUpdater } = require('electron-updater')
    autoUpdaterRef = autoUpdater
    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true    // silent fallback: installs on quit even if the user ignores the toast
    // Only surface errors once an update was actually found and then failed (download/install) —
    // NOT for benign background-check failures (offline, no release yet), which must stay silent.
    let updateFlowActive = false
    autoUpdater.on('error', e => { console.error('[updater]', e?.message); if (updateFlowActive) sendUpdate({ state: 'error', message: e?.message || 'Update failed' }) })
    // Forward progress to the renderer so it can show the update toast (workspace only).
    autoUpdater.on('update-available', i => { updateFlowActive = true; sendUpdate({ state: 'available', version: i?.version }) })
    autoUpdater.on('download-progress', p => sendUpdate({ state: 'downloading', percent: Math.round(p.percent || 0), transferred: p.transferred, total: p.total }))
    autoUpdater.on('update-downloaded', i => sendUpdate({ state: 'ready', version: i?.version }))
    autoUpdater.checkForUpdates().catch(e => console.error('[updater] check failed:', e?.message))
    setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 6 * 60 * 60 * 1000)
  } catch (e) { console.error('[updater] unavailable:', e?.message) }
}
// Restart & install the downloaded update now (from the toast's "Restart" button).
ipcMain.handle('install-update', () => { try { autoUpdaterRef?.quitAndInstall() } catch (e) { console.error('[updater]', e?.message) } ; return { ok: true } })
// Manually (re)start the download from the toast's "Download" button — covers a stalled
// auto-download or a user who dismissed and wants it again.
ipcMain.handle('download-update', () => { try { autoUpdaterRef?.downloadUpdate()?.catch(e => console.error('[updater]', e?.message)) } catch (e) { console.error('[updater]', e?.message) } ; return { ok: true } })
// Manual check. In prod → real check; in dev → simulate the toast sequence so the UI is verifiable.
let demoUpdateTimer = null
ipcMain.handle('check-updates-now', () => {
  if (isProd && autoUpdaterRef) { autoUpdaterRef.checkForUpdates().catch(() => {}); return { ok: true } }
  clearInterval(demoUpdateTimer)   // repeated clicks must not stack concurrent progress loops
  const total = 125_000_000
  sendUpdate({ state: 'available', version: 'demo' })
  let pct = 0
  demoUpdateTimer = setInterval(() => {
    pct += 17
    if (pct >= 100) { clearInterval(demoUpdateTimer); sendUpdate({ state: 'ready', version: 'demo' }) }
    else sendUpdate({ state: 'downloading', percent: pct, transferred: Math.round(total * pct / 100), total })
  }, 450)
  return { ok: true, simulated: true }
})

// Single-instance lock — a second `MockMate` launch (double-click, stale dev
// process, relaunch race) must NOT open a second overlay. The second process
// exits immediately and just focuses the window that's already running. Without
// this you can end up with two overlays / two taskbar entries at once.
const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const win = mainWindow || setupWindow
    if (win && !win.isDestroyed()) {
      if (win.isMinimized()) win.restore()
      win.show(); win.focus()
    }
  })

  app.whenReady().then(async () => {
    loadEnv()
    // Fork a LOCAL auth backend only when NOT pointed at a hosted one. With MOCKMATE_API_BASE set
    // (production / Mongo-backed), the desktop talks to the hosted backend over HTTPS — no local
    // fork, and DB credentials (MONGO_URI) never ship on the client.
    if (!process.env.MOCKMATE_API_BASE) {
      try {
        await startBackend()
      } catch (e) {
        console.error('[backend] startup failed:', e.message)
        // Authentication is optional: BYOK/guest interview modes use the local AI
        // server and must remain available when the account service is unhealthy.
        // AuthGate will surface normal connection errors if sign-in is attempted.
        dialog.showMessageBox({
          type: 'warning',
          title: 'MockMate account service is unavailable',
          message: 'Sign-in and account creation are temporarily unavailable.',
          detail: `${e.message}\n\nYou can still continue without an account and use your own API keys. Restart MockMate to retry the account service.`,
          buttons: ['Continue without account'],
          defaultId: 0,
        }).catch(() => {})
      }
    }
    // ALWAYS open the single overlay window — no separate setup window. With the
    // bundled .env keys present it goes straight to work; if no keys are found the
    // overlay shows its inline "Add your API keys" form. One window, never two.
    createMainWindow()
    launchTrayAndShortcuts()
    setupAutoUpdate()

    // Sleep/wake + display hotplug — tell renderers so Live can resume AudioContext / STT.
    const broadcast = (channel, payload) => {
      for (const w of BrowserWindow.getAllWindows()) {
        try { if (!w.isDestroyed()) w.webContents.send(channel, payload) } catch {}
      }
    }
    try {
      powerMonitor.on('suspend', () => broadcast('power-event', 'suspend'))
      powerMonitor.on('resume', () => broadcast('power-event', 'resume'))
      powerMonitor.on('unlock-screen', () => broadcast('power-event', 'unlock'))
    } catch (e) { console.warn('[MockMate] powerMonitor unavailable:', e.message) }
    try {
      screen.on('display-added', () => broadcast('display-changed', 'added'))
      screen.on('display-removed', () => broadcast('display-changed', 'removed'))
      screen.on('display-metrics-changed', () => broadcast('display-changed', 'metrics'))
    } catch (e) { console.warn('[MockMate] display events unavailable:', e.message) }
  })
}

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
  try { apiServer?.kill('SIGKILL') } catch {}
  try { backendServer?.kill('SIGKILL') } catch {}
  try { copilotWindow?.destroy() } catch {}
})

// Auto-detect, by open window/tab titles: (1) a video meeting, (2) a coding platform.
const MEETING_PATTERNS = [
  { id: 'zoom', label: 'Zoom', re: /zoom meeting|zoom workplace/i },
  { id: 'meet', label: 'Google Meet', re: /google meet|meet\.google\.com/i },
  { id: 'teams', label: 'Microsoft Teams', re: /microsoft teams|teams meeting/i },
  { id: 'webex', label: 'Webex', re: /webex/i },
  { id: 'whereby', label: 'Whereby', re: /whereby/i },
]
const CODING_RE  = /leetcode|hackerrank|coderpad|codesignal|hackerearth|codility|codingame|geeksforgeeks|interviewbit|codewars|online assessment|codepair|byteboard|replit/i
let meetingWasActive = false, meetingContext = { active: false, app: null, label: null }, codingWasActive = false
// NOTE: on Linux/Wayland, desktopCapturer.getSources() routes through the pipewire
// ScreenCast portal — it can't enumerate window titles, fails ("ScreenCastPortal
// failed"), and repeated polling stalls the main process (app shows "not responding").
// So auto-detection is disabled on Linux; users start Live Companion manually there.
if (process.platform !== 'linux') setInterval(async () => {
  if (!mainWindow || mainWindow.isDestroyed()) return
  try {
    const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 0, height: 0 } })
    const names = sources.map(s => s.name)
    const match = MEETING_PATTERNS.find(p => names.some(n => p.re.test(n)))
    const meeting = !!match
    const nextContext = { active: meeting, app: match?.id || null, label: match?.label || null, detectedAt: meeting ? Date.now() : null }
    if (meeting !== meetingWasActive || nextContext.app !== meetingContext.app) {
      meetingWasActive = meeting
      meetingContext = nextContext
      mainWindow.webContents.send('meeting-detected', meetingContext)
    }
    const coding = names.some(n => CODING_RE.test(n))
    if (coding !== codingWasActive) { codingWasActive = coding; mainWindow.webContents.send('coding-detected', coding) }
  } catch {}
}, 3000)
ipcMain.handle('get-meeting-context', () => meetingContext)

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })

ipcMain.handle('get-audio-sources', async () => {
  // Linux/Wayland can't capture desktop/loopback audio and the screencast portal
  // stalls — the microphone is the only usable source, so skip desktopCapturer entirely.
  if (process.platform === 'linux') return []
  const sources = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 0, height: 0 } })
  return sources.map(s => ({ id: s.id, name: s.name }))
})
ipcMain.handle('capture-screen', (_, opts) => captureScreen(opts || {}))   // "Solve it" button trigger
ipcMain.handle('list-screen-displays', () => listScreenDisplays())
// PiP windows are auto-protected by the browser-window-created listener above.
// This confirms it to the renderer so it can warn honestly on Linux (no protection).
ipcMain.handle('set-content-protection', (_e, on) => {
  if (process.platform === 'linux') return { ok: false, unsupported: true }
  try {
    mainWindow?.setContentProtection(!!on)
    return { ok: true, enabled: !!on }
  } catch (e) { return { ok: false, error: e.message } }
})
ipcMain.handle('exclude-from-capture', e => {
  if (process.platform === 'linux') return { ok: false, unsupported: true }
  try {
    // Document PiP is normally the focused top-level window even though the IPC
    // bridge belongs to the opener's webContents.
    const owner = BrowserWindow.getFocusedWindow() || BrowserWindow.fromWebContents(e.sender)
    owner?.setContentProtection(true)
    return { ok: true, id: owner?.id || 'window' }
  } catch (err) { return { ok: false, error: err.message } }
})
ipcMain.on('get-userdata-path', e => { e.returnValue = app.getPath('userData') })

// ── Duo co-pilot window (Phase 3) ───────────────────────────────────────────
// A small, always-on-top, CONTENT-PROTECTED window that shows the candidate's private AI hints
// during a Duo room — invisible to Zoom/Teams/Meet screen capture (WDA_EXCLUDEFROMCAPTURE), so a
// partner sharing their screen never sees it. The renderer (src/Room.jsx) drives it via
// setRoomActive(on) + sendHint(payload). No-op on Linux (no capture protection there).
const COPILOT_HTML = `<!doctype html><html><head><meta charset="utf-8"><style>
  body{margin:0;font-family:system-ui,-apple-system,sans-serif;background:#0f0f1a;color:#e2e8f0;-webkit-app-region:drag;user-select:none}
  #wrap{padding:14px;height:100vh;box-sizing:border-box;overflow:auto}
  .hd{font-weight:700;font-size:14px;color:#a78bfa}
  .sub{font-size:10px;color:#475569;margin-bottom:10px}
  .q{color:#94a3b8;font-size:11px;margin:0 0 10px;border-left:2px solid #334155;padding-left:8px;font-style:italic}
  ul{margin:0 0 10px;padding-left:18px} li{margin-bottom:3px;font-size:13px}
  .badge{background:#14532d;color:#4ade80;border-radius:4px;padding:2px 7px;font-size:11px;display:inline-block;margin-bottom:8px}
  .warn{color:#f59e0b;font-size:12px} .muted{color:#64748b;margin:0}
</style></head><body><div id="wrap">
  <div class="hd">🤖 AI Co-pilot</div><div class="sub">invisible to screen capture</div>
  <div id="content"><p class="muted">Waiting for the first question…</p></div>
</div><script>
  window.renderHint=function(p){var c=document.getElementById('content');if(!c)return;
    var esc=function(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')};
    var h=p&&p.hint,q=p&&p.question,loading=p&&p.hintLoading,out='';
    if(q)out+='<div class="q">'+esc(q)+'</div>';
    if(loading)out+='<p class="muted">Generating hints…</p>';
    else if(h){if(h.resumeRelevant)out+='<span class="badge">✓ Resume-relevant</span>';
      out+='<div style="font-weight:600;margin:8px 0 4px">Key points:</div><ul>'+((h.keyPoints||[]).map(function(k){return '<li>'+esc(k)+'</li>'}).join(''))+'</ul>';
      if(h.watchOut)out+='<div class="warn">⚠ '+esc(h.watchOut)+'</div>';}
    else out+='<p class="muted">Waiting for next question…</p>';
    c.innerHTML=out;};
</script></body></html>`

function createCopilotWindow() {
  if (copilotWindow && !copilotWindow.isDestroyed()) return copilotWindow
  const { width } = screen.getPrimaryDisplay().workAreaSize
  copilotWindow = new BrowserWindow({
    width: 400, height: 340, x: Math.max(0, width - 420), y: 60,
    frame: false, transparent: false, alwaysOnTop: true, skipTaskbar: process.platform !== 'linux',
    resizable: true, backgroundColor: '#0f0f1a', icon: iconPath(),
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
  })
  try { copilotWindow.setContentProtection(process.platform !== 'linux') } catch {}
  try { copilotWindow.setAlwaysOnTop(true, 'screen-saver') } catch {}
  copilotWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(COPILOT_HTML))
  copilotWindow.on('closed', () => { copilotWindow = null })
  return copilotWindow
}
function sendHintToCopilot(payload) {
  if (!copilotWindow || copilotWindow.isDestroyed()) return
  const run = () => { try { copilotWindow.webContents.executeJavaScript(`window.renderHint(${JSON.stringify(payload || {})})`) } catch {} }
  if (copilotWindow.webContents.isLoading()) copilotWindow.webContents.once('did-finish-load', run)
  else run()
}
// Candidate entered/left a Duo room → open/close the protected co-pilot window.
ipcMain.on('set-room-active', (_e, active) => {
  if (active) createCopilotWindow()
  else if (copilotWindow && !copilotWindow.isDestroyed()) { try { copilotWindow.close() } catch {} ; copilotWindow = null }
})
// Push the latest hint (or loading state) into the co-pilot window.
ipcMain.on('send-hint', (_e, payload) => { if (copilotWindow && !copilotWindow.isDestroyed()) sendHintToCopilot(payload) })

// ── Auth token storage (JWT) — encrypted at rest via OS keychain (safeStorage),
// stored in userData. NEVER localStorage. Falls back to a userData file if the
// OS has no keychain (some headless Linux) — still off the renderer, still off disk-as-localStorage.
const AUTH_TOKEN_FILE = () => path.join(app.getPath('userData'), 'auth-token.bin')
ipcMain.handle('auth-get-token', () => {
  try {
    const f = AUTH_TOKEN_FILE()
    if (!fs.existsSync(f)) return null
    const buf = fs.readFileSync(f)
    if (safeStorage.isEncryptionAvailable()) { try { return safeStorage.decryptString(buf) } catch { return null } }
    return buf.toString('utf8')
  } catch { return null }
})
ipcMain.handle('auth-set-token', (_, token) => {
  try {
    const f = AUTH_TOKEN_FILE()
    fs.mkdirSync(path.dirname(f), { recursive: true })
    const data = safeStorage.isEncryptionAvailable()
      ? safeStorage.encryptString(String(token))
      : Buffer.from(String(token), 'utf8')
    fs.writeFileSync(f, data, { mode: 0o600 })
    return { ok: true }
  } catch (e) { return { ok: false, error: e.message } }
})
ipcMain.handle('auth-clear-token', () => { try { fs.rmSync(AUTH_TOKEN_FILE(), { force: true }) } catch {} ; return { ok: true } })
// Auth API base URL for the renderer (env-configurable; local fork by default).
ipcMain.on('get-api-base', e => { e.returnValue = API_BASE })
ipcMain.on('hide-window', () => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide() })
// Pin: stay above Zoom/Meet when switching windows. Unpin: hide when MockMate loses focus.
ipcMain.on('set-pin', (_, on) => {
  pinnedState = !!on
  if (!mainWindow || mainWindow.isDestroyed()) return
  try {
    if (on) {
      mainWindow.setAlwaysOnTop(true, 'screen-saver')
      mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    } else {
      // Stay floating lightly so the pill can remain visible; blur collapses instead of closing.
      mainWindow.setAlwaysOnTop(true, 'floating')
      try { mainWindow.setVisibleOnAllWorkspaces(false) } catch {}
    }
  } catch {}
})
ipcMain.handle('get-pin', () => pinnedState)
// Click-through: forward mouse events to apps underneath; pill/header still need
// setIgnoreMouseEvents(false) when interacting — renderer toggles this.
ipcMain.on('set-click-through', (_, on) => {
  if (!mainWindow || mainWindow.isDestroyed()) return
  try {
    if (on) mainWindow.setIgnoreMouseEvents(true, { forward: true })
    else mainWindow.setIgnoreMouseEvents(false)
  } catch {}
})
// Fine-grained region control while click-through is ON (hover interactive chrome → accept hits).
ipcMain.on('set-ignore-mouse-events', (_, { ignore, forward } = {}) => {
  if (!mainWindow || mainWindow.isDestroyed()) return
  try {
    if (ignore) mainWindow.setIgnoreMouseEvents(true, { forward: forward !== false })
    else mainWindow.setIgnoreMouseEvents(false)
  } catch {}
})
ipcMain.on('window-drag', (_, { dx, dy }) => {
  if (!mainWindow || mainWindow.isDestroyed()) return
  const [x, y] = mainWindow.getPosition(); mainWindow.setPosition(x + dx, y + dy)
  lastWindowMode = null   // geometry changed manually — let the next set-window-mode re-apply
})
ipcMain.on('window-resize', (_, { w, h, dx = 0, dy = 0 } = {}) => {
  if (!mainWindow || mainWindow.isDestroyed()) return
  const nw = Math.max(240, Math.round(Number(w) || 280))
  const nh = Math.max(180, Math.round(Number(h) || 200))
  try {
    if (dx || dy) {
      const [x, y] = mainWindow.getPosition()
      mainWindow.setBounds({ x: x + Math.round(dx), y: y + Math.round(dy), width: nw, height: nh })
    } else {
      mainWindow.setSize(nw, nh)
    }
  } catch {}
  // Persist HUD size whenever the user resizes (overlay or restoring from pill).
  if (lastWindowMode === 'overlay' || lastWindowMode === 'pill' || lastWindowMode == null) {
    if (nw < 900 && nh < 900) lastOverlaySize = { w: nw, h: nh }
  }
  lastWindowMode = null
})
// Switch between the full windowed dashboard ('app') and the compact overlay ('overlay').
ipcMain.on('set-window-mode', (_, mode) => {
  if (!mainWindow || mainWindow.isDestroyed() || mode === lastWindowMode) return
  suppressBlurHide(900)
  lastWindowMode = mode
  try {
    const { width, height } = screen.getPrimaryDisplay().workAreaSize
    if (mode === 'pill') {
      applyPillGeometry()
    } else if (mode === 'app') {
      const w = Math.min(1200, width - 80), h = Math.min(760, height - 80)
      mainWindow.setSize(w, h); mainWindow.center()
    } else {
      // Restore the user's last HUD size — never hard-reset to 300×360 after a resize.
      const w = Math.min(Math.max(240, lastOverlaySize.w || 300), width - 40)
      const h = Math.min(Math.max(180, lastOverlaySize.h || 360), height - 40)
      const [cx, cy] = mainWindow.getPosition()
      const x = Math.min(Math.max(0, cx), Math.max(0, width - w))
      const y = Math.min(Math.max(0, cy), Math.max(0, height - h))
      mainWindow.setBounds({ x, y, width: w, height: h })
    }
  } catch {}
})
// MERGE the submitted keys into the existing .env (so adding one key never wipes
// the others). Only non-empty incoming values overwrite; everything else is kept.

// Phase 6 — append privacy-safe session metrics (JSONL) under userData. Renderer must
// never send transcript/resume text; main still drops oversized / suspicious payloads.
ipcMain.handle('append-session-metrics', (_, row) => {
  try {
    if (!row || typeof row !== 'object') return { ok: false, error: 'bad row' }
    const raw = JSON.stringify(row)
    if (raw.length > 4000) return { ok: false, error: 'row too large' }
    if (/resume|transcript|fullAnswer|sampleAnswer/i.test(raw) && /:"[^"]{80,}"/.test(raw)) {
      return { ok: false, error: 'possible PII' }
    }
    const f = path.join(app.getPath('userData'), 'session-metrics.jsonl')
    fs.mkdirSync(path.dirname(f), { recursive: true })
    fs.appendFileSync(f, raw + '\n', { mode: 0o600 })
    return { ok: true }
  } catch (e) { return { ok: false, error: e.message } }
})

ipcMain.handle('read-session-metrics-summary', () => {
  try {
    const f = path.join(app.getPath('userData'), 'session-metrics.jsonl')
    if (!fs.existsSync(f)) return { sessions: 0 }
    const stat = fs.statSync(f)
    const bytes = Math.min(stat.size, 2 * 1024 * 1024)
    const buffer = Buffer.alloc(bytes)
    const fd = fs.openSync(f, 'r')
    try { fs.readSync(fd, buffer, 0, bytes, Math.max(0, stat.size - bytes)) } finally { fs.closeSync(fd) }
    const rows = buffer.toString('utf8').split(/\r?\n/).filter(Boolean).slice(-1000)
      .map(line => { try { return JSON.parse(line) } catch { return null } }).filter(Boolean)
    const sessions = rows.filter(r => r.type === 'session_end').slice(-30)
    const avg = key => {
      const vals = sessions.map(s => Number(s[key])).filter(Number.isFinite)
      return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null
    }
    return {
      sessions: sessions.length,
      avgTtftMs: avg('ttftAvgMs'),
      avgCommitMs: avg('avgTimeToCommitMs'),
      avgSttConfidence: (() => {
        const vals = sessions.map(s => Number(s.avgSttConfidence)).filter(Number.isFinite)
        return vals.length ? Number((vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(3)) : null
      })(),
      sttReconnects: sessions.reduce((n, s) => n + (Number(s.sttReconnects) || 0), 0),
      incompleteStreams: sessions.reduce((n, s) => n + (Number(s.incompleteStreams) || 0), 0),
      degradedSttFinals: sessions.reduce((n, s) => n + (Number(s.degradedSttFinals) || 0), 0),
    }
  } catch (e) { return { sessions: 0, error: e.message } }
})

ipcMain.handle('write-env', (_, content) => {
  try {
    // Write encrypted userData/.env.enc when safeStorage works (Phase 4). Never write the
    // project-root .env in dev — Vite would restart mid-session. Bundled keys stay hand-edited.
    const existing = parseEnvText(readUserEnvText())
    const incoming = parseEnvText(content)
    const ALLOWED = /(_API_KEY|_MODEL|_BASE_URL|_APP_ID|_APP_KEY)$/
    for (const [k, v] of Object.entries(incoming)) if (v && ALLOWED.test(k)) { existing[k] = v; process.env[k] = v }
    const merged = Object.entries(existing).map(([k, v]) => `${k}=${v}`).join('\n') + '\n'
    const { encrypted } = writeUserEnvText(merged)
    return { ok: true, encrypted }
  } catch (e) { return { ok: false, error: e.message } }
})
ipcMain.handle('remove-provider-key', (_, provider) => {
  const keysByProvider = {
    openai: ['OPENAI_API_KEY', 'OPENAI_MODEL', 'OPENAI_GPT5_MODEL', 'OPENAI_MINI_MODEL'],
    anthropic: ['ANTHROPIC_API_KEY', 'ANTHROPIC_OPUS_MODEL', 'ANTHROPIC_SONNET5_MODEL'],
    gemini: ['GEMINI_API_KEY', 'GEMINI_MODEL', 'GEMINI_3_MODEL', 'GEMINI_FLASH_LITE_MODEL'],
    groq: ['GROQ_API_KEY', 'GROQ_MODEL', 'GROQ_VISION_MODEL'],
    cerebras: ['CEREBRAS_API_KEY', 'CEREBRAS_MODEL'],
    deepgram: ['DEEPGRAM_API_KEY'],
    openai_model: ['OPENAI_MODEL', 'OPENAI_GPT5_MODEL', 'OPENAI_MINI_MODEL'],
    groq_vision: ['GROQ_VISION_MODEL'],
    custom_vision: ['VISION_API_KEY', 'VISION_MODEL', 'VISION_BASE_URL'],
    adzuna: ['ADZUNA_APP_ID', 'ADZUNA_APP_KEY'],
  }
  const keys = keysByProvider[String(provider || '').toLowerCase()]
  if (!keys) return { ok: false, error: 'Unknown provider' }
  try {
    const existing = parseEnvText(readUserEnvText())
    for (const key of keys) { delete existing[key]; delete process.env[key] }
    const merged = Object.entries(existing).map(([k, v]) => `${k}=${v}`).join('\n') + '\n'
    const { encrypted } = writeUserEnvText(merged)
    return { ok: true, encrypted }
  } catch (e) { return { ok: false, error: e.message } }
})
// Apply freshly-saved keys WITHOUT relaunching the app. Relaunch was the old way
// (app.relaunch + app.exit), but in dev `concurrently -k` kills Vite the instant
// Electron exits, so the relaunched window loaded a dead :5174 → blank screen.
// It also races the single-instance lock in prod. Instead we transition live:
// writeEnv already pushed the keys into process.env, so we just open the overlay
// (first run) or restart the API server (keys changed while running).
ipcMain.handle('apply-keys', () => {
  loadEnv()   // safety net: make sure file values are in process.env
  if (!mainWindow || mainWindow.isDestroyed()) {
    createMainWindow()
    launchTrayAndShortcuts()
    setupAutoUpdate()
  } else if (apiServer) {
    // Prod: forked server read its env at fork time — restart it to pick up new keys.
    try { apiServer.kill() } catch {}
    apiServer = null
    startApiServer(() => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.loadURL(PROD_URL) })
  } else {
    mainWindow.webContents.reload()   // dev: server is separate; just refresh providers
  }
  if (setupWindow && !setupWindow.isDestroyed()) setupWindow.close()
  return { ok: true }
})
// Kept for compatibility; no longer used by the setup flow.
ipcMain.handle('relaunch-app', () => { app.relaunch(); app.exit(0) })
// Open a billing URL in the user's default browser. Scoped to HTTPS Stripe hosts only — the URL
// comes from the backend, so an allowlist prevents a spoofed/compromised backend from launching an
// arbitrary link. Allowlisted destinations: Stripe (billing) + GitHub (manual update download).
const ALLOWED_EXTERNAL = /^https:\/\/([a-z0-9-]+\.)*(stripe\.com|github\.com)\//i
ipcMain.handle('open-external', (_e, url) => { if (typeof url === 'string' && ALLOWED_EXTERNAL.test(url)) shell.openExternal(url); return { ok: true } })
// Open the API-key setup window on demand (e.g. "Add API keys" from the overlay).
ipcMain.handle('open-key-setup', () => { if (!setupWindow) createSetupWindow(); else setupWindow.focus(); return { ok: true } })
