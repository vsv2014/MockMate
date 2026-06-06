import { evaluateSolo } from './_lib/interview.js'

// POST /api/evaluate — end-of-session report for solo practice
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' })
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {})
    res.status(200).json({ report: await evaluateSolo(body) })
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message })
  }
}
