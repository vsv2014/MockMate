import fs from 'node:fs'

function patch(file, before, after, expected = 1) {
  const text = fs.readFileSync(file, 'utf8')
  const count = text.split(before).length - 1
  if (count !== expected) throw new Error(`${file}: expected ${expected} match(es), found ${count}: ${before.slice(0, 120)}`)
  fs.writeFileSync(file, text.replaceAll(before, after))
}

// Solo owns UI recovery only. Provider retry/failover belongs to the resilient core adapter.
patch('src/Solo.jsx', "import { isTransient } from '../shared/llm-errors.js'\n", '')
patch('src/Solo.jsx',
`    const retryTransient = async (msg, status) => {
      if (!isCurrent()) return null
      const transient = isTransient({ status, message: msg })
      if (transient && attempt < 2) {
        await new Promise(r => setTimeout(r, 1500 * (attempt + 1)))
        if (!isCurrent()) return null
        return requestTurn(current, attempt + 1, turnG)
      }
      // Hard failure — orphan rollback if last turn is a committed candidate`,
`    const retryTransient = async (msg, status) => {
      if (!isCurrent()) return null
      // The shared core adapter already performs bounded provider retry/failover. Never repeat the
      // entire interview request here: doing so multiplies latency/cost and can duplicate turns.
      // Any final failure rolls the candidate turn back so the user explicitly chooses Retry.
      // Hard failure — orphan rollback if last turn is a committed candidate`)

// Development uses the same forked local AI service as packaged builds. That makes Apply Keys
// actually restart the process that owns provider env instead of merely refreshing the renderer.
patch('package.json',
`    "electron:dev": "concurrently -k \\"node server.js\\" \\"vite\\" \\"wait-on http://localhost:5174 && electron .\\"",
    "electron:dev:nosandbox": "concurrently -k \\"node server.js\\" \\"vite\\" \\"wait-on http://localhost:5174 && electron . --no-sandbox\\"",`,
`    "electron:dev": "concurrently -k \\"vite\\" \\"wait-on http://localhost:5174 && electron .\\"",
    "electron:dev:nosandbox": "concurrently -k \\"vite\\" \\"wait-on http://localhost:5174 && electron . --no-sandbox\\"",`)
patch('electron/main.cjs',
`  if (isProd) {
    startApiServer(() => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.loadURL(PROD_URL) })
  } else {
    mainWindow.loadURL(DEV_URL)
  }`,
`  if (isProd) {
    startApiServer(() => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.loadURL(PROD_URL) })
  } else {
    // Dev still uses Vite for UI, but Electron owns the local AI child exactly as production does.
    // Provider key changes can therefore restart the real service without killing the dev session.
    startApiServer(() => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.loadURL(DEV_URL) })
  }`)
patch('electron/main.cjs',
`ipcMain.handle('install-update', () => {
  if (!autoUpdaterRef) return { ok: false, error: 'Updater is unavailable.' }
  try { autoUpdaterRef.quitAndInstall(); return { ok: true } }`,
`ipcMain.handle('install-update', () => {
  if (!autoUpdaterRef) return { ok: false, error: 'Updater is unavailable.' }
  if (lastWindowMode === 'overlay' || lastWindowMode === 'pill') {
    return { ok: false, error: 'End the active interview and return Home before installing the update.' }
  }
  try { autoUpdaterRef.quitAndInstall(); return { ok: true } }`)
patch('electron/main.cjs',
`    startApiServer(() => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.loadURL(PROD_URL) })`,
`    startApiServer(() => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.loadURL(isProd ? PROD_URL : DEV_URL) })`,
2)

console.log('audit-final-runtime-patch complete')
