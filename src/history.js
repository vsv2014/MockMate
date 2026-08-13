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
// Error reports are kept so a failed evaluate does not make the attempt vanish.
export function saveSession({ report, transcript = [], config = {}, profile = {}, note } = {}) {
  if (!report) return null
  try {
    const ts = Date.now()
    const isError = !!report.error
    const entry = {
      id: `s_${ts}`,
      ts,
      label: config.domainLabel || profile.targetRole || 'Interview',
      score: typeof report.overallScore === 'number' ? report.overallScore : null,
      verdict: report.verdict || (isError ? 'Evaluation failed' : null),
      report,
      transcript,
      note: note || (isError ? 'evaluate_error' : undefined),
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
  if (!report) return ''
  if (report.error) return `Evaluation failed: ${report.error}`
  const L = []
  if (report.overallScore != null) {
    const outOf10 = (Math.max(0, Math.min(100, report.overallScore)) / 10).toFixed(1)
    L.push(`Overall: ${outOf10}/10${report.verdict ? `  —  ${report.verdict}` : ''}`)
  }
  if (report.summary) L.push('', report.summary)
  if (report.dimensions?.length) {
    L.push('', 'Scorecard (each dimension /5):')
    report.dimensions.forEach(d => L.push(`  • ${d.name}: ${d.score}/5 — ${d.comment || ''}`.trimEnd()))
  }
  if (report.strengths?.length) { L.push('', 'Strengths:'); report.strengths.forEach(s => L.push(`  • ${s}`)) }
  if (report.improvements?.length) { L.push('', 'Work on next:'); report.improvements.forEach(s => L.push(`  • ${s}`)) }
  if (report.delivery?.tip) L.push('', `Next time: ${report.delivery.tip}`)
  const d = report._delivery
  if (d) L.push('', `Delivery: ${d.words} words${d.wpm != null ? `, ${d.wpm} wpm` : ''}, ${d.fillers?.count ?? 0} fillers${d.jargon?.count ? `, ${d.jargon.count} buzzwords` : ''}${d.hedges?.count ? `, ${d.hedges.count} hedges` : ''}`)
  return L.join('\n')
}

function roleLabel(t) {
  if (t?.source === 'screen_f7' && t?.role === 'hint') return 'SCREEN'
  if (t?.source === 'screen_f7') return 'SCREEN'
  if (t?.role === 'hint' || t?.role === 'screen_hint') return 'HINT'
  if (t?.role === 'interviewer') return 'INTERVIEWER'
  if (t?.role === 'candidate' || t?.role === 'you') return 'YOU'
  return 'YOU'
}

export function transcriptToText(transcript = []) {
  return (transcript || [])
    .map(t => `${roleLabel(t)}: ${t.text}`)
    .join('\n\n')
}
