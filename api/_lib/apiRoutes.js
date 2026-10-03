// Shared /api/* route registration.
// Deployments:
//   - Local BYOK (server.js): no auth, loopback-only.
//   - Managed backend (backend/server.js): auth + metering/model policy.
import { makeReport, availableProviders, allProviders, listModels, deepgramConfigured, deepgramToken, searchConfigured, mintToken, embed, isLoopbackAddress } from './core.js'
import { interviewerTurn, evaluateSolo, generateHint, analyzeScreen, streamHint } from './interview.js'
import { findJobs } from './jobs.js'
import { atsScore, tailorResume, referralMessage, resumeLatex } from './career.js'

export const API_ROUTE_CONTRACT = [
  { method: 'GET', path: '/api/providers' }, { method: 'GET', path: '/api/models' },
  { method: 'POST', path: '/api/deepgram-token' }, { method: 'POST', path: '/api/token' },
  { method: 'POST', path: '/api/embed' }, { method: 'POST', path: '/api/report' },
  { method: 'POST', path: '/api/interview' }, { method: 'POST', path: '/api/evaluate' },
  { method: 'POST', path: '/api/hint' }, { method: 'POST', path: '/api/analyze-screen' },
  { method: 'POST', path: '/api/jobs' }, { method: 'POST', path: '/api/ats-score' },
  { method: 'POST', path: '/api/tailor-resume' }, { method: 'POST', path: '/api/referral' },
  { method: 'POST', path: '/api/resume-latex' }, { method: 'POST', path: '/api/hint-stream' },
]

export function registerApiRoutes(app, opts = {}) {
  const guard = opts.auth ? [].concat(opts.auth) : []
  const guardLight = opts.authLight ? [].concat(opts.authLight) : guard
  const report = typeof opts.report === 'function' ? opts.report : () => {}
  const onLlm = typeof opts.onLlm === 'function' ? opts.onLlm : null
  const onLlmFailure = typeof opts.onLlmFailure === 'function' ? opts.onLlmFailure : null

  app.get('/api/providers', ...guardLight, (req, res) => res.json({ providers: availableProviders(), allProviders: allProviders(), deepgram: deepgramConfigured(), search: searchConfigured() }))
  app.get('/api/models', ...guardLight, async (req, res) => {
    try { res.json({ models: await listModels() }) }
    catch (e) { console.error('[api] GET /api/models:', e.message); res.json({ models: [] }) }
  })

  app.post('/api/deepgram-token', ...guardLight, async (req, res) => {
    try {
      const ip = req.ip || req.socket?.remoteAddress || ''
      const remoteHosted = ['1', 'true'].includes(String(process.env.MOCKMATE_HOSTED || '').toLowerCase())
      const allowApiKeyFallback = !remoteHosted && (isLoopbackAddress(ip) || !ip)
      res.json(await deepgramToken({ allowApiKeyFallback }))
    } catch (e) { report(e); res.status(e.status || 500).json({ error: e.message }) }
  })

  app.post('/api/token', ...guardLight, async (req, res) => {
    try { res.json(await mintToken(req.body || {})) }
    catch (e) { report(e); res.status(e.status || 500).json({ error: e.message }) }
  })

  app.post('/api/embed', ...guardLight, async (req, res) => {
    try {
      const raw = (req.body || {}).input
      const input = (Array.isArray(raw) ? raw : [raw]).filter(Boolean)
      if (input.length > 64) return res.status(413).json({ error: 'Too many embedding inputs in one request.' })
      res.json({ vectors: await embed(input) })
    } catch (e) { report(e); res.status(e.status || 500).json({ error: e.message }) }
  })

  const post = (path, fn, key) => app.post(path, ...guard, async (req, res) => {
    try {
      const out = await fn(req.body || {})
      if (onLlm) { try { await onLlm(req, path) } catch {} }
      res.json(key ? { [key]: out } : out)
    } catch (e) {
      if (onLlmFailure) { try { await onLlmFailure(req, path) } catch {} }
      report(e)
      console.error(`[api] POST ${path} → ${e.status || 500}: ${e.message}`)
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
      if (onLlmFailure) { try { await onLlmFailure(req, '/api/analyze-screen') } catch {} }
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

  app.post('/api/hint-stream', ...guard, async (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache, no-transform')
    res.setHeader('Connection', 'keep-alive')
    res.flushHeaders?.()
    let closed = false
    let providerStarted = false
    let emittedToken = false
    let reservationSettled = false
    const ac = new AbortController()
    res.on('close', () => { closed = true; ac.abort() })
    const send = (event, data) => { if (!closed) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`) }
    const consumeReservation = async () => {
      if (reservationSettled) return
      reservationSettled = true
      if (onLlm) { try { await onLlm(req, '/api/hint-stream') } catch {} }
    }
    const releaseReservation = async () => {
      if (reservationSettled) return
      reservationSettled = true
      if (onLlmFailure) { try { await onLlmFailure(req, '/api/hint-stream') } catch {} }
    }

    try {
      const out = await streamHint(req.body || {}, {
        onMeta: m => send('meta', m),
        onToken: t => { emittedToken = true; send('token', t) },
        onUsage: u => send('usage', u),
        onProviderEvent: e => { providerStarted = true; send('provider', e) },
        signal: ac.signal,
      })
      if (out?.skipped) await releaseReservation()
      else await consumeReservation()
      send(out?.skipped ? 'skip' : 'done', {})
    } catch (e) {
      // Once upstream inference has started (especially after a token reached the user),
      // a client disconnect must not refund the quota reservation while provider cost was spent.
      if (emittedToken || providerStarted) await consumeReservation()
      else await releaseReservation()
      if (!closed && !ac.signal.aborted && e?.name !== 'AbortError') {
        report(e)
        send('error', { error: e.message })
      }
    }
    if (!closed) res.end()
  })
}
