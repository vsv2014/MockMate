// Electron main — overlay window with setContentProtection(true):
//   Windows → WDA_EXCLUDEFROMCAPTURE,  macOS → NSWindowSharingNone
//   (Linux has no equivalent — overlay IS visible in screen share there.)
const { app, BrowserWindow, ipcMain, screen, desktopCapturer, globalShortcut, Notification, shell, dialog } = require('electron')
const path = require('path')
const fs = require('fs')
const { fork } = require('child_process')

const isProd = app.isPackaged
const DEV_URL = 'http://localhost:5174'
const PROD_URL = 'http://localhost:3002'

let mainWindow, setupWindow, apiServer

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
function loadEnv() {
  const candidates = [
    path.join(app.getPath('userData'), '.env'),
    path.join(path.dirname(app.getPath('exe')), '.env'),
    path.join(app.getAppPath(), '.env'),
  ]
  for (const envPath of candidates) {
    if (fs.existsSync(envPath)) require('dotenv').config({ path: envPath })
  }
}

function hasApiKeys() {
  return !!(process.env.GROQ_API_KEY || process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY || process.env.LLM_API_KEY)
}

function startApiServer(onReady) {
  const serverEntry = path.join(app.getAppPath(), 'server-entry.cjs')
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
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false }
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
    width: 460, height: 680, x: width - 480, y: 20,
    alwaysOnTop: true,
    frame: isLinux,                                   // Linux: normal window chrome so it's visible + movable
    transparent: !isLinux,                            // transparent overlay only on Win/macOS
    backgroundColor: isLinux ? '#08090e' : '#00000000',
    resizable: true, skipTaskbar: !isLinux,
    icon: iconPath(),
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false }
  })
  mainWindow.setContentProtection(true)

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
  const toggleVisibility = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    if (mainWindow.isVisible()) mainWindow.hide()
    else { mainWindow.show(); mainWindow.focus() }
  }
  globalShortcut.register('Alt+H', toggleVisibility)
  globalShortcut.register('CommandOrControl+Shift+H', toggleVisibility)

  const { Tray, Menu, nativeImage } = require('electron')
  const trayIcon = (() => { try { return nativeImage.createFromPath(iconPath()) } catch { return nativeImage.createEmpty() } })()
  try {
    const tray = new Tray(trayIcon)
    tray.setToolTip('MockMate — Click to show/hide')
    tray.on('click', toggleVisibility)
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Show MockMate', click: () => { mainWindow?.show(); mainWindow?.focus() } },
      { label: 'Quit', click: () => app.quit() }
    ]))
    if (Notification.isSupported()) {
      new Notification({
        title: 'MockMate is running',
        body: 'Overlay is top-right of your screen. Click the tray icon or press Alt+H to show/hide.',
        icon: trayIcon
      }).show()
    }
  } catch {}

  globalShortcut.register('CommandOrControl+Shift+U', captureScreen)
}

// Capture the primary screen and hand the PNG to the renderer for vision analysis.
// Called by the Ctrl+Shift+U shortcut AND by the in-app "Solve it" button (ipc).
async function captureScreen() {
  try {
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1920, height: 1080 } })
    if (!sources.length) return
    // Multi-monitor: pick the source for the PRIMARY display (where the call/problem
    // usually is), not an arbitrary sources[0]. Fall back to the first source.
    const primaryId = String(screen.getPrimaryDisplay().id)
    const chosen = sources.find(s => s.display_id === primaryId) || sources[0]
    const base64 = chosen.thumbnail.toPNG().toString('base64')
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('screen-captured', base64)
  } catch (e) { console.error('Screen capture failed:', e.message) }
}

// Protect EVERY window from screen capture — including the Document Picture-in-
// Picture "hints" window the renderer opens during a session (it's a separate
// top-level window that doesn't inherit the main window's affinity). No-op on Linux.
app.on('browser-window-created', (_, win) => {
  try { win.setContentProtection(process.platform !== 'linux') } catch {}
})

// Silent auto-update: download new releases in the background and install on the
// NEXT quit. No prompt/notification on purpose — a toast during a screen share
// would expose the app. The user just gets the new version next time they reopen.
function setupAutoUpdate() {
  if (!isProd) return
  try {
    const { autoUpdater } = require('electron-updater')
    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true
    autoUpdater.on('error', e => console.error('[updater]', e?.message))
    autoUpdater.on('update-downloaded', i => console.log('[updater] ready, installs on quit:', i?.version))
    autoUpdater.checkForUpdates().catch(e => console.error('[updater] check failed:', e?.message))
    // Re-check every 6h for long-running sessions
    setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 6 * 60 * 60 * 1000)
  } catch (e) { console.error('[updater] unavailable:', e?.message) }
}

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

  app.whenReady().then(() => {
    loadEnv()
    // ALWAYS open the single overlay window — no separate setup window. With the
    // bundled .env keys present it goes straight to work; if no keys are found the
    // overlay shows its inline "Add your API keys" form. One window, never two.
    createMainWindow()
    launchTrayAndShortcuts()
    setupAutoUpdate()
  })
}

app.on('will-quit', () => { globalShortcut.unregisterAll(); apiServer?.kill() })

// Auto-detect, by open window/tab titles: (1) a video meeting, (2) a coding platform.
const MEETING_RE = /zoom meeting|google meet|microsoft teams|webex|whereby/i
const CODING_RE  = /leetcode|hackerrank|coderpad|codesignal|hackerearth|codility|codingame|geeksforgeeks|interviewbit|codewars|online assessment|codepair|byteboard|replit/i
let meetingWasActive = false, codingWasActive = false
setInterval(async () => {
  if (!mainWindow || mainWindow.isDestroyed()) return
  try {
    const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 0, height: 0 } })
    const names = sources.map(s => s.name)
    const meeting = names.some(n => MEETING_RE.test(n))
    if (meeting !== meetingWasActive) { meetingWasActive = meeting; mainWindow.webContents.send('meeting-detected', meeting) }
    const coding = names.some(n => CODING_RE.test(n))
    if (coding !== codingWasActive) { codingWasActive = coding; mainWindow.webContents.send('coding-detected', coding) }
  } catch {}
}, 3000)

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })

ipcMain.handle('get-audio-sources', async () => {
  const sources = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 0, height: 0 } })
  return sources.map(s => ({ id: s.id, name: s.name }))
})
ipcMain.handle('capture-screen', () => captureScreen())   // "Solve it" button trigger
// PiP windows are auto-protected by the browser-window-created listener above.
// This confirms it to the renderer so it can warn honestly on Linux (no protection).
ipcMain.handle('exclude-from-capture', () => ({ ok: process.platform !== 'linux', id: 'pip' }))
ipcMain.on('get-userdata-path', e => { e.returnValue = app.getPath('userData') })
ipcMain.on('hide-window', () => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide() })
ipcMain.on('window-drag', (_, { dx, dy }) => {
  if (!mainWindow || mainWindow.isDestroyed()) return
  const [x, y] = mainWindow.getPosition(); mainWindow.setPosition(x + dx, y + dy)
})
ipcMain.on('window-resize', (_, { w, h }) => {
  if (!mainWindow || mainWindow.isDestroyed()) return
  mainWindow.setSize(Math.max(320, w), Math.max(200, h))
})
// MERGE the submitted keys into the existing .env (so adding one key never wipes
// the others). Only non-empty incoming values overwrite; everything else is kept.
ipcMain.handle('write-env', (_, content) => {
  try {
    // Always write userData/.env (loadEnv reads it first, as the user's override).
    // We deliberately do NOT write the project-root .env in dev: Vite watches it and
    // would restart the dev server mid-session, blanking the window. In dev the
    // bundled keys belong in the root .env you edit by hand (the source of truth).
    const envPath = path.join(app.getPath('userData'), '.env')
    fs.mkdirSync(path.dirname(envPath), { recursive: true })
    const parse = txt => Object.fromEntries((txt || '').split('\n')
      .map(l => l.trim()).filter(l => l && !l.startsWith('#') && l.includes('='))
      .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()] }))
    const existing = fs.existsSync(envPath) ? parse(fs.readFileSync(envPath, 'utf8')) : {}
    const incoming = parse(content)
    for (const [k, v] of Object.entries(incoming)) if (v) { existing[k] = v; process.env[k] = v }  // set non-empty + go live now
    const merged = Object.entries(existing).map(([k, v]) => `${k}=${v}`).join('\n') + '\n'
    fs.writeFileSync(envPath, merged, 'utf8')
    return { ok: true }
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
// Open the API-key setup window on demand (e.g. "Add API keys" from the overlay).
ipcMain.handle('open-key-setup', () => { if (!setupWindow) createSetupWindow(); else setupWindow.focus(); return { ok: true } })
