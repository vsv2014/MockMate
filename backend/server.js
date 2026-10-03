import 'dotenv/config'
import dotenv from 'dotenv'
import os from 'os'
import path from 'path'
import express from 'express'
import cors from 'cors'
import { initStore, storeMode, storeReady, closeStore } from './src/store.js'
import authRoutes from './src/routes/auth.js'
import meRoutes from './src/routes/me.js'
import { requireAuth } from './src/middleware/auth.js'
import { checkCap, recordLlm, releaseLlm, enforceManagedModelPolicy } from './src/middleware/meter.js'
import { registerApiRoutes } from '../api/_lib/apiRoutes.js'
import billingRoutes, { stripeWebhook } from './src/routes/billing.js'
import { assertHostedConfig, envFlag, isPublicBind, parseCorsOrigins } from './src/hostedConfig.js'
import { publicCapabilityStatus } from './src/arch.js'

const MM_DATA_DIR = process.env.MOCKMATE_DATA_DIR
  || (process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Application Support', 'mockmate')
    : process.platform === 'win32' ? path.join(process.env.APPDATA || os.homedir(), 'mockmate')
      : path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'mockmate'))
try { dotenv.config({ path: path.join(MM_DATA_DIR, '.env') }) } catch {}

const PUBLIC_BIND = isPublicBind()
const HOSTED_ENV = envFlag('MOCKMATE_HOSTED')
if (!process.env.JWT_SECRET) {
  if (PUBLIC_BIND || HOSTED_ENV) {
    console.error('[backend] FATAL: JWT_SECRET is required in hosted/public mode.')
    process.exit(1)
  }
  process.env.JWT_SECRET = 'mockmate-dev-insecure-secret-change-me'
  console.warn('[backend] JWT_SECRET not set — using an insecure dev default (loopback only). Do NOT ship like this.')
}

let hostedConfig
try { hostedConfig = assertHostedConfig() }
catch (error) { console.error(`[backend] FATAL: ${error.message}`); process.exit(1) }

// Downstream adapters historically checked only literal "1". Normalize once after
// validation so diagnostics, STT and provider behavior cannot disagree about hosted mode.
if (hostedConfig?.hosted) process.env.MOCKMATE_HOSTED = '1'
process.env.MOCKMATE_MANAGED = '1'

const app = express()
const trustProxyHops = Number(process.env.TRUST_PROXY_HOPS || 0)
if (PUBLIC_BIND && Number.isInteger(trustProxyHops) && trustProxyHops > 0) app.set('trust proxy', trustProxyHops)

const CORS_ALLOW = hostedConfig?.corsOrigins || parseCorsOrigins()
function corsOriginAllowed(origin) {
  if (!origin) return true
  if (CORS_ALLOW.includes(origin)) return true
  if (!hostedConfig?.hosted && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)) return true
  return false
}
app.use(cors({
  origin(origin, cb) { corsOriginAllowed(origin) ? cb(null, true) : cb(new Error('CORS origin is not allowed')) },
  credentials: true,
}))

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('Referrer-Policy', 'no-referrer')
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin')
  if (hostedConfig?.hosted) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
  next()
})

app.use((req, res, next) => {
  const supplied = String(req.get('X-MockMate-Request-Id') || '')
  req.requestId = /^[a-zA-Z0-9_-]{6,96}$/.test(supplied) ? supplied : `srv_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
  res.setHeader('X-MockMate-Request-Id', req.requestId)
  const started = Date.now()
  res.on('finish', () => console.log(JSON.stringify({
    ts: new Date().toISOString(), component: 'http', event: 'request_completed', requestId: req.requestId,
    method: req.method, path: req.path, status: res.statusCode, durationMs: Date.now() - started, authenticated: !!req.userId,
  })))
  next()
})

app.post('/billing/webhook', express.raw({ type: 'application/json' }), stripeWebhook)
app.use(express.json({ limit: '2mb' }))

let processReady = false
const healthy = () => processReady && storeReady()
app.get('/health', (req, res) => res.status(healthy() ? 200 : 503).json({ ok: healthy(), service: 'mockmate-backend' }))
app.get('/ready', (req, res) => res.status(healthy() ? 200 : 503).json({ ok: healthy(), store: storeMode() || 'starting', hosted: Boolean(hostedConfig?.hosted) }))
app.get('/arch/capabilities', requireAuth, (req, res) => res.json(publicCapabilityStatus({ hosted: Boolean(hostedConfig?.hosted) })))
app.use('/auth', authRoutes)
app.use('/me', meRoutes)
app.use('/billing', billingRoutes)

registerApiRoutes(app, {
  auth: [requireAuth, checkCap, enforceManagedModelPolicy],
  authLight: [requireAuth],
  onLlm: recordLlm,
  onLlmFailure: releaseLlm,
})

const PORT = Number(process.env.PORT) || 4000
let server = null
let shuttingDown = false

async function shutdown(signal) {
  if (shuttingDown) return
  shuttingDown = true
  processReady = false
  console.log(`[backend] ${signal}: draining`)
  const force = setTimeout(() => process.exit(1), 10_000)
  force.unref?.()
  try {
    if (server) await new Promise(resolve => server.close(() => resolve()))
    await closeStore()
    clearTimeout(force)
    process.exit(0)
  } catch (error) {
    console.error('[backend] shutdown failed:', error?.message || error)
    clearTimeout(force)
    process.exit(1)
  }
}
process.once('SIGTERM', () => shutdown('SIGTERM'))
process.once('SIGINT', () => shutdown('SIGINT'))

initStore()
  .then(async () => {
    if (storeMode() === 'mongo') {
      const { default: sessionRoutes } = await import('./src/routes/sessions.js')
      const { default: documentRoutes } = await import('./src/routes/documents.js')
      const { default: uploadRoutes } = await import('./src/routes/uploads.js')
      const { default: transcribeRoutes } = await import('./src/routes/transcribe.js')
      app.use('/sessions', sessionRoutes)
      app.use('/documents', documentRoutes)
      app.use('/documents/upload', uploadRoutes)
      app.use('/transcribe', transcribeRoutes)
    }
    const HOST = process.env.HOST || '127.0.0.1'
    if (storeMode() !== 'mongo' && HOST !== '127.0.0.1' && HOST !== 'localhost') {
      throw new Error(`Refusing to bind ${HOST} without Mongo storage (usage caps would be disabled).`)
    }
    server = app.listen(PORT, HOST, () => {
      processReady = true
      console.log(`[backend] auth${storeMode() === 'mongo' ? '+managed AI' : ''} API on http://${HOST}:${PORT} (store: ${storeMode()})`)
      process.send?.({ type: 'ready', port: PORT })
    })
    server.on('error', e => {
      processReady = false
      console.error('[backend] listen failed:', e.message)
      process.send?.({ type: 'server-error', code: e.code, message: e.message })
      process.exit(1)
    })
  })
  .catch(e => {
    processReady = false
    console.error('[backend] startup failed:', e.message)
    process.send?.({ type: 'server-error', message: e.message })
    process.exit(1)
  })
