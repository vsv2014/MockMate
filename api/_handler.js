// Shared Vercel serverless POST handler — the api/*.js routes were 9× identical
// boilerplate (method check, body parse, call lib, shape JSON, error status).
// Leading underscore keeps Vercel from treating this as its own route.
export function postHandler(fn, key) {
  return async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' })
    try {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {})
      const out = await fn(body)
      res.status(200).json(key ? { [key]: out } : out)
    } catch (e) {
      res.status(e.status || 500).json({ error: e.message })
    }
  }
}
