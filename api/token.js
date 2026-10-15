import { publicProxyDisabled } from './_lib/publicProxyGuard.js'
import { mintToken } from './_lib/core.js'

// Vercel serverless function — POST /api/token.
// The shared managed backend is the authenticated production surface. A standalone
// Vercel provider proxy must be explicitly opted into because it has no user auth.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' })
  if (publicProxyDisabled(res)) return
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {})
    res.status(200).json(await mintToken(body))
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message })
  }
}
