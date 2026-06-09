import { findJobs } from './_lib/jobs.js'

// POST /api/jobs — rank live job postings against the candidate's resume.
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' })
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {})
    res.status(200).json(await findJobs(body))
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message })
  }
}
