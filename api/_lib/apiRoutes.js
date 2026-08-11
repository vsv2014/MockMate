// Shared /api/* route registration.
// Deployments:
//   - Local BYOK (server.js): registerApiRoutes(app, { report }) — no auth, loopback-only.
//   - Managed backend (backend/server.js): registerApiRoutes(app, { auth, authLight, onLlm }).
// One engine, two deployments. Do not re-inline these routes in server.js.
//   opts.auth   — Express middleware (or array) run before the LLM routes (e.g. requireAuth +
//                 a plan-cap check). Omit for the local/BYOK server (no gate).
//   opts.onLlm  — async (req, path) hook fired AFTER a successful LLM call, for usage metering.
//                 Omit locally. Metering errors are swallowed so they never break a response.
//   opts.report — error reporter (e.g. Sentry.captureException). Optional.
// On the managed/hosted mount, metadata is auth-gated (reveals which platform keys exist).
// Local BYOK (:3002) leaves them open — loopback-only, intentional for setup UI.
import { makeReport, availableProviders, allProviders, listModels, deepgramConfigured, deepgramToken, searchConfigured, mintToken, embed, isLoopbackAddress } from './core.js'
import { interviewerTurn, evaluateSolo, generateHint, analyzeScreen, streamHint } from './interview.js'
import { findJobs } from './jobs.js'
import { atsScore, tailorResume, referralMessage, resumeLatex } from './career.js'

/** Contract surface shared by local BYOK and managed mounts. */
export const API_ROUTE_CONTRACT = [
  { method: 'GET', path: '/api/providers' },
  { method: 'GET', path: '/api/models' },
  { method: 'POST', path: '/api/deepgram-token' },
  { method: 'POST', path: '/api/token' },
  { method: 'POST', path: '/api/embed' },
  { method: 'POST', path: '/api/report' },
  { method: 'POST', path: '/api/interview' },
  { method: 'POST', path: '/api/evaluate' },
  { method: 'POST', path: '/api/hint' },
  { method: 'POST', path: '/api/analyze-screen' },
  { method: 'POST', path: '/api/jobs' },
  { method: 'POST', path: '/api/ats-score' },
  { method: 'POST', path: '/api/tailor-resume' },
  { method: 'POST', path: '/api/referral' },
  { method: 'POST', path: '/api/resume-latex' },
  { method: 'POST', path: '/api/hint-stream' },
]

export function registerApiRoutes(app, opts = {}) {
  const guard = opts.auth ? [].concat(opts.auth) : []
  // STT (deepgram-token) needs auth in managed mode but must NOT be blocked by the LLM-call cap:
  // transcription has to start — and re-mint tokens on every socket reconnect over a 60-90min
  // session — even for a user who's exhausted their monthly AI-RESPONSE limit (STT is a separate
  // meter). Callers that don't split the guards fall back to the full guard (no behavior change).
  const guardLight = opts.authLight ? [].concat(opts.authLight) : guard
  const report = typeof opts.report === 'function' ? opts.report : () => {}
  const onLlm = typeof opts.onLlm === 'function' ? opts.onLlm : null

  // ── Metadata — gated on managed proxy; open on local BYOK ──
  app.get('/api/providers', ...guardLight, (req, res) => res.json({ providers: availableProviders(), allProviders: allProviders(), deepgram: deepgramConfigured(), search: searchConfigured() }))
  app.get('/api/models', ...guardLight, async (req, res) => {
    try { res.json({ models: await listModels() }) }
    catch (e) { console.error('[api] GET /api/models:', e.message); res.json({ models: [] }) }
  })

  app.post('/api/deepgram-token', ...guardLight, async (req, res) => {
    try {
      // Local Electron (loopback): always allow Member-key → raw API key WS fallback.
      // Covers BYOK (:3002, no auth) AND local managed (:4000 with auth) — same laptop.
      // Remote hosted production sets MOCKMATE_HOSTED=1 and deepgramToken refuses the fallback.
      const ip = req.ip || req.socket?.remoteAddress || ''
      const remoteHosted = process.env.MOCKMATE_HOSTED === '1' || process.env.MOCKMATE_HOSTED === 'true'
      const allowApiKeyFallback = !remoteHosted && (isLoopbackAddress(ip) || !ip)
      res.json(await deepgramToken({ allowApiKeyFallback }))
    }
    catch (e) { report(e); res.status(e.status || 500).json({ error: e.message }) }
  })

  // Duo room token (LiveKit). Auth-gated (candidate must be signed in) but NOT cap-metered — it's
  // not an LLM call. 501 until LIVEKIT_* is configured. (Un-authed helper-join via invite is a
  // follow-up; today both participants sign in.)
  app.post('/api/token', ...guardLight, async (req, res) => {
    try { res.json(await mintToken(req.body || {})) }
    catch (e) { report(e); res.status(e.status || 500).json({ error: e.message }) }
  })

  // Document-RAG embeddings. Auth-gated, NOT cap-metered (embeddings are cheap and part of indexing,
  // not an AI "response"). Client chunks docs + retrieves top-K locally (shared/retrieval.js).
  app.post('/api/embed', ...guardLight, async (req, res) => {
    try { res.json({ vectors: await embed((req.body || {}).input || []) }) }
    catch (e) { report(e); res.status(e.status || 500).json({ error: e.message }) }
  })

  // Shared POST route: call the lib fn with the JSON body, meter on success, shape errors uniformly.
  const post = (path, fn, key) => app.post(path, ...guard, async (req, res) => {
    try {
      const out = await fn(req.body || {})
      if (onLlm) { try { await onLlm(req, path) } catch {} }   // metering must NEVER break the response
      res.json(key ? { [key]: out } : out)
    } catch (e) {
      report(e); console.error(`[api] POST ${path} → ${e.status || 500}: ${e.message}`)
      res.status(e.status || 500).json({ error: e.message })
    }
  })

  post('/api/report', makeReport, 'report')
  post('/api/interview', interviewerTurn, 'turn')
  post('/api/evaluate', evaluateSolo, 'report')
  post('/api/hint', generateHint, 'hint')
  app.post('/api/analyze-screen', ...guard, async (req, res) => {
    const ac = new AbortController()
    res.on('close', () => { try { ac.abort() } catch {} })
    try {
      const out = await analyzeScreen({ ...(req.body || {}), signal: ac.signal })
      if (onLlm) { try { await onLlm(req, '/api/analyze-screen') } catch {} }
      if (!ac.signal.aborted) res.json({ analysis: out })
    } catch (e) {
      if (ac.signal.aborted || e?.name === 'AbortError') return
      report(e)
      console.error(`[api] POST /api/analyze-screen → ${e.status || 500}: ${e.message}`)
      res.status(e.status || 500).json({ error: e.message, code: e.code || undefined })
    }
  })
  post('/api/jobs', findJobs)
  post('/api/ats-score', atsScore)
  post('/api/tailor-resume', tailorResume)
  post('/api/referral', referralMessage)
  post('/api/resume-latex', resumeLatex)

  // Server-Sent Events: stream the spoken answer token-by-token for <1s time-to-first-word.
  app.post('/api/hint-stream', ...guard, async (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache, no-transform')
    res.setHeader('Connection', 'keep-alive')
    res.flushHeaders?.()
    let closed = false
    const ac = new AbortController()
    res.on('close', () => { closed = true; ac.abort() })
    const send = (event, data) => { if (!closed) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`) }
    try {
      const out = await streamHint(req.body || {}, {
        onMeta: m => send('meta', m), onToken: t => send('token', t), onUsage: u => send('usage', u), signal: ac.signal
      })
      if (onLlm && !out?.skipped) { try { await onLlm(req, '/api/hint-stream') } catch {} }
      send(out?.skipped ? 'skip' : 'done', {})
    } catch (e) {
      if (!closed && !ac.signal.aborted && e?.name !== 'AbortError') { report(e); send('error', { error: e.message }) }
    }
    if (!closed) res.end()
  })
}
