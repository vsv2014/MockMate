// Local session history for Solo Practice — stored only on this machine (localStorage).
// Keeps the transcript + feedback report for each completed session so users can review
// past conversations, copy them, and see how they're trending. Pruned to ~3 months.

const KEY = 'mm-sessions'
const MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000   // ~3 months
const MAX_SESSIONS = 60                        // hard cap so localStorage never bloats

// Newest first, with anything older than the retention window dropped.
export function loadSessions() {
  try {
    const arr = JSON.parse(localStorage.getItem(KEY) || '[]')
    if (!Array.isArray(arr)) return []
    const cutoff = Date.now() - MAX_AGE_MS
    return arr.filter(s => s && s.ts && s.ts >= cutoff).sort((a, b) => b.ts - a.ts)
  } catch { return [] }
}

// Persist one completed session. Returns the stored entry (with id + ts) or null.
export function saveSession({ report, transcript = [], config = {}, profile = {} } = {}) {
  if (!report || report.error) return null   // nothing useful to store
  try {
    const ts = Date.now()
    const entry = {
      id: `s_${ts}`,
      ts,
      label: config.domainLabel || profile.targetRole || 'Interview',
      score: typeof report.overallScore === 'number' ? report.overallScore : null,
      verdict: report.verdict || null,
      report,
      transcript,
    }
    const next = [entry, ...loadSessions()].slice(0, MAX_SESSIONS)
    localStorage.setItem(KEY, JSON.stringify(next))
    return entry
  } catch { return null }   // quota exceeded etc. — non-fatal
}

export function deleteSession(id) {
  try { localStorage.setItem(KEY, JSON.stringify(loadSessions().filter(s => s.id !== id))) } catch {}
}


// Plain-text exports — used by the "Copy" buttons.
export function feedbackToText(report) {
  if (!report || report.error) return ''
  const L = []
  if (report.overallScore != null) L.push(`Overall: ${report.overallScore}/100${report.verdict ? `  —  ${report.verdict}` : ''}`)
  if (report.summary) L.push('', report.summary)
  if (report.dimensions?.length) {
    L.push('', 'Scorecard:')
    report.dimensions.forEach(d => L.push(`  • ${d.name}: ${d.score}/5 — ${d.comment || ''}`.trimEnd()))
  }
  if (report.strengths?.length) { L.push('', 'Strengths:'); report.strengths.forEach(s => L.push(`  • ${s}`)) }
  if (report.improvements?.length) { L.push('', 'Work on next:'); report.improvements.forEach(s => L.push(`  • ${s}`)) }
  if (report.delivery?.tip) L.push('', `Next time: ${report.delivery.tip}`)
  const d = report._delivery
  if (d) L.push('', `Delivery: ${d.words} words${d.wpm != null ? `, ${d.wpm} wpm` : ''}, ${d.fillers?.count ?? 0} fillers${d.jargon?.count ? `, ${d.jargon.count} buzzwords` : ''}${d.hedges?.count ? `, ${d.hedges.count} hedges` : ''}`)
  return L.join('\n')
}

export function transcriptToText(transcript = []) {
  return (transcript || [])
    .map(t => `${t.role === 'interviewer' ? 'INTERVIEWER' : 'YOU'}: ${t.text}`)
    .join('\n\n')
}
