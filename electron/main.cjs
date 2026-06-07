// Electron main — overlay window with setContentProtection(true):
//   Windows → WDA_EXCLUDEFROMCAPTURE,  macOS → NSWindowSharingNone
//   (Linux has no equivalent — overlay IS visible in screen share there.)
const { app, BrowserWindow, ipcMain, screen, desktopCapturer, globalShortcut, Notification, shell } = require('electron')
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

function loadEnv() {
  const exeEnv  = path.join(path.dirname(app.getPath('exe')), '.env')
  const userEnv = path.join(app.getPath('userData'), '.env')
  const envPath = fs.existsSync(exeEnv) ? exeEnv : userEnv
  require('dotenv').config({ path: envPath })
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
  apiServer.on('message', msg => { if (msg?.type === 'ready') fire() })
  setTimeout(fire, 6000)   // fallback if 'ready' never arrives
}

function createSetupWindow() {
  setupWindow = new BrowserWindow({
    width: 520, height: 700, resizable: false, center: true,
    title: 'MockMate — Setup',
    icon: assetsPath('icon.png'),
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
  mainWindow = new BrowserWindow({
    width: 460, height: 680, x: width - 480, y: 20,
    alwaysOnTop: true, frame: false, transparent: true, backgroundColor: '#00000000',
    resizable: true, skipTaskbar: process.platform !== 'linux',
    icon: assetsPath('icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false }
  })
  mainWindow.setContentProtection(true)

  mainWindow.webContents.on('did-fail-load', () => {
    setTimeout(() => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.loadURL(PROD_URL) }, 800)
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
  const trayIcon = (() => { try { return nativeImage.createFromPath(assetsPath('icon.png')) } catch { return nativeImage.createEmpty() } })()
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

app.whenReady().then(() => {
  loadEnv()
  if (!hasApiKeys()) {
    createSetupWindow()
  } else {
    createMainWindow()
    launchTrayAndShortcuts()
  }
})

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
ipcMain.handle('write-env', (_, content) => {
  try {
    const envPath = path.join(app.getPath('userData'), '.env')
    fs.mkdirSync(path.dirname(envPath), { recursive: true })
    fs.writeFileSync(envPath, content, 'utf8')
    return { ok: true }
  } catch (e) { return { ok: false, error: e.message } }
})
ipcMain.handle('relaunch-app', () => { app.relaunch(); app.exit(0) })
