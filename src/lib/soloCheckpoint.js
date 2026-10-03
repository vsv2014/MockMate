const KEY = 'mm-solo-checkpoint-v1'
const MAX_AGE_MS = 12 * 60 * 60 * 1000

export function loadSoloCheckpoint() {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) || 'null')
    if (!value || typeof value !== 'object') return null
    if (!value.savedAt || Date.now() - value.savedAt > MAX_AGE_MS) {
      localStorage.removeItem(KEY)
      return null
    }
    if (!Array.isArray(value.transcript)) return null
    return value
  } catch { return null }
}

export function saveSoloCheckpoint({ sessionId, transcript = [], answer = '', config = null, interviewConfig = null, profile = null, startedAt = null } = {}) {
  try {
    localStorage.setItem(KEY, JSON.stringify({
      version: 1,
      savedAt: Date.now(),
      sessionId: sessionId || null,
      transcript: Array.isArray(transcript) ? transcript.slice(-300) : [],
      answer: String(answer || '').slice(0, 20000),
      config,
      interviewConfig,
      profile,
      startedAt: Number(startedAt) || Date.now(),
    }))
    return true
  } catch { return false }
}

export function clearSoloCheckpoint() {
  try { localStorage.removeItem(KEY); return true } catch { return false }
}
