import { makeReport } from './_lib/core.js'

// Vercel serverless function — POST /api/report
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' })
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {})
    res.status(200).json({ report: await makeReport(body) })
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message })
  }
}
