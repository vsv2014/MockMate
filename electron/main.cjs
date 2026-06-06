// Electron main process — thin shell around the Vite dev server.
// The co-pilot BrowserWindow has setContentProtection(true):
//   Windows → SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE)
//   macOS   → NSWindow.sharingType = NSWindowSharingNone
// This blanks the window in ALL capture: Zoom, Teams, Meet, OBS, getDisplayMedia.
const { app, BrowserWindow, ipcMain, screen, desktopCapturer, globalShortcut } = require('electron')
const path = require('path')
const { fork } = require('child_process')

const isProd = app.isPackaged
const DEV_URL = 'http://localhost:5174'

let mainWindow, apiServer

// ── Start the Express API server (production only) ────────────────────────────
function startApiServer() {
  if (!isProd) return   // dev: server is started separately via npm run dev
  const serverEntry = path.join(app.getAppPath(), 'server-entry.cjs')
  // Load .env from userData so keys survive app updates
  const envPath = path.join(app.getPath('userData'), '.env')
  require('dotenv').config({ path: envPath })

  apiServer = fork(serverEntry, [], {
    env: { ...process.env, PORT: '3002', NODE_ENV: 'production' },
    cwd: app.getAppPath(),
    stdio: 'pipe'
  })
  apiServer.stdout?.on('data', d => console.log('[API]', d.toString().trim()))
  apiServer.stderr?.on('data', d => console.error('[API]', d.toString().trim()))
  apiServer.on('error', e => console.error('[API] fork error:', e.message))
}


function createMainWindow() {
  const { width } = screen.getPrimaryDisplay().workAreaSize
  mainWindow = new BrowserWindow({
    width: 460,
    height: 680,
    x: width - 480,
    y: 20,
    alwaysOnTop: true,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: true,
    skipTaskbar: true,   // hidden from taskbar and Alt+Tab switcher
    icon: path.join(__dirname, '../assets/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  // Main window is the only window — protect it from all screen capture
  mainWindow.setContentProtection(true)

  if (isProd) {
    // Production: load built Vite app, wait for API server to be ready
    const distIndex = path.join(app.getAppPath(), 'dist', 'index.html')
    setTimeout(() => mainWindow.loadFile(distIndex), 1500)  // wait for API to start
  } else {
    mainWindow.loadURL(DEV_URL)
  }

  mainWindow.on('closed', () => app.quit())
  // IPC to move/resize from React drag handle
  ipcMain.on('window-drag', (_, { dx, dy }) => {
    const [x, y] = mainWindow.getPosition()
    mainWindow.setPosition(x + dx, y + dy)
  })
  ipcMain.on('window-resize', (_, { w, h }) => {
    mainWindow.setSize(Math.max(320, w), Math.max(200, h))
  })
}

app.whenReady().then(() => {
  startApiServer()
  createMainWindow()

  // Alt+H / Ctrl+Shift+H — toggle window visibility at OS level
  // Works even when window is hidden (global shortcut fires regardless)
  const toggleVisibility = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    if (mainWindow.isVisible()) {
      mainWindow.hide()
      console.log('[MockMate] Window hidden — press Alt+H to restore')
    } else {
      mainWindow.show()
      mainWindow.focus()
      console.log('[MockMate] Window restored')
    }
  }
  globalShortcut.register('Alt+H', toggleVisibility)
  globalShortcut.register('CommandOrControl+Shift+H', toggleVisibility)

  // Tray icon as backup restore if shortcuts don't work
  const { Tray, Menu, nativeImage } = require('electron')
  try {
    const tray = new Tray(nativeImage.createEmpty())
    tray.setToolTip('MockMate — Click to show/hide')
    tray.on('click', toggleVisibility)
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Show MockMate', click: () => { mainWindow?.show(); mainWindow?.focus() } },
      { label: 'Quit', click: () => app.quit() }
    ]))
  } catch {} // tray not available on all Linux setups

  // Ctrl+Shift+U — capture screen and send to overlay for vision analysis
  globalShortcut.register('CommandOrControl+Shift+U', async () => {
    try {
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: 1920, height: 1080 }
      })
      if (!sources.length) return
      // Use the primary screen (first source)
      const png = sources[0].thumbnail.toPNG()
      const base64 = png.toString('base64')
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('screen-captured', base64)
      }
    } catch (e) {
      console.error('Screen capture failed:', e.message)
    }
  })
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
  apiServer?.kill()
})

// Auto-detect when Zoom / Teams / Meet is running — notify the UI
let meetingWasActive = false
setInterval(async () => {
  if (!mainWindow || mainWindow.isDestroyed()) return
  try {
    const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 0, height: 0 } })
    const active = sources.some(s => /zoom meeting|google meet|microsoft teams|webex|whereby/i.test(s.name))
    if (active !== meetingWasActive) {
      meetingWasActive = active
      mainWindow.webContents.send('meeting-detected', active)
    }
  } catch {}
}, 3000)

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// hint-update is handled in the React UI directly — no separate copilot window needed

// Return all desktop/window sources so the renderer can pick system audio.
ipcMain.handle('get-audio-sources', async () => {
  const sources = await desktopCapturer.getSources({
    types: ['screen', 'window'],
    thumbnailSize: { width: 0, height: 0 }
  })
  return sources.map(s => ({ id: s.id, name: s.name }))
})

ipcMain.on('get-userdata-path', e => { e.returnValue = app.getPath('userData') })

ipcMain.on('hide-window', () => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide()
})


