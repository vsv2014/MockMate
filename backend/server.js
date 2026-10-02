import 'dotenv/config'
import dotenv from 'dotenv'
import os from 'os'
import path from 'path'
import express from 'express'
import cors from 'cors'
import { initStore } from './src/store.js'
import authRoutes from './src/routes/auth.js'
import meRoutes from './src/routes/me.js'
import { requireAuth } from './src/middleware/auth.js'
import { checkCap, recordLlm, releaseLlm, enforceManagedModelPolicy } from './src/middleware/meter.js'
import { registerApiRoutes } from '../api/_lib/apiRoutes.js'
import billingRoutes, { stripeWebhook } from './src/routes/billing.js'
import { assertHostedConfig, isPublicBind, parseCorsOrigins } from './src/hostedConfig.js'
import { publicCapabilityStatus } from './src/arch.js'

const MM_DATA_DIR = process.env.MOCKMATE_DATA_DIR
  || (process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Application Support', 'mockmate')
    : process.platform === 'win32' ? path.join(process.env.APPDATA || os.homedir(), 'mockmate')
    : path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'mockmate'))
try { dotenv.config({ path: path.join(MM_DATA_DIR, '.env') }) } catch {}

const PUBLIC_BIND = isPublicBind()
if (!process.env.JWT_SECRET) {
  if (PUBLIC_BIND || process.env.MOCKMATE_HOSTED === '1') {
    console.error('[backend] FATAL: JWT_SECRET is required in hosted/public mode.')
    process.exit(1)
  }
  process.env.JWT_SECRET = 'mockmate-dev-insecure-secret-change-me'
  console.warn('[backend] JWT_SECRET not set — using an insecure dev default (loopback only). Do NOT ship like this.')
}

let hostedConfig
try {
  hostedConfig = assertHostedConfig()
} catch (error) {
  console.error(`[backend] FATAL: ${error.message}`)
  process.exit(1)
}

if (process.env.STRIPE_SECRET_KEY && !process.env.STRIPE_WEBHOOK_SECRET) {
  console.warn('[backend] STRIPE_SECRET_KEY is set but STRIPE_WEBHOOK_SECRET is missing — webhooks will 400 and plans will NOT upgrade. Set STRIPE_WEBHOOK_SECRET.')
}

process.env.MOCKMATE_MANAGED = '1'

const app = express()
if (PUBLIC_BIND) app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS || 1))
const CORS_ALLOW = hostedConfig?.corsOrigins || parseCorsOrigins()
function corsOriginAllowed(origin) {
  if (!origin) return true
  if (CORS_ALLOW.includes(origin)) return true
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)) return true
  return false
}
app.use(cors({
  origin(origin, cb) {
    if (corsOriginAllowed(origin)) return cb(null, true)
    cb(new Error('CORS origin is not allowed'))
  },
  credentials: true,
}))

app.post('/billing/webhook', express.raw({ type: 'application/json' }), stripeWebhook)
app.use(express.json({ limit: '2mb' }))

app.use((req, res, next) => {
  const supplied = String(req.get('X-MockMate-Request-Id') || '')
  req.requestId = /^[a-zA-Z0-9_-]{6,96}$/.test(supplied) ? supplied : `srv_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
  res.setHeader('X-MockMate-Request-Id', req.requestId)
  const started = Date.now()
  res.on('finish', () => console.log(JSON.stringify({ ts: new Date().toISOString(), component: 'http', event: 'request_completed', requestId: req.requestId, method: req.method, path: req.path, status: res.statusCode, durationMs: Date.now() - started, authenticated: !!req.userId })))
  next()
})

let ready = false
app.get('/health', (req, res) => res.status(ready ? 200 : 503).json({ ok: ready, service: 'mockmate-backend' }))
app.get('/ready', (req, res) => res.status(ready ? 200 : 503).json({ ok: ready, store: process.env.MONGO_URI ? 'mongo' : 'file', hosted: Boolean(hostedConfig?.hosted) }))
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

initStore()
  .then(async () => {
    if (process.env.MONGO_URI) {
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
    if (!process.env.MONGO_URI && HOST !== '127.0.0.1' && HOST !== 'localhost') {
      throw new Error(`Refusing to bind ${HOST} without MONGO_URI (usage caps would be disabled).`)
    }
    const server = app.listen(PORT, HOST, () => {
      ready = true
      console.log(`[backend] auth${process.env.MONGO_URI ? '+managed AI' : ''} API on http://${HOST}:${PORT} (store: ${process.env.MONGO_URI ? 'mongo' : 'file'})`)
      process.send?.({ type: 'ready', port: PORT })
    })
    server.on('error', e => {
      ready = false
      console.error('[backend] listen failed:', e.message)
      process.send?.({ type: 'server-error', code: e.code, message: e.message })
      process.exit(1)
    })
  })
  .catch(e => {
    ready = false
    console.error('[backend] startup failed:', e.message)
    process.send?.({ type: 'server-error', message: e.message })
    process.exit(1)
  })
