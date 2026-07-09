// Shared /api/* route registration — mounted by BOTH the local dev/prod server (server.js,
// UNAUTHED = BYOK/local, private) and the hosted managed proxy (backend, AUTHED + METERED).
// One engine, two deployments.
//   opts.auth   — Express middleware (or array) run before the LLM routes (e.g. requireAuth +
//                 a plan-cap check). Omit for the local/BYOK server (no gate).
//   opts.onLlm  — async (req, path) hook fired AFTER a successful LLM call, for usage metering.
//                 Omit locally. Metering errors are swallowed so they never break a response.
//   opts.report — error reporter (e.g. Sentry.captureException). Optional.
// Metadata routes (/providers, /models) are never gated — they expose no user data.
import { makeReport, availableProviders, allProviders, listModels, deepgramConfigured, deepgramToken, searchConfigured, mintToken, embed } from './core.js'
import { interviewerTurn, evaluateSolo, generateHint, analyzeScreen, streamHint } from './interview.js'
import { findJobs } from './jobs.js'
import { atsScore, tailorResume, referralMessage } from './career.js'

export function registerApiRoutes(app, opts = {}) {
  const guard = opts.auth ? [].concat(opts.auth) : []
  // STT (deepgram-token) needs auth in managed mode but must NOT be blocked by the LLM-call cap:
  // transcription has to start — and re-mint tokens on every socket reconnect over a 60-90min
  // session — even for a user who's exhausted their monthly AI-RESPONSE limit (STT is a separate
  // meter). Callers that don't split the guards fall back to the full guard (no behavior change).
  const guardLight = opts.authLight ? [].concat(opts.authLight) : guard
  const report = typeof opts.report === 'function' ? opts.report : () => {}
  const onLlm = typeof opts.onLlm === 'function' ? opts.onLlm : null

  // ── Metadata (never gated) ──
  app.get('/api/providers', (req, res) => res.json({ providers: availableProviders(), allProviders: allProviders(), deepgram: deepgramConfigured(), search: searchConfigured() }))
  app.get('/api/models', async (req, res) => {
    try { res.json({ models: await listModels() }) }
    catch (e) { console.error('[api] GET /api/models:', e.message); res.json({ models: [] }) }
  })

  app.post('/api/deepgram-token', ...guardLight, async (req, res) => {
    const host = req.headers.host || ''
    const local = host.startsWith('localhost') || host.startsWith('127.')
    try { res.json(await deepgramToken({ allowRawKey: local })) }
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
  post('/api/analyze-screen', analyzeScreen, 'analysis')
  post('/api/jobs', findJobs)
  post('/api/ats-score', atsScore)
  post('/api/tailor-resume', tailorResume)
  post('/api/referral', referralMessage)

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
