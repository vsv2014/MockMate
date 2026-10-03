import fs from 'node:fs'

function patch(file, before, after) {
  const text = fs.readFileSync(file, 'utf8')
  const count = text.split(before).length - 1
  if (count !== 1) throw new Error(`${file}: expected one match, found ${count}: ${before.slice(0, 120)}`)
  fs.writeFileSync(file, text.replace(before, after))
}

patch('electron/bootstrap.cjs',
`// Every new Win/macOS window starts protected after all synchronous create listeners have run.
// The main window can still explicitly disable protection later when the user turns Stealth off.
app.on('browser-window-created', (_event, win) => {
  if (process.platform !== 'linux') {
    setImmediate(() => { try { if (!win.isDestroyed()) win.setContentProtection(true) } catch {} })
  } else {`,
`// Every new Win/macOS window is protected synchronously before its first frame can be shown.
// The main window can still explicitly disable protection later when the user turns Stealth off.
app.on('browser-window-created', (_event, win) => {
  if (process.platform !== 'linux') {
    try { if (!win.isDestroyed()) win.setContentProtection(true) } catch {}
  } else {`)

patch('electron/main.cjs',
`let trayRef = null
let mainWindow, setupWindow, apiServer, backendServer`,
`let trayRef = null
let quitDrainStarted = false
let mainWindow, setupWindow, apiServer, backendServer`)

patch('electron/main.cjs',
`// New windows start unprotected. Explicit protected-hints actions opt their
// window in; normal MockMate windows remain visible in capture when Stealth is off.
app.on('browser-window-created', (_, win) => {
  try { win.setContentProtection(false) } catch {}
})`,
`// Privacy-safe default: new Win/macOS windows are protected before their first frame.
// The renderer may explicitly disable protection later when the user turns Stealth off.
app.on('browser-window-created', (_, win) => {
  try { win.setContentProtection(process.platform !== 'linux') } catch {}
})`)

patch('electron/main.cjs',
`app.on('will-quit', () => {`,
`app.on('before-quit', e => {
  if (quitDrainStarted || !diagnostics) return
  e.preventDefault()
  quitDrainStarted = true
  Promise.resolve(diagnostics.close())
    .catch(err => console.warn('[diagnostics] final drain failed:', err?.message || err))
    .finally(() => app.quit())
})

app.on('will-quit', () => {`)

console.log('last-mile Electron lifecycle patch complete')
