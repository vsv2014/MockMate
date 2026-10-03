export const SESSION_MODES = ['live', 'solo', 'mock', 'coding']
export const SESSION_SOURCES = ['desktop', 'mobile', 'web']
export const RESPONSE_STYLES = ['concise', 'balanced', 'detailed']

const clean = value => typeof value === 'string' ? value.trim() : ''

export function normalizeTranscript(input) {
  if (!Array.isArray(input)) return []
  return input.slice(0, 200).flatMap(turn => {
    if (!['interviewer', 'candidate', 'assistant'].includes(turn?.role)) return []
    const normalized = {
      role: turn.role,
      text: clean(turn?.text).slice(0, 8000),
      answer: clean(turn?.answer).slice(0, 12000) || undefined,
      isQuestion: typeof turn?.isQuestion === 'boolean' ? turn.isQuestion : undefined,
      kind: ['question', 'followup', 'answer'].includes(turn?.kind) ? turn.kind : undefined,
      ts: Number.isFinite(turn?.ts) ? turn.ts : undefined,
    }
    return normalized.text || normalized.answer ? [normalized] : []
  })
}

export function normalizeSessionPayload(input = {}) {
  const mode = SESSION_MODES.includes(input.mode) ? input.mode : ''
  const score = input.score && typeof input.score === 'object' && !Array.isArray(input.score) ? input.score : null
  return {
    mode,
    title: clean(input.title).slice(0, 160),
    company: clean(input.company).slice(0, 160),
    role: clean(input.role).slice(0, 160),
    objective: clean(input.objective).slice(0, 1000),
    customInstructions: clean(input.customInstructions).slice(0, 8000),
    responseStyle: RESPONSE_STYLES.includes(input.responseStyle) ? input.responseStyle : 'concise',
    selectedDocumentIds: [...new Set((Array.isArray(input.selectedDocumentIds) ? input.selectedDocumentIds : [])
      .map(clean).filter(Boolean).slice(0, 50))],
    source: SESSION_SOURCES.includes(input.source) ? input.source : 'desktop',
    transcript: normalizeTranscript(input.transcript),
    notes: clean(input.notes).slice(0, 8000),
    score,
  }
}

export function validateSessionPayload(input = {}) {
  const value = normalizeSessionPayload(input)
  if (!value.mode) return { value, error: 'Choose a supported session mode.' }
  // Validation is based on the product mode, never on the caller-controlled `source` field.
  if (['live', 'mock', 'coding'].includes(value.mode) && !value.role) {
    return { value, error: 'Add the role you are preparing for.' }
  }
  if (value.score && JSON.stringify(value.score).length > 32_000) {
    return { value, error: 'Session score data is too large.' }
  }
  return { value, error: '' }
}
