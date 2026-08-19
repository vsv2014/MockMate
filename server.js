// Serves BOTH the /api/* routes AND the built React UI (dist/) so the packaged
// Electron app loads the renderer over http://localhost:PORT — making /assets
// and /api same-origin. (Loading the renderer via file:// breaks both: absolute
// /assets paths 404 and /api calls resolve to file:///api.) Also the dev API shim.
import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import * as Sentry from '@sentry/node'
import path from 'path'
import { fileURLToPath } from 'url'
import { registerApiRoutes } from './api/_lib/apiRoutes.js'
import { CODE_RUNNER_WORKER_CSP } from './shared/codeRunnerPolicy.js'

// Error reporting — inert unless SENTRY_DSN is set. beforeSend strips request bodies so a
// candidate's resume/transcript never rides along to Sentry (privacy-first).
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN, sendDefaultPii: false,
    beforeSend(event) { if (event.request) delete event.request.data; return event }
  })
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const distDir = path.join(__dirname, 'dist')

const app = express()
// Hardening for the local API server. CSP is handled in the renderer (disabled here so it
// can't break the bundled SPA). CORS is restricted to the app's own origins (Vite dev :5174
// + prod :3002). The rate-limit is generous — an abuse guard that never hits a real user.
// CSP — only reaches the renderer in PROD (in dev the UI is served by Vite on :5174, not
// Express, so HMR is untouched). Crafted from what dist/index.html actually loads:
//   script 'self' (external bundle, no inline scripts) · style 'unsafe-inline' (React inline
//   styles + the injected <style> keyframes) · connect to /api + Deepgram WSS + Sentry ingest.
//   upgradeInsecureRequests is DISABLED — otherwise it would force http://localhost → https
//   and blank the app.
//   The renderer (served here on :3002) ALSO talks to the separate auth/managed backend on a
//   different loopback port (default :4000, or MOCKMATE_API_BASE when hosted). Those cross-origin
//   fetches (login/signup/me + managed /api/*) must be in connect-src or the browser blocks them —
//   which is exactly why managed mode broke in the packaged app once the renderer started calling
//   the backend (dev works because Vite serves with no CSP).
const backendOrigin = process.env.MOCKMATE_API_BASE || null
// Duo (LiveKit) connects a WebSocket to the room's signaling URL. Allow LiveKit Cloud (wss) + the
// configured LIVEKIT_URL origin, else the packaged app's CSP blocks the room from ever connecting.
let livekitOrigin = null
try { if (process.env.LIVEKIT_URL) livekitOrigin = new URL(process.env.LIVEKIT_URL).origin } catch {}
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'blob:'],
      connectSrc: [
        "'self'",
        // Local auth/managed backend fork — any loopback port (default :4000, configurable).
        'http://localhost:*', 'http://127.0.0.1:*',
        // Hosted backend when MOCKMATE_API_BASE points at one (e.g. https://api.mockmate.app).
        ...(backendOrigin ? [backendOrigin] : []),
        'wss://api.deepgram.com', 'https://*.sentry.io', 'https://*.ingest.sentry.io', 'https://*.ingest.us.sentry.io',
        // Duo rooms (LiveKit) — signaling WebSocket + media.
        'wss://*.livekit.cloud', 'https://*.livekit.cloud', ...(livekitOrigin ? [livekitOrigin] : []),
      ],
      workerSrc: ["'self'", 'blob:'],
      upgradeInsecureRequests: null,
    },
  },
  crossOriginResourcePolicy: false,
}))

// The disposable code runner intentionally evaluates candidate JavaScript inside a
// dedicated Worker. Keep `unsafe-eval` out of the renderer's CSP and grant it only
// to this one worker response. `connect-src 'none'` ensures evaluated code cannot
// call the network even if it replaces the worker's stubbed browser APIs.
app.get('/code-runner-worker.js', (_req, res) => {
  res.setHeader('Content-Security-Policy', CODE_RUNNER_WORKER_CSP)
  res.setHeader('Cache-Control', 'no-store')
  res.sendFile(path.join(distDir, 'code-runner-worker.js'))
})
app.use(cors({ origin: [/^http:\/\/localhost:\d+$/, /^http:\/\/127\.0\.0\.1:\d+$/] }))
app.use(express.json({ limit: '2mb' }))
app.use('/api', rateLimit({ windowMs: 60_000, max: 120, standardHeaders: true, legacyHeaders: false }))

// Report only UNEXPECTED errors to Sentry (skip expected 4xx like 402 quota / 429 rate-limit /
// 400 validation, which are normal and would just be noise).
const report = e => { if (process.env.SENTRY_DSN && (!e?.status || e.status >= 500)) Sentry.captureException(e) }

// Single route registrar — same engine as managed backend (no auth locally = BYOK loopback).
registerApiRoutes(app, { report })

// Serve the built React app (production) + SPA fallback for non-API routes
app.use(express.static(distDir))
app.use((req, res, next) => {
  if (req.path.startsWith('/api')) return next()
  res.sendFile(path.join(distDir, 'index.html'))
})

const PORT = process.env.PORT || 3002
// Bind to loopback only — this server holds the user's keys; it must never be reachable
// from the local network, only from the Electron renderer on the same machine.
const server = app.listen(PORT, '127.0.0.1', () => {
  if (process.send) process.send({ type: 'ready' })   // tell Electron main the server is up
  console.log(`MockMate server on 127.0.0.1:${PORT} (UI + /api/*)`)
})
// Without this, a busy port (e.g. a stale process left after a force-kill) throws an
// unhandled EADDRINUSE, the fork dies before sending 'ready', and Electron's main
// process falls back to loading a dead URL → a blank window with no explanation.
// Surface it to the parent so it can show a real error instead.
server.on('error', err => {
  console.error(`MockMate server failed to start on :${PORT} — ${err.code || err.message}`)
  if (process.send) process.send({ type: 'server-error', code: err.code, message: err.message })
  process.exit(1)
})
