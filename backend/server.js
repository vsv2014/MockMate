import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import { initStore } from './src/store.js'
import authRoutes from './src/routes/auth.js'
import meRoutes from './src/routes/me.js'

// JWT secret must exist before any route signs/verifies. When forked by the
// desktop app, Electron passes a persistent per-install secret (see main.cjs).
// Standalone dev without one set is allowed but logs a loud warning.
if (!process.env.JWT_SECRET) {
  process.env.JWT_SECRET = 'mockmate-dev-insecure-secret-change-me'
  console.warn('[backend] JWT_SECRET not set — using an insecure dev default. Do NOT ship like this.')
}

const app = express()
app.use(cors())                       // desktop renderer is a different origin (localhost:5174 / :3002 / file://)
app.use(express.json({ limit: '2mb' }))

app.get('/health', (req, res) => res.json({ ok: true }))
app.use('/auth', authRoutes)
app.use('/me', meRoutes)

const PORT = Number(process.env.PORT) || 4000

initStore()
  .then(async () => {
    // Session sync (Phase 4) is Mongo-only — mounting it in file mode would pull in
    // mongoose at import time. Only wire it when a real DB is configured.
    if (process.env.MONGO_URI) {
      const { default: sessionRoutes } = await import('./src/routes/sessions.js')
      app.use('/sessions', sessionRoutes)
    }
    const server = app.listen(PORT, '127.0.0.1', () => {
      console.log(`[backend] auth API on http://127.0.0.1:${PORT}`)
      process.send?.({ type: 'ready', port: PORT })   // tell the Electron parent we're up
    })
    server.on('error', e => {
      console.error('[backend] listen failed:', e.message)
      process.send?.({ type: 'server-error', code: e.code, message: e.message })
      process.exit(1)
    })
  })
  .catch(e => {
    console.error('[backend] startup failed:', e.message)
    process.send?.({ type: 'server-error', message: e.message })
    process.exit(1)
  })
