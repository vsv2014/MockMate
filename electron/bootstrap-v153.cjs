// Windows installer/update and packaged-child bootstrap guard.
//
// v1.5.1/v1.5.2 tried to recover from `spawn ... MockMate.exe ENOENT` by
// waiting inside child_process.fork(). v1.5.3 also removed unsafe installer
// auto-relaunch paths. A second ENOENT cause remains on packaged Windows builds:
// Node reports the same spawn error when the child `cwd` is not a real OS
// directory. app.getAppPath() points inside app.asar when packaged, and an ASAR
// virtual path cannot be used as a Windows process working directory.
const fs = require('fs')
const path = require('path')
const childProcess = require('child_process')
const { app, dialog } = require('electron')

function installedExecutablePresent() {
  if (!app.isPackaged) return true
  try { return fs.existsSync(process.execPath) } catch { return false }
}

function installRealServiceForkCwd() {
  if (!app.isPackaged) return
  const originalFork = childProcess.fork.bind(childProcess)
  childProcess.fork = function forkWithRealServiceCwd(modulePath, args, options) {
    const isMockMateService = /(?:^|[\\/])server-entry\.cjs$/i.test(String(modulePath || ''))
    if (!isMockMateService) return originalFork(modulePath, args, options)

    // Never use app.getAppPath()/app.asar as an OS process working directory.
    // Keep cwd separate from userData's config files so dotenv/config cannot
    // accidentally treat a userData .env as a process-cwd environment file.
    const cwd = path.join(app.getPath('userData'), 'runtime')
    fs.mkdirSync(cwd, { recursive: true })
    if (!fs.statSync(cwd).isDirectory()) throw new Error(`MockMate runtime directory is unavailable: ${cwd}`)
    return originalFork(modulePath, args, { ...(options || {}), cwd })
  }
}

if (!installedExecutablePresent()) {
  // Do not load bootstrap.cjs/main.cjs and, critically, do not fork the local API
  // or account service. A running image can survive briefly after NSIS removes or
  // replaces its on-disk EXE; spawning children from process.execPath in that state
  // is guaranteed to fail with ENOENT.
  app.whenReady().then(() => {
    const exe = String(process.execPath || 'MockMate.exe')
    dialog.showMessageBoxSync({
      type: 'warning',
      title: 'MockMate installation is still finishing',
      message: 'MockMate will close so Windows can finish installing the application safely.',
      detail: `The installed executable is temporarily unavailable:\n${exe}\n\nWait for the installer to finish, then open MockMate again from the Start menu or desktop shortcut. If the file is still missing afterwards, check Windows Security → Protection history and reinstall MockMate.`,
      buttons: ['Close MockMate'],
      defaultId: 0,
      noLink: true,
    })
    app.quit()
  }).catch(() => app.quit())
} else {
  // Normalize packaged service cwd BEFORE bootstrap.cjs captures childProcess.fork.
  // bootstrap.cjs will layer its existing service supervision around this wrapper.
  installRealServiceForkCwd()

  // electron-updater v6 defaults to relaunching the app immediately after a
  // non-silent NSIS install. Disable that here before main.cjs obtains the shared
  // updater singleton. Users reopen MockMate only after NSIS has fully completed.
  try {
    const { autoUpdater } = require('electron-updater')
    autoUpdater.autoRunAppAfterInstall = false
    autoUpdater.autoInstallOnAppQuit = false
  } catch (error) {
    console.warn('[bootstrap] updater preconfiguration unavailable:', error?.message)
  }

  require('./bootstrap.cjs')
}
