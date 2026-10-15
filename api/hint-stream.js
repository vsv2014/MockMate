import { publicProxyDisabled } from './_lib/publicProxyGuard.js'
import { applyArchReasoningPolicy, streamHintOverSse } from './_lib/apiRoutes.js'

// Thin serverless wrapper: the SSE implementation lives in streamHintOverSse
// (api/_lib/apiRoutes.js) and is shared verbatim with the Express route, so the
// two deploy targets can no longer drift. No reservation hooks here — serverless
// deploys have no managed metering.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' })
  if (publicProxyDisabled(res)) return
  const rawBody = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {})
  await streamHintOverSse(req, res, applyArchReasoningPolicy('/api/hint-stream', rawBody))
}
