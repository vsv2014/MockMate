import { publicProxyDisabled } from './_lib/publicProxyGuard.js'
import { deepgramToken } from './_lib/core.js'

// POST /api/deepgram-token — short-lived grant only (never the raw Deepgram key).
// Public Vercel deploys are disabled unless MOCKMATE_ALLOW_PUBLIC_API=1 (not recommended).
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' })
  if (publicProxyDisabled(res)) return
  try {
    res.status(200).json(await deepgramToken())
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message })
  }
}
