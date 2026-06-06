// Electron main process — thin shell around the Vite dev server.
// The co-pilot BrowserWindow has setContentProtection(true):
//   Windows → SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE)
//   macOS   → NSWindow.sharingType = NSWindowSharingNone
// This blanks the window in ALL capture: Zoom, Teams, Meet, OBS, getDisplayMedia.
const { app, BrowserWindow, ipcMain, screen, desktopCapturer, globalShortcut } = require('electron')
const path = require('path')

const DEV_URL = 'http://localhost:5174'

let mainWindow, copilotWindow

function createCopilotWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize
  copilotWindow = new BrowserWindow({
    width: 420,
    height: 400,
    x: width - 440,
    y: 20,
    alwaysOnTop: true,
    frame: false,
    transparent: false,
    resizable: true,
    skipTaskbar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload-copilot.cjs'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  // This is the key call — blanks the window from every screen capture tool at the OS level.
  copilotWindow.setContentProtection(true)

  copilotWindow.loadFile(path.join(__dirname, 'copilot.html'))
  copilotWindow.on('closed', () => { copilotWindow = null })
}

function createMainWindow() {
  const { width } = screen.getPrimaryDisplay().workAreaSize
  mainWindow = new BrowserWindow({
    width: 460,
    height: 680,
    x: width - 480,
    y: 20,
    alwaysOnTop: true,          // floats over Zoom / Teams / Meet / any app
    frame: false,               // no OS titlebar — we have our own drag handle
    transparent: false,         // disabled — Linux compositor doesn't support this reliably
    backgroundColor: '#00000000',
    resizable: true,
    skipTaskbar: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  mainWindow.loadURL(DEV_URL)
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
  createCopilotWindow()
  createMainWindow()

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
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// Hint update from React → forward to the protected co-pilot window.
ipcMain.on('hint-update', (_, data) => {
  if (!copilotWindow || copilotWindow.isDestroyed()) return
  copilotWindow.show()
  copilotWindow.webContents.send('hint-data', data)
})

// Return all desktop/window sources so the renderer can pick system audio.
ipcMain.handle('get-audio-sources', async () => {
  const sources = await desktopCapturer.getSources({
    types: ['screen', 'window'],
    thumbnailSize: { width: 0, height: 0 }
  })
  return sources.map(s => ({ id: s.id, name: s.name }))
})

// Candidate left the room — hide co-pilot.
ipcMain.on('room-state', (_, { active }) => {
  if (!copilotWindow || copilotWindow.isDestroyed()) return
  if (!active) copilotWindow.hide()
})
