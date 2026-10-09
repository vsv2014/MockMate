// Local session history for Solo/Live Practice — stored only on this machine per account.
import { getScopedItem, setScopedItem, removeScopedItem } from './lib/accountScope'
import { readScopedArrayWithRecovery } from './lib/storageRecovery'

const KEY = 'mm-sessions'
const CORRUPT_HISTORY_BACKUP_KEY = 'mm-sessions-corrupt-backup-v1'
const SOLO_DRAFT_KEY = 'mm-solo-draft'
const MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000
const DRAFT_MAX_AGE_MS = 24 * 60 * 60 * 1000
const MAX_SESSIONS = 60

function writeSessions(items) {
  // Refuse to destroy unreadable history unless its original bytes have
  // already been preserved under this same account's recovery key.
  if (!readScopedArrayWithRecovery(KEY, CORRUPT_HISTORY_BACKUP_KEY).writable) {
    throw new Error('Existing interview history could not be backed up')
  }
  if (!setScopedItem(KEY, JSON.stringify(items.slice(0, MAX_SESSIONS)))) throw new Error('local storage write failed')
}

export function loadSessions() {
  try {
    const { items: arr } = readScopedArrayWithRecovery(KEY, CORRUPT_HISTORY_BACKUP_KEY)
    const cutoff = Date.now() - MAX_AGE_MS
    const kept = arr.filter(s => s && s.ts && s.ts >= cutoff).sort((a, b) => b.ts - a.ts).slice(0, MAX_SESSIONS)
    if (kept.length !== arr.length) { try { writeSessions(kept) } catch {} }
    return kept
  } catch { return [] }
}

export function saveSoloDraft(draft = {}) {
  try {
    const row = {
      version: 1,
      savedAt: Date.now(),
      sessionId: String(draft.sessionId || ''),
      transcript: Array.isArray(draft.transcript) ? draft.transcript.slice(-300) : [],
      answer: String(draft.answer || '').slice(0, 12000),
      practiceQ: String(draft.practiceQ || '').slice(0, 8000),
      currentQuestion: Math.max(0, Number(draft.currentQuestion) || 0),
      elapsedMs: Math.max(0, Number(draft.elapsedMs) || 0),
      profile: draft.profile && typeof draft.profile === 'object' ? {
        name: draft.profile.name || '', targetRole: draft.profile.targetRole || '', targetCompany: draft.profile.targetCompany || '',
        yearsExp: draft.profile.yearsExp || '', language: draft.profile.language || 'English', resume: draft.profile.resume || '',
        jobDescription: draft.profile.jobDescription || '', customPrompt: draft.profile.customPrompt || '', interviewType: draft.profile.interviewType || '',
        voiceStyle: draft.profile.voiceStyle || '',
      } : {},
      interviewConfig: draft.interviewConfig && typeof draft.interviewConfig === 'object' ? draft.interviewConfig : null,
      interviewType: draft.interviewType || 'Technical', voiceStyle: draft.voiceStyle || 'Professional',
      followupDepth: draft.followupDepth || 'normal', relentless: !!draft.relentless, tts: draft.tts !== false,
    }
    if (!setScopedItem(SOLO_DRAFT_KEY, JSON.stringify(row))) return false
    return true
  } catch { return false }
}

export function loadSoloDraft() {
  try {
    const raw = getScopedItem(SOLO_DRAFT_KEY, '')
    if (!raw) return null
    const row = JSON.parse(raw)
    if (!row || !row.savedAt || Date.now() - row.savedAt > DRAFT_MAX_AGE_MS || !Array.isArray(row.transcript)) {
      removeScopedItem(SOLO_DRAFT_KEY)
      return null
    }
    return row
  } catch { return null }
}

export function clearSoloDraft() { return removeScopedItem(SOLO_DRAFT_KEY) }

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
