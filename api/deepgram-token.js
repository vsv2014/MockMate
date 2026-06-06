import { deepgramToken } from './_lib/core.js'

// POST /api/deepgram-token — short-lived token for browser-side Deepgram streaming
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' })
  const host = req.headers.host || ''
  const local = host.startsWith('localhost') || host.startsWith('127.')
  try {
    res.status(200).json(await deepgramToken({ allowRawKey: local }))
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message })
  }
}
