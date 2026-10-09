// Account-scoped, bounded recovery of the *visible Live feed* after an
// unexpected renderer crash. This does not resume microphone capture, an
// in-flight provider request, or billing; recovery is a read-only notes view.
//
// Deliberately whitelist fields: never persist profile, resume, document text,
// provider credentials, raw audio, or arbitrary nested provider response data.
import { getScopedItem, setScopedItem, removeScopedItem } from './accountScope.js'

export const LIVE_CHECKPOINT_KEY = 'mm-live-checkpoint-v1'
export const LIVE_CHECKPOINT_TTL_MS = 12 * 60 * 60 * 1000
const MAX_ROWS = 60
const MAX_QUESTION_CHARS = 3000
const MAX_ANSWER_CHARS = 12000

const clip = (v, max) => typeof v === 'string' ? v.slice(0, max) : ''
const cleanPoints = v => Array.isArray(v)
  ? v.filter(x => typeof x === 'string').slice(0, 6).map(x => x.slice(0, 650))
  : []

export function normalizeLiveCheckpointRows(rows) {
  if (!Array.isArray(rows)) return []
  return rows.slice(-MAX_ROWS).flatMap(row => {
    if (!row || row.isQuestion !== true) return []
    const text = clip(row.text, MAX_QUESTION_CHARS).trim()
    if (!text) return []
    const originalHint = row.hint && typeof row.hint === 'object' && !Array.isArray(row.hint)
      ? row.hint : null
    const hint = originalHint ? {
      opener: clip(originalHint.opener, 1200),
      keyPoints: cleanPoints(originalHint.keyPoints),
      fullAnswer: clip(originalHint.fullAnswer, MAX_ANSWER_CHARS),
      incomplete: Boolean(originalHint.incomplete),
      failed: Boolean(originalHint.failed),
    } : null
    return [{
      questionId: clip(row.questionId, 120),
      text,
      ts: Number.isFinite(row.ts) ? row.ts : 0,
      isQuestion: true,
      status: ['committed', 'superseded'].includes(row.status) ? row.status : 'committed',
      answer: clip(row.answer, MAX_ANSWER_CHARS),
      ...(hint ? { hint } : {}),
    }]
  })
}

export function saveLiveCheckpoint({ sessionId, transcript } = {}, now = Date.now()) {
  const rows = normalizeLiveCheckpointRows(transcript)
  if (!rows.length || !sessionId || !Number.isFinite(now)) return false
  // localStorage may be near quota; preserve the most recent conversations
  // instead of silently dropping the whole checkpoint.
  for (const n of [60, 30, 15, 5, 1]) {
    const limited = rows.slice(-n)
    const record = {
      version: 1, sessionId: clip(sessionId, 120), savedAt: now,
      transcript: limited,
    }
    if (setScopedItem(LIVE_CHECKPOINT_KEY, JSON.stringify(record))) return true
  }
  return false
}

export function clearLiveCheckpoint() {
  return removeScopedItem(LIVE_CHECKPOINT_KEY)
}

export function loadLiveCheckpoint(now = Date.now()) {
  const raw = getScopedItem(LIVE_CHECKPOINT_KEY, null)
  if (!raw) return null
  try {
    const record = JSON.parse(raw)
    const validTime = Number.isFinite(record?.savedAt)
      && record.savedAt <= now + 5 * 60_000
      && now - record.savedAt <= LIVE_CHECKPOINT_TTL_MS
    if (record?.version !== 1 || !record.sessionId || !validTime
      || !Array.isArray(record.transcript)) {
      clearLiveCheckpoint()
      return null
    }
    const transcript = normalizeLiveCheckpointRows(record.transcript)
    if (!transcript.length) {
      clearLiveCheckpoint()
      return null
    }
    return {
      version: 1, sessionId: clip(record.sessionId, 120),
      savedAt: record.savedAt, transcript,
    }
  } catch {
    clearLiveCheckpoint()
    return null
  }
}

export function checkpointToConversation(checkpoint) {
  const transcript = normalizeLiveCheckpointRows(checkpoint?.transcript)
  return transcript.flatMap(item => {
    const rows = [{ role: 'interviewer', text: item.text, ts: item.ts }]
    const answer = (item.answer || item.hint?.fullAnswer || '').trim()
    if (answer) rows.push({ role: 'hint', text: answer, ts: item.ts })
    return rows
  })
}
