/**
 * Explicit Jobs/Career → Solo/Live interview JD contract.
 *
 * Career analysis JD stays local and must NOT write profile.jobDescription.
 * Interview seeding only happens when the user clicks "Use for Solo/Live".
 */
import { jobAnalysisJd } from './jobsHandoff.js'

/**
 * Build an interview seed from a job listing (or Career analysis fields).
 * @returns {{ jobDescription: string, targetRole?: string, targetCompany?: string, limited: boolean, source: string }}
 */
export function buildInterviewJobSeed({ job, jd, role, company, source = 'jobs' } = {}) {
  if (job) {
    const { jd: text, limited } = jobAnalysisJd(job)
    return {
      jobDescription: text,
      targetRole: job.title || role || '',
      targetCompany: job.company || company || '',
      limited: !!limited,
      source: 'jobs',
    }
  }
  const text = String(jd || '').trim()
  return {
    jobDescription: text,
    targetRole: role || '',
    targetCompany: company || '',
    limited: text.length > 0 && text.length < 80,
    source: source || 'career',
  }
}

/**
 * Apply seed onto a profile object (pure). Does not touch localStorage.
 * Empty JD is rejected so we never wipe an existing interview JD by accident.
 */
export function applyInterviewJobSeed(profile = {}, seed) {
  if (!seed || !String(seed.jobDescription || '').trim()) {
    const e = new Error('Add a job description before using it for Solo/Live.')
    e.code = 'EMPTY_INTERVIEW_JD'
    throw e
  }
  const next = { ...profile }
  next.jobDescription = String(seed.jobDescription).trim()
  if (seed.targetRole) next.targetRole = String(seed.targetRole).trim()
  if (seed.targetCompany) next.targetCompany = String(seed.targetCompany).trim()
  return next
}

/** Confirm copy for the explicit handoff modal. */
export function interviewSeedConfirmMessage(seed, destination = 'interview') {
  const where = destination === 'solo' ? 'Solo Practice' : destination === 'live' ? 'Live Copilot' : 'Solo / Live'
  const role = seed?.targetRole ? ` (${seed.targetRole})` : ''
  const limited = seed?.limited ? '\n\nNote: this JD is limited — paste a fuller description in setup if you can.' : ''
  return `Use this job description for ${where}${role}? This updates the shared interview JD (not Resume Studio’s analysis-only field).${limited}`
}
