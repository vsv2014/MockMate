// Local session history for Solo/Live Practice — stored only on this machine (localStorage).
const KEY = 'mm-sessions'
const MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000
const MAX_SESSIONS = 60

function writeSessions(items) {
  localStorage.setItem(KEY, JSON.stringify(items.slice(0, MAX_SESSIONS)))
}

export function loadSessions() {
  try {
    const arr = JSON.parse(localStorage.getItem(KEY) || '[]')
    if (!Array.isArray(arr)) return []
    const cutoff = Date.now() - MAX_AGE_MS
    const kept = arr.filter(s => s && s.ts && s.ts >= cutoff).sort((a, b) => b.ts - a.ts).slice(0, MAX_SESSIONS)
    // Retention is deletion, not merely a view filter. Persist the compacted set so expired
    // transcripts do not remain on disk indefinitely.
    if (kept.length !== arr.length) {
      try { writeSessions(kept) } catch {}
    }
    return kept
  } catch { return [] }
}

function newSessionId(ts) {
  try { if (globalThis.crypto?.randomUUID) return `s_${globalThis.crypto.randomUUID()}` } catch {}
  return `s_${ts}_${Math.random().toString(36).slice(2, 10)}`
}

export function saveSession({ report, transcript = [], config = {}, profile = {}, note } = {}) {
  if (!report) return null
  try {
    const ts = Date.now(); const isError = !!report.error; const setup = config.interviewSetup || config
    const company = setup.targetCompany || profile.targetCompany || ''
    const role = setup.targetRole || config.domainLabel || profile.targetRole || ''
    const entry = {
      id: newSessionId(ts), ts,
      label: [company, role].filter(Boolean).join(' · ') || 'Interview',
      mode: setup.source === 'live' ? 'live' : 'solo', company, role,
      setup: {
        selectedDocumentIds: Array.isArray(setup.selectedDocumentIds) ? [...setup.selectedDocumentIds] : [],
        playbookActive: !!String(setup.customInstructions || profile.customPrompt || '').trim(),
        resumeIncluded: !!String(setup.resumeText || profile.resume || '').trim(),
        jobDescriptionIncluded: !!String(setup.jobDescriptionText || profile.jobDescription || '').trim(),
        language: setup.language || profile.language || 'English',
        responseStyle: setup.responseStyle || profile.responseStyle || profile.answerStyle || 'balanced',
        modelStrategy: setup.modelStrategy || profile.modelStrategy || null,
      },
      score: typeof report.overallScore === 'number' ? report.overallScore : null,
      verdict: report.verdict || (isError ? 'Evaluation failed' : null), report, transcript,
      note: note || (isError ? 'evaluate_error' : undefined),
    }
    const next = [entry, ...loadSessions()].slice(0, MAX_SESSIONS)
    for (let keep = next.length; keep >= 1; keep--) {
      try { writeSessions(next.slice(0, keep)); return keep < next.length ? { ...entry, storagePruned: next.length - keep } : entry }
      catch {}
    }
    return null
  } catch { return null }
}

export function deleteSession(id) {
  try { writeSessions(loadSessions().filter(s => s.id !== id)) } catch {}
}

export function feedbackToText(report) {
  if (!report) return ''
  if (report.error) return `Evaluation failed: ${report.error}`
  const L = []
  if (report.overallScore != null) {
    const outOf10 = (Math.max(0, Math.min(100, report.overallScore)) / 10).toFixed(1)
    L.push(`Overall: ${outOf10}/10${report.verdict ? `  —  ${report.verdict}` : ''}`)
  }
  if (report.summary) L.push('', report.summary)
  if (report.dimensions?.length) { L.push('', 'Scorecard (each dimension /5):'); report.dimensions.forEach(d => L.push(`  • ${d.name}: ${d.score}/5 — ${d.comment || ''}`.trimEnd())) }
  if (report.strengths?.length) { L.push('', 'Strengths:'); report.strengths.forEach(s => L.push(`  • ${s}`)) }
  if (report.improvements?.length) { L.push('', 'Work on next:'); report.improvements.forEach(s => L.push(`  • ${s}`)) }
  if (report.delivery?.tip) L.push('', `Next time: ${report.delivery.tip}`)
  const d = report._delivery
  if (d) L.push('', `Delivery: ${d.words} words${d.wpm != null ? `, ${d.wpm} wpm` : ''}, ${d.fillers?.count ?? 0} fillers${d.jargon?.count ? `, ${d.jargon.count} buzzwords` : ''}${d.hedges?.count ? `, ${d.hedges.count} hedges` : ''}`)
  return L.join('\n')
}

export function transcriptToText(transcript = []) {
  const labels = { interviewer: 'INTERVIEWER', candidate: 'YOU', assistant: 'MOCKMATE' }
  return (transcript || []).map(t => `${labels[t.role] || String(t.role || 'SPEAKER').toUpperCase()}: ${t.text}`).join('\n\n')
}
