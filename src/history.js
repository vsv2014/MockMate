// Local session history for Solo/Live Practice — stored only on this machine per account.
import { activeAccountScope, getScopedItem, setScopedItem, removeScopedItem } from './lib/accountScope'
import { sqliteEnabled, sqliteRequest, ensureLegacyImport } from './lib/desktopSessionStore.js'
import { readScopedArrayWithRecovery } from './lib/storageRecovery'

const KEY = 'mm-sessions'
const CORRUPT_HISTORY_BACKUP_KEY = 'mm-sessions-corrupt-backup-v1'
const SOLO_DRAFT_KEY = 'mm-solo-draft'
const soloDraftStorageKey = scope => {
  const safe = String(scope || '').trim().replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120)
  return safe ? `${SOLO_DRAFT_KEY}::${safe}` : SOLO_DRAFT_KEY
}
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

export function saveSoloDraft(draft = {}, scope = '') {
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
    if (!setScopedItem(soloDraftStorageKey(scope), JSON.stringify(row))) return false
    return true
  } catch { return false }
}

export function loadSoloDraft(scope = '') {
  try {
    const key = soloDraftStorageKey(scope)
    const raw = getScopedItem(key, '')
    if (!raw) return null
    const row = JSON.parse(raw)
    if (!row || !row.savedAt || Date.now() - row.savedAt > DRAFT_MAX_AGE_MS || !Array.isArray(row.transcript)) {
      removeScopedItem(key)
      return null
    }
    return row
  } catch { return null }
}

export function clearSoloDraft(scope = '') { return removeScopedItem(soloDraftStorageKey(scope)) }

function newSessionId(ts) {
  try { if (globalThis.crypto?.randomUUID) return `s_${globalThis.crypto.randomUUID()}` } catch {}
  return `s_${ts}_${Math.random().toString(36).slice(2, 10)}`
}

export function saveSession({ report, transcript = [], config = {}, profile = {}, note, runId, captureStatus, evaluationStatus, sink, previousEntry } = {}) {
  if (!report) return null
  try {
    const previous = sink ? previousEntry : runId ? loadSessions().find(row => row.id === runId) : null
    const ts = previous?.ts || Date.now(); const isError = !!report.error; const setup = config.interviewSetup || config
    const company = setup.targetCompany || profile.targetCompany || ''
    const role = setup.targetRole || config.domainLabel || profile.targetRole || ''
    const kitId = setup.kitId || config.kitId || ''
    const kitName = setup.kitName || config.kitName || ''
    const kitSnapshot = kitId ? {
      id: String(kitId).slice(0, 180),
      name: String(kitName || [role, company].filter(Boolean).join(' at ') || 'Interview Kit').slice(0, 100),
      candidateName: String(setup.candidateName || profile.name || '').slice(0, 120),
      targetRole: String(setup.targetRole || role).slice(0, 120),
      targetCompany: String(setup.targetCompany || company).slice(0, 120),
      yearsExp: String(setup.yearsExp || profile.yearsExp || '').slice(0, 80),
      interviewType: String(setup.interviewType || profile.interviewType || 'Technical').slice(0, 40),
      language: String(setup.language || profile.language || 'English').slice(0, 40),
      voiceStyle: String(setup.voiceStyle || profile.voiceStyle || 'Professional').slice(0, 40),
      resumeText: String(setup.resumeText || profile.resume || '').slice(0, 40_000),
      jobDescriptionText: String(setup.jobDescriptionText || profile.jobDescription || '').slice(0, 40_000),
      customInstructions: String(setup.customInstructions || profile.customPrompt || '').slice(0, 3_000),
      selectedDocumentIds: Array.isArray(setup.selectedDocumentIds) ? [...setup.selectedDocumentIds] : [],
      createdAt: setup.createdAt || new Date(ts).toISOString(),
    } : null
    const entry = {
      id: runId || newSessionId(ts), ts,
      ...(runId ? { runId, captureStatus, evaluationStatus } : {}),
      label: [company, role].filter(Boolean).join(' · ') || 'Interview',
      mode: setup.source === 'live' ? 'live' : 'solo', company, role,
      setup: {
        ...(kitId ? { kitId, kitName } : {}),
        selectedDocumentIds: Array.isArray(setup.selectedDocumentIds) ? [...setup.selectedDocumentIds] : [],
        playbookActive: !!String(setup.customInstructions || profile.customPrompt || '').trim(),
        resumeIncluded: !!String(setup.resumeText || profile.resume || '').trim(),
        jobDescriptionIncluded: !!String(setup.jobDescriptionText || profile.jobDescription || '').trim(),
        language: setup.language || profile.language || 'English',
        responseStyle: setup.responseStyle || profile.responseStyle || profile.answerStyle || 'balanced',
        modelStrategy: setup.modelStrategy || profile.modelStrategy || null,
      },
      ...(kitSnapshot ? { kitSnapshot } : {}),
      score: typeof report.overallScore === 'number' ? report.overallScore : null,
      verdict: report.verdict || (isError ? 'Evaluation failed' : null), report, transcript,
      note: note || (isError ? 'evaluate_error' : undefined),
    }
    if (sink) return sink(entry)
    const next = [entry, ...loadSessions().filter(row => row.id !== entry.id)].slice(0, MAX_SESSIONS)
    for (let keep = next.length; keep >= 1; keep--) {
      try {
        writeSessions(next.slice(0, keep))
        // Verify the actual scoped bytes before the caller discards recovery data.
        const committed = JSON.parse(getScopedItem(KEY, '[]'))?.find(row => row.id === entry.id)
        if (JSON.stringify(committed) !== JSON.stringify(entry)) throw new Error('history verification failed')
        return keep < next.length ? { ...entry, storagePruned: next.length - keep } : entry }
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


// Async desktop adapter. A SQLite failure never silently switches the write back to localStorage.
export async function loadSessionsAsync(offset = 0) {
  if (!await sqliteEnabled()) return { sessions:loadSessions(),total:loadSessions().length }
  const scope = activeAccountScope()
  try { await ensureLegacyImport(scope) }
  catch {
    const saved = await sqliteRequest('list',{ offset },scope)
    if (saved.total) return { ...saved, warning:'Legacy import needs attention. SQLite history is readable; new writes remain blocked until import is resolved.' }
    let legacy
    try { legacy = JSON.parse(getScopedItem(KEY,'[]')) } catch { throw new Error('legacy_json_invalid') }
    if (!Array.isArray(legacy)) throw new Error('legacy_json_invalid')
    const rows = legacy.filter(row => row?.id && Number.isFinite(row.ts)).sort((a,b) => b.ts-a.ts)
    return { sessions:rows.slice(offset,offset+100).map(row => ({ ...row,legacyReadOnly:true })),total:rows.length,
      warning:'Legacy import failed. These original sessions are read-only; export or retry before starting a new session.' }
  }
  return sqliteRequest('list',{ offset },scope)
}
export async function getSessionAsync(id) {
  if (!await sqliteEnabled()) return loadSessions().find(row => row.id === id) || null
  const saved = await sqliteRequest('get',{ runId:id })
  if (saved) return saved
  try { return JSON.parse(getScopedItem(KEY,'[]')).find(row => row.id === id) || null } catch { return null }
}
export async function saveSessionAsync(args = {}) {
  const scope = activeAccountScope()
  const enabled = await sqliteEnabled()
  if (scope !== activeAccountScope()) return null
  if (!enabled) return saveSession(args)
  try {
    await ensureLegacyImport(scope)
    const previousEntry = args.runId ? await sqliteRequest('get',{ runId:args.runId },scope) : null
    return await saveSession({ ...args,previousEntry,sink:entry => sqliteRequest('save',{ entry },scope) })
  } catch { return null }
}
export async function deleteSessionAsync(id) {
  if (!await sqliteEnabled()) return deleteSession(id)
  await sqliteRequest('delete',{ runId:id })
}
