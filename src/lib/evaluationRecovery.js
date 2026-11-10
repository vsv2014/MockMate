// Explicitly re-evaluate a preserved Live transcript. This is never a
// background job: the user controls the provider call and its potential cost.
import { apiFetch } from './apiClient.js'
import { activeAccountScope } from './accountScope.js'
import { getSessionAsync, replaceSavedEvaluationAsync } from '../history.js'

export function canRetrySavedEvaluation(row) {
  return row?.mode === 'live' && row.score == null &&
    ['pending', 'failed', 'cancelled'].includes(row.evaluationStatus) &&
    row.captureStatus === 'captured' && row.legacyReadOnly !== true
}

export async function retrySavedEvaluation(sessionId, { signal, fetchSession = getSessionAsync,
  save = replaceSavedEvaluationAsync, request = apiFetch } = {}) {
  const scope = activeAccountScope()
  const session = await fetchSession(sessionId)
  if (scope !== activeAccountScope() || !canRetrySavedEvaluation(session))
    throw new Error('Saved session is not eligible for re-evaluation')
  const transcript = Array.isArray(session.transcript) ? session.transcript : []
  const hasCandidate = transcript.some(t => t?.role === 'candidate' && String(t.text || '').trim())
  if (!hasCandidate) throw new Error('Candidate speech is missing. Interviewer audio alone cannot be scored.')
  const sourceTranscript = transcript.filter(t => ['candidate', 'interviewer'].includes(t?.role) && String(t?.text || '').trim())
  const config = { runId: session.id, domainLabel: session.role || 'Live interview',
    roundLabel: 'Live interview' }
  const snapshot = session.kitSnapshot || {}
  const profile = { name: snapshot.candidateName || '', targetRole: session.role || snapshot.targetRole || '',
    targetCompany: session.company || snapshot.targetCompany || '', yearsExp: snapshot.yearsExp || '',
    resume: snapshot.resumeText || '', jobDescription: snapshot.jobDescriptionText || '' }
  const response = await request('/api/evaluate', {
    method: 'POST', timeoutMs: 45_000, signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ config, transcript: sourceTranscript, profile }),
  })
  if (!response.ok) throw new Error('Evaluation could not complete (HTTP ' + response.status + '). The transcript remains saved.')
  const result = await response.json()
  const report = result?.report
  if (!report || !Number.isFinite(report.overallScore) ||
      report.overallScore < 0 || report.overallScore > 100)
    throw new Error('Evaluation returned no valid score. Your transcript was not modified.')
  if (scope !== activeAccountScope() || signal?.aborted)
    throw new Error('Evaluation stopped after the account or request changed')
  return save(sessionId, report, { expectedTranscript: transcript })
}
