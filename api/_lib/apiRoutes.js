// Shared /api/* route registration.
// Deployments:
//   - Local BYOK (server.js): no auth, loopback-only.
//   - Managed backend (backend/server.js): auth + metering/model policy.
import { makeReport, availableProviders, allProviders, listModels, deepgramConfigured, deepgramToken, searchConfigured, mintToken, embed, isLoopbackAddress } from './core.js'
import { interviewerTurn, evaluateSolo, generateHint, analyzeScreen, streamHint } from './interview.js'
import { findJobs } from './jobs.js'
import { atsScore, tailorResume, referralMessage, resumeLatex } from './career.js'
import { archRuntimeSummary, recordArchMetric, reasoningPolicy as defaultReasoningPolicy } from '../../backend/src/arch.js'
import { isQuotaExhausted, isRateLimit, isTransient } from '../../shared/llm-errors.js'

export function isProviderFailureError(e, { closed = false, signal = null } = {}) {
  if (closed || signal?.aborted || e?.name === 'AbortError' || e?.message === 'client_disconnected') return false
  if (e?.code === 'SCREEN_EMPTY' || e?.status === 400 || e?.statusCode === 400) return false
  const status = Number(e?.status ?? e?.statusCode ?? 0)
  if (status === 401 || status === 402 || status === 403 || status === 408 || status === 429 || status >= 500) return true
  return isQuotaExhausted(e) || isRateLimit(e) || isTransient(e)
}

export const API_ROUTE_CONTRACT = [
  { method: 'GET', path: '/api/providers' }, { method: 'GET', path: '/api/models' },
  { method: 'GET', path: '/api/arch' },
  { method: 'POST', path: '/api/deepgram-token' }, { method: 'POST', path: '/api/token' },
  { method: 'POST', path: '/api/embed' }, { method: 'POST', path: '/api/report' },
  { method: 'POST', path: '/api/interview' }, { method: 'POST', path: '/api/evaluate' },
  { method: 'POST', path: '/api/hint' }, { method: 'POST', path: '/api/analyze-screen' },
  { method: 'POST', path: '/api/jobs' }, { method: 'POST', path: '/api/ats-score' },
  { method: 'POST', path: '/api/tailor-resume' }, { method: 'POST', path: '/api/referral' },
  { method: 'POST', path: '/api/resume-latex' }, { method: 'POST', path: '/api/hint-stream' },
]

export const OPERATION_BY_PATH = {
  '/api/interview': 'interview',
  '/api/hint': 'hint',
  '/api/hint-stream': 'hint',
  '/api/evaluate': 'evaluate',
  '/api/report': 'evaluate',
  '/api/analyze-screen': 'screen',
  '/api/jobs': 'career',
  '/api/ats-score': 'career',
  '/api/tailor-resume': 'career',
  '/api/referral': 'career',
  '/api/resume-latex': 'career',
}
const STRATEGY_BY_LANE = { fast: 'fast', balanced: 'balanced', strong: 'quality', vision: 'quality' }

export function applyArchReasoningPolicy(path, raw = {}, resolveReasoningPolicy = defaultReasoningPolicy) {
  const body = { ...(raw || {}) }
  if (!resolveReasoningPolicy) return body
  const policy = resolveReasoningPolicy(OPERATION_BY_PATH[path] || 'default', { adaptive: true })
  if (!policy) return body
  body.archPolicy = {
    lane: policy.lane,
    noDoubleRetry: policy.noDoubleRetry === true,
    ...(policy.adaptivePromotion ? { adaptivePromotion: policy.adaptivePromotion } : {}),
  }
  const strategy = STRATEGY_BY_LANE[policy.lane]
  if (strategy && !body.profile?.modelStrategy) body.profile = { ...(body.profile || {}), modelStrategy: strategy }
  return body
}

export function registerApiRoutes(app, opts = {}) {
  const guard = opts.auth ? [].concat(opts.auth) : []
  const guardLight = opts.authLight ? [].concat(opts.authLight) : guard
  // STT quota enforcement is injected by the server (round-5/6 review): the Express
  // backend supplies a lease-reservation middleware (runs BEFORE this route mints
  // the grant) and a release callback used when minting fails; the public-disabled
  // Vercel handlers stay unaffected by default.
  const sttGuard = opts.sttGuard ? [].concat(opts.sttGuard) : []
  const issueManagedSttTicket = typeof opts.issueManagedSttTicket === 'function' ? opts.issueManagedSttTicket : null
  const onSttRelease = typeof opts.onSttRelease === 'function' ? opts.onSttRelease : null
  const report = typeof opts.report === 'function' ? opts.report : () => {}
  const onLlm = typeof opts.onLlm === 'function' ? opts.onLlm : null
  const onLlmFailure = typeof opts.onLlmFailure === 'function' ? opts.onLlmFailure : null
  const resolveReasoningPolicy = typeof opts.reasoningPolicy === 'function' ? opts.reasoningPolicy : defaultReasoningPolicy

  const bodyWithPolicy = (path, raw = {}) => applyArchReasoningPolicy(path, raw, resolveReasoningPolicy)

  app.get('/api/providers', ...guardLight, (req, res) => res.json({ providers: availableProviders(), allProviders: allProviders(), deepgram: deepgramConfigured(), search: searchConfigured() }))
  app.get('/api/models', ...guardLight, async (req, res) => {
    try { res.json({ models: await listModels() }) }
    catch (e) { console.error('[api] GET /api/models:', e.message); res.json({ models: [] }) }
  })
  app.get('/api/arch', ...guardLight, (req, res) => {
    try {
      const ip = req.ip || req.socket?.remoteAddress || ''
      const remoteHosted = ['1', 'true'].includes(String(process.env.MOCKMATE_HOSTED || '').toLowerCase())
        || (!isLoopbackAddress(ip) && Boolean(ip))
      res.json(archRuntimeSummary({ hosted: remoteHosted }))
    }
    catch (e) { res.status(500).json({ error: e.message }) }
  })

  app.post('/api/deepgram-token', ...guardLight, ...(issueManagedSttTicket ? [] : sttGuard), async (req, res) => {
    // Hosted mode must never return a direct-to-Deepgram credential: an STT
    // connection may remain open after the JWT expires, exceeding every fixed
    // grant reservation. The trusted gateway reserves/settles quota per socket.
    if (issueManagedSttTicket) {
      try { return res.json(issueManagedSttTicket(req)) }
      catch (error) { return res.status(error.status || 503).json({ error: error.message }) }
    }
    const remoteHosted = ['1', 'true'].includes(String(process.env.MOCKMATE_HOSTED || '').toLowerCase())
    if (remoteHosted) return res.status(503).json({
      error: 'Managed transcription gateway is not configured. Streaming access is disabled.',
      code: 'managed_stt_gateway_required',
    })
    try {
      const ip = req.ip || req.socket?.remoteAddress || ''
      const allowApiKeyFallback = isLoopbackAddress(ip) || !ip
      res.json(await deepgramToken({ allowApiKeyFallback }))
    } catch (e) {
      if (onSttRelease) { try { await onSttRelease(req) } catch {} }
      report(e); res.status(e.status || 500).json({ error: e.message })
    }
  })

  app.post('/api/token', ...guardLight, async (req, res) => {
    try { res.json(await mintToken({ ...(req.body || {}), requesterId: req.userId || null })) }
    catch (e) { report(e); res.status(e.status || 500).json({ error: e.message }) }
  })

  // Embeddings consume a provider request too. Managed deployments use the full guard so document
  // indexing/retrieval cannot become an unlimited paid-provider side channel.
  app.post('/api/embed', ...guard, async (req, res) => {
    try {
      const raw = (req.body || {}).input
      const input = (Array.isArray(raw) ? raw : [raw]).filter(Boolean)
      if (input.length > 64) return res.status(413).json({ error: 'Too many embedding inputs in one request.' })
      const vectors = await embed(input)
      if (onLlm) { try { await onLlm(req, '/api/embed') } catch {} }
      res.json({
        vectors,
        provider: vectors?.provider || null,
        model: vectors?.model || null,
        embeddingModel: vectors?.embeddingModel || null,
      })
    } catch (e) {
      if (onLlmFailure) { try { await onLlmFailure(req, '/api/embed') } catch {} }
      report(e); res.status(e.status || 500).json({ error: e.message })
    }
  })

  const post = (path, fn, key) => app.post(path, ...guard, async (req, res) => {
    const startedAt = Date.now()
    const ac = new AbortController()
    let closed = false
    res.on('close', () => { closed = true; try { ac.abort(new Error('client_disconnected')) } catch {} })
    try {
      const out = await fn({ ...bodyWithPolicy(path, req.body || {}), signal: ac.signal })
      // Operation-scoped latency: adaptive routing must see THIS operation's p95,
      // not a global bucket contaminated by unrelated slow operations.
      recordArchMetric(`turn_latency_ms:${OPERATION_BY_PATH[path] || 'default'}`, Date.now() - startedAt)
      if (onLlm) { try { await onLlm(req, path) } catch {} }
      if (!closed) res.json(key ? { [key]: out } : out)
    } catch (e) {
      if (onLlmFailure) { try { await onLlmFailure(req, path) } catch {} }
      if (closed || ac.signal.aborted || e?.name === 'AbortError') return
      if (isProviderFailureError(e, { closed, signal: ac.signal })) {
        recordArchMetric('provider_failure_count', 1)
      }
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
    const startedAt = Date.now()
    const ac = new AbortController()
    let closed = false
    res.on('close', () => { closed = true; try { ac.abort() } catch {} })
    try {
      const out = await analyzeScreen({ ...bodyWithPolicy('/api/analyze-screen', req.body || {}), signal: ac.signal })
      recordArchMetric('turn_latency_ms:screen', Date.now() - startedAt)
      if (onLlm) { try { await onLlm(req, '/api/analyze-screen') } catch {} }
      if (!ac.signal.aborted) res.json({ analysis: out })
    } catch (e) {
      if (onLlmFailure) { try { await onLlmFailure(req, '/api/analyze-screen') } catch {} }
      if (closed || ac.signal.aborted || e?.name === 'AbortError') return
      if (isProviderFailureError(e, { closed, signal: ac.signal })) {
        recordArchMetric('provider_failure_count', 1)
      }
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
    const startedAt = Date.now()
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
      const out = await streamHint(bodyWithPolicy('/api/hint-stream', req.body || {}), {
        onMeta: m => send('meta', m),
        onToken: t => {
          if (!emittedToken) recordArchMetric('llm_ttft_ms', Date.now() - startedAt)
          emittedToken = true
          send('token', t)
        },
        onUsage: u => send('usage', u),
        onProviderEvent: e => {
          providerStarted = true
          if (e?.event === 'fallback' || (e?.type === 'started' && Number(e?.attemptIndex) > 0)) {
            recordArchMetric('fallback_count', 1)
          }
          send('provider', e)
        },
        signal: ac.signal,
      })
      recordArchMetric('turn_latency_ms:hint', Date.now() - startedAt)
      if (out?.skipped) await releaseReservation()
      else await consumeReservation()
      send(out?.skipped ? 'skip' : 'done', {})
    } catch (e) {
      if (emittedToken || providerStarted) await consumeReservation()
      else await releaseReservation()
      if (!closed && !ac.signal.aborted && e?.name !== 'AbortError') {
        if (isProviderFailureError(e, { closed, signal: ac.signal })) {
          recordArchMetric('provider_failure_count', 1)
        }
        report(e)
        send('error', { error: e.message })
      }
    }
    if (!closed) res.end()
  })
}
