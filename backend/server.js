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
import { checkCap, recordLlm } from './src/middleware/meter.js'
import { registerApiRoutes } from '../api/_lib/apiRoutes.js'
import billingRoutes, { stripeWebhook } from './src/routes/billing.js'

// Load the managed-AI provider keys the same way server.js does, so the hosted proxy can call
// LLMs. In production these are MockMate's OWN keys (host env); in dev they come from the userData
// .env (your keys act as stand-in "MockMate keys" for local testing).
const MM_DATA_DIR = process.env.MOCKMATE_DATA_DIR
  || (process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Application Support', 'mockmate')
    : process.platform === 'win32' ? path.join(process.env.APPDATA || os.homedir(), 'mockmate')
    : path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'mockmate'))
try { dotenv.config({ path: path.join(MM_DATA_DIR, '.env') }) } catch {}

// JWT secret must exist before any route signs/verifies. When forked by the
// desktop app, Electron passes a persistent per-install secret (see main.cjs).
// Standalone dev without one set is allowed but logs a loud warning.
// A public bind (hosting sets HOST=0.0.0.0) with no real secret would sign/verify JWTs with a
// well-known literal → anyone could forge a token for any account. Refuse to boot in that case.
// Loopback-only dev (no HOST / 127.0.0.1) keeps the convenience default.
const PUBLIC_BIND = process.env.HOST && !['127.0.0.1', 'localhost', '::1'].includes(process.env.HOST)
if (!process.env.JWT_SECRET) {
  if (PUBLIC_BIND) {
    console.error(`[backend] FATAL: JWT_SECRET is required when binding a public interface (HOST=${process.env.HOST}). Refusing to start with an insecure default.`)
    process.exit(1)
  }
  process.env.JWT_SECRET = 'mockmate-dev-insecure-secret-change-me'
  console.warn('[backend] JWT_SECRET not set — using an insecure dev default (loopback only). Do NOT ship like this.')
}

// Billing needs BOTH keys: the secret key lets users pay, but without the webhook secret every
// event fails signature verification and plans never flip → charged-but-not-upgraded. Fail loud.
if (process.env.STRIPE_SECRET_KEY && !process.env.STRIPE_WEBHOOK_SECRET) {
  console.warn('[backend] STRIPE_SECRET_KEY is set but STRIPE_WEBHOOK_SECRET is missing — webhooks will 400 and plans will NOT upgrade. Set STRIPE_WEBHOOK_SECRET.')
}

// This process IS the managed-AI proxy (authed + metered, MockMate's own keys). Flag it so the
// shared engine (api/_lib/core.js) shows managed-appropriate error wording — a user here owns no
// key, so "check your API key in Settings" would be wrong. The local BYOK server never sets this.
process.env.MOCKMATE_MANAGED = '1'

const app = express()
app.use(cors())                       // desktop renderer is a different origin (localhost:5174 / :3002 / file://)

// Stripe webhook MUST see the raw body to verify the signature — mount it BEFORE express.json.
app.post('/billing/webhook', express.raw({ type: 'application/json' }), stripeWebhook)

app.use(express.json({ limit: '2mb' }))

app.get('/health', (req, res) => res.json({ ok: true }))
app.use('/auth', authRoutes)
app.use('/me', meRoutes)
app.use('/billing', billingRoutes)    // /billing/checkout + /billing/portal (authed); 501 until STRIPE_SECRET_KEY is set

// Managed-AI proxy (Phase 2b): the SAME /api/* engine as the local server, but AUTHED (JWT)
// and METERED (monthly cap → 402 "Upgrade or use your own key"). This is what makes managed AI
// real for keyless users — the desktop points here in managed mode.
// auth      = requireAuth + LLM-response cap (gates the LLM routes).
// authLight = requireAuth only — for /api/deepgram-token, so transcription can start/reconnect
//             even when the user has hit their monthly AI-response cap (STT is metered separately).
registerApiRoutes(app, { auth: [requireAuth, checkCap], authLight: [requireAuth], onLlm: recordLlm })

const PORT = Number(process.env.PORT) || 4000

initStore()
  .then(async () => {
    // Session sync (Phase 4) is Mongo-only — mounting it in file mode would pull in
    // mongoose at import time. Only wire it when a real DB is configured.
    if (process.env.MONGO_URI) {
      const { default: sessionRoutes } = await import('./src/routes/sessions.js')
      app.use('/sessions', sessionRoutes)
    }
    // Default to loopback (safe for the desktop-forked backend); hosting sets HOST=0.0.0.0 so
    // Render/Fly can route to it. Local Electron fork never sets HOST → stays 127.0.0.1.
    const HOST = process.env.HOST || '127.0.0.1'
    const server = app.listen(PORT, HOST, () => {
      console.log(`[backend] auth${process.env.MONGO_URI ? '+managed AI' : ''} API on http://${HOST}:${PORT} (store: ${process.env.MONGO_URI ? 'mongo' : 'file'})`)
      // Fail-open guard: without MONGO_URI, checkCap short-circuits (no usage caps) — safe for the
      // loopback desktop fork, DANGEROUS on a public bind where it means uncapped managed AI billed
      // to our keys with no upgrade wall. Shout loudly so a misconfigured deploy can't slip through.
      if (!process.env.MONGO_URI && HOST !== '127.0.0.1' && HOST !== 'localhost') {
        console.warn(`[backend] ⚠️  PUBLIC bind on ${HOST} with NO MONGO_URI — usage caps are DISABLED. Set MONGO_URI for the hosted backend, or bind to 127.0.0.1 for local use.`)
      }
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
