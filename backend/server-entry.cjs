// CJS entry — Electron forks this to start the ESM auth backend (mirrors the
// root server-entry.cjs pattern, which is proven to run under Electron's fork).
;(async () => {
  try {
    await import('./server.js')
  } catch (e) {
    console.error('[backend] Failed to start:', e.message)
    process.exit(1)
  }
})()
