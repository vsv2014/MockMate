import { applyArchReasoningPolicy, streamHintOverSse } from './_lib/apiRoutes.js'

// Thin serverless wrapper: the SSE implementation lives in streamHintOverSse
// (api/_lib/apiRoutes.js) and is shared verbatim with the Express route, so the
// two deploy targets can no longer drift. No reservation hooks here — serverless
// deploys have no managed metering.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' })
  if (process.env.VERCEL && process.env.MOCKMATE_ALLOW_PUBLIC_API !== '1') {
    return res.status(403).json({ error: 'Public API deploy disabled. Use the managed auth backend.' })
  }
  const rawBody = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {})
  await streamHintOverSse(req, res, applyArchReasoningPolicy('/api/hint-stream', rawBody))
}
