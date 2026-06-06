// CJS entry point — Electron forks this to start the ES module API server.
// Node forks require CJS; this uses dynamic import() to load the ES module.
;(async () => {
  try {
    await import('./server.js')
  } catch (e) {
    console.error('[MockMate API] Failed to start:', e.message)
    process.exit(1)
  }
})()
