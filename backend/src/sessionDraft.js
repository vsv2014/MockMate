export const SESSION_MODES = ['live', 'solo', 'mock', 'coding']
export const SESSION_SOURCES = ['desktop', 'mobile', 'web']

const clean = value => typeof value === 'string' ? value.trim() : ''

export function normalizeSessionPayload(input = {}) {
  const mode = SESSION_MODES.includes(input.mode) ? input.mode : ''
  return {
    mode,
    title: clean(input.title).slice(0, 160),
    company: clean(input.company).slice(0, 160),
    role: clean(input.role).slice(0, 160),
    objective: clean(input.objective).slice(0, 1000),
    source: SESSION_SOURCES.includes(input.source) ? input.source : 'desktop',
    transcript: Array.isArray(input.transcript) ? input.transcript : [],
    notes: clean(input.notes),
    score: input.score && typeof input.score === 'object' ? input.score : null,
  }
}

export function validateSessionPayload(input = {}) {
  const value = normalizeSessionPayload(input)
  if (!value.mode) return { value, error: 'Choose a supported session mode.' }
  // Keep the pre-mobile desktop sync contract backward compatible: older desktop Live/Solo
  // sessions may not include job-goal metadata. New mobile and Code/Mock goals require it.
  if ((value.source === 'mobile' || ['mock', 'coding'].includes(value.mode)) && !value.role) {
    return { value, error: 'Add the role you are preparing for.' }
  }
  if (value.source === 'mobile' && value.mode === 'live' && !value.company) {
    return { value, error: 'Add a company for a live session.' }
  }
  return { value, error: '' }
}
