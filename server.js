// Serves BOTH /api/* and the built React UI for packaged Electron.
import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import * as Sentry from '@sentry/node'
import path from 'path'
import { fileURLToPath } from 'url'
import { registerApiRoutes } from './api/_lib/apiRoutes.js'
import { reasoningPolicy } from './backend/src/arch.js'
import { CODE_RUNNER_WORKER_CSP } from './shared/codeRunnerPolicy.js'
import { websocketOriginForApi } from './shared/networkOrigins.js'

if (process.env.SENTRY_DSN) {
  Sentry.init({ dsn: process.env.SENTRY_DSN, sendDefaultPii: false, beforeSend(event) { if (event.request) delete event.request.data; return event } })
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const distDir = path.join(__dirname, 'dist')
const PORT = Number(process.env.PORT) || 3002
const backendOrigin = process.env.MOCKMATE_API_BASE || null
const backendWebSocketOrigin = websocketOriginForApi(backendOrigin)
let livekitOrigin = null
try { if (process.env.LIVEKIT_URL) livekitOrigin = new URL(process.env.LIVEKIT_URL).origin } catch {}

const appOrigins = new Set([
  `http://127.0.0.1:${PORT}`,
  `http://localhost:${PORT}`,
  'http://127.0.0.1:5174',
  'http://localhost:5174',
])
function localOriginAllowed(origin) { return !origin || appOrigins.has(origin) }

const app = express()
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'blob:'],
      connectSrc: [
        "'self'",
        'http://localhost:4000', 'http://127.0.0.1:4000',
        ...(backendOrigin ? [backendOrigin] : []),
        ...(backendWebSocketOrigin ? [backendWebSocketOrigin] : []),
        'wss://api.deepgram.com', 'https://*.sentry.io', 'https://*.ingest.sentry.io', 'https://*.ingest.us.sentry.io',
        'wss://*.livekit.cloud', 'https://*.livekit.cloud', ...(livekitOrigin ? [livekitOrigin] : []),
      ],
      workerSrc: ["'self'", 'blob:'],
      upgradeInsecureRequests: null,
    },
  },
  crossOriginResourcePolicy: false,
}))

app.get('/code-runner-worker.js', (_req, res) => {
  res.setHeader('Content-Security-Policy', CODE_RUNNER_WORKER_CSP)
  res.setHeader('Cache-Control', 'no-store')
  res.sendFile(path.join(distDir, 'code-runner-worker.js'))
})

app.use(cors({ origin(origin, cb) { localOriginAllowed(origin) ? cb(null, true) : cb(new Error('Origin not allowed by MockMate local API')) } }))
app.use('/api', (req, res, next) => {
  const origin = req.get('Origin')
  if (!localOriginAllowed(origin)) return res.status(403).json({ error: 'This local API is only available to the MockMate renderer.' })
  next()
})
app.use(express.json({ limit: '2mb' }))
app.use('/api', rateLimit({ windowMs: 60_000, max: 120, standardHeaders: true, legacyHeaders: false }))

const report = e => { if (process.env.SENTRY_DSN && (!e?.status || e.status >= 500)) Sentry.captureException(e) }
registerApiRoutes(app, { report, reasoningPolicy })

app.use(express.static(distDir))
app.use((req, res, next) => {
  if (req.path.startsWith('/api')) return next()
  res.sendFile(path.join(distDir, 'index.html'))
})

const server = app.listen(PORT, '127.0.0.1', () => {
  process.send?.({ type: 'ready' })
  console.log(`MockMate server on 127.0.0.1:${PORT} (UI + /api/*)`)
})
server.on('error', err => {
  console.error(`MockMate server failed to start on :${PORT} — ${err.code || err.message}`)
  process.send?.({ type: 'server-error', code: err.code, message: err.message })
  process.exit(1)
})

let closing = false
function shutdown(signal) {
  if (closing) return
  closing = true
  const force = setTimeout(() => process.exit(1), 5000)
  force.unref?.()
  server.close(() => { clearTimeout(force); process.exit(0) })
}
process.once('SIGTERM', () => shutdown('SIGTERM'))
process.once('SIGINT', () => shutdown('SIGINT'))
