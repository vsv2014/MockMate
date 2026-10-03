// Shared Vercel serverless POST handler — the api/*.js routes were 9× identical
// boilerplate (method check, body parse, call lib, shape JSON, error status).
// Leading underscore keeps Vercel from treating this as its own route.
//
// Security: unauthenticated Vercel deploys with real provider keys = public LLM proxy.
// Refuse by default on Vercel unless MOCKMATE_ALLOW_PUBLIC_API=1 (escape hatch only).
import { applyArchReasoningPolicy, isProviderFailureError } from './_lib/apiRoutes.js'
import { recordArchMetric } from '../backend/src/arch.js'

export function postHandler(fn, key) {
  return async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' })
    if (process.env.VERCEL && process.env.MOCKMATE_ALLOW_PUBLIC_API !== '1') {
      return res.status(403).json({
        error: 'Public API deploy disabled. Use the managed auth backend, or set MOCKMATE_ALLOW_PUBLIC_API=1 (not recommended).',
      })
    }
    const startedAt = Date.now()
    const routePath = String(req.url || '').split('?')[0] || '/api/default'
    try {
      const rawBody = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {})
      const body = applyArchReasoningPolicy(routePath, rawBody)
      const out = await fn(body)
      recordArchMetric('turn_latency_ms', Date.now() - startedAt)
      res.status(200).json(key ? { [key]: out } : out)
    } catch (e) {
      if (isProviderFailureError(e)) recordArchMetric('provider_failure_count', 1)
      res.status(e.status || 500).json({ error: e.message })
    }
  }
}
