import { atsScore, referralMessage, resumeLatex, tailorResume } from './_lib/career.js'
import { postHandler } from './_handler.js'

const HANDLERS = {
  'ats-score': postHandler(atsScore),
  referral: postHandler(referralMessage),
  'resume-latex': postHandler(resumeLatex),
  'tailor-resume': postHandler(tailorResume),
}

// Hobby-plan function consolidation: four tiny career/resume endpoints share this
// one Serverless Function. vercel.json rewrites preserve the public URLs. Before
// delegating, restore the original logical API path so ARCH reasoning policy and
// operation-scoped metrics continue to see /api/ats-score, /api/referral, etc.
export default async function handler(req, res) {
  const raw = Array.isArray(req.query?.route) ? req.query.route[0] : req.query?.route
  const route = String(raw || '').trim()
  const delegate = HANDLERS[route]
  if (!delegate) return res.status(404).json({ error: 'Unknown career API route' })

  const originalUrl = req.url
  try {
    const incoming = new URL(req.url || '/', 'http://localhost')
    incoming.pathname = `/api/${route}`
    incoming.searchParams.delete('route')
    req.url = `${incoming.pathname}${incoming.search}`
    return await delegate(req, res)
  } finally {
    req.url = originalUrl
  }
}
