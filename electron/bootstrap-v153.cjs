// v1.5.3 Windows installer/update handoff gate.
//
// v1.5.1/v1.5.2 tried to recover from `spawn ... MockMate.exe ENOENT` by
// waiting inside child_process.fork(). That still lets the application boot far
// enough to show misleading account-service errors while NSIS is replacing the
// installed executable. This entrypoint runs before the normal bootstrap and
// removes that race entirely.
const fs = require('fs')
const { app, dialog } = require('electron')

function installedExecutablePresent() {
  if (!app.isPackaged) return true
  try { return fs.existsSync(process.execPath) } catch { return false }
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
  // electron-updater v6 defaults to relaunching the app immediately after a
  // non-silent NSIS install. Disable that here before main.cjs obtains the shared
  // updater singleton. Users reopen MockMate only after NSIS has fully completed.
  try {
    const { autoUpdater } = require('electron-updater')
    autoUpdater.autoRunAppAfterInstall = false
    autoUpdater.autoInstallOnAppQuit = false
  } catch (error) {
    console.warn('[bootstrap-v153] updater preconfiguration unavailable:', error?.message)
  }

  require('./bootstrap.cjs')
}
