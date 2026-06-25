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

// Error reporting — inert unless SENTRY_DSN is set. beforeSend strips request bodies so a
// candidate's resume/transcript never rides along to Sentry (privacy-first).
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN, sendDefaultPii: false,
    beforeSend(event) { if (event.request) delete event.request.data; return event }
  })
}
import { makeReport, availableProviders, allProviders, deepgramConfigured, deepgramToken, searchConfigured } from './api/_lib/core.js'
import { interviewerTurn, evaluateSolo, generateHint, analyzeScreen, streamHint } from './api/_lib/interview.js'
import { findJobs } from './api/_lib/jobs.js'
import { atsScore, tailorResume, referralMessage } from './api/_lib/career.js'

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
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'blob:'],
      connectSrc: ["'self'", 'wss://api.deepgram.com', 'https://*.sentry.io', 'https://*.ingest.sentry.io', 'https://*.ingest.us.sentry.io'],
      workerSrc: ["'self'", 'blob:'],
      upgradeInsecureRequests: null,
    },
  },
  crossOriginResourcePolicy: false,
}))
app.use(cors({ origin: [/^http:\/\/localhost:\d+$/, /^http:\/\/127\.0\.0\.1:\d+$/] }))
app.use(express.json({ limit: '2mb' }))
app.use('/api', rateLimit({ windowMs: 60_000, max: 120, standardHeaders: true, legacyHeaders: false }))

app.get('/api/providers', (req, res) => res.json({ providers: availableProviders(), allProviders: allProviders(), deepgram: deepgramConfigured(), search: searchConfigured() }))

app.post('/api/deepgram-token', async (req, res) => {
  const host = req.headers.host || ''
  const local = host.startsWith('localhost') || host.startsWith('127.')
  try { res.json(await deepgramToken({ allowRawKey: local })) }
  catch (e) { report(e); res.status(e.status || 500).json({ error: e.message }) }
})

// Report only UNEXPECTED errors to Sentry (skip expected 4xx like 402 quota / 429 rate-limit /
// 400 validation, which are normal and would just be noise).
const report = e => { if (process.env.SENTRY_DSN && (!e?.status || e.status >= 500)) Sentry.captureException(e) }

// Shared POST route: call the lib fn with the JSON body, wrap the result under `key`
// (or return it raw when key is omitted), and shape errors uniformly.
const post = (path, fn, key) => app.post(path, async (req, res) => {
  try { const out = await fn(req.body || {}); res.json(key ? { [key]: out } : out) }
  catch (e) { report(e); res.status(e.status || 500).json({ error: e.message }) }
})

post('/api/report', makeReport, 'report')
post('/api/interview', interviewerTurn, 'turn')
post('/api/evaluate', evaluateSolo, 'report')
post('/api/hint', generateHint, 'hint')
post('/api/analyze-screen', analyzeScreen, 'analysis')
post('/api/jobs', findJobs)
post('/api/ats-score', atsScore)
post('/api/tailor-resume', tailorResume)
post('/api/referral', referralMessage)

// Server-Sent Events: stream the spoken answer token-by-token for <1s time-to-first-word.
app.post('/api/hint-stream', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders?.()
  // Detect a real client disconnect on the RESPONSE/socket. (req's 'close' fires
  // normally once the request body is read, which would wrongly suppress all writes.)
  let closed = false
  // Abort the upstream LLM stream when the client disconnects (a newer question superseded
  // this one) — otherwise it keeps generating server-side and bills tokens nobody sees.
  const ac = new AbortController()
  res.on('close', () => { closed = true; ac.abort() })
  const send = (event, data) => { if (!closed) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`) }
  try {
    const out = await streamHint(req.body || {}, {
      onMeta: m => send('meta', m),
      onToken: t => send('token', t),
      onUsage: u => send('usage', u),
      signal: ac.signal
    })
    send(out?.skipped ? 'skip' : 'done', {})
  } catch (e) {
    if (!closed && !ac.signal.aborted && e?.name !== 'AbortError') { report(e); send('error', { error: e.message }) }
  }
  if (!closed) res.end()
})

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
