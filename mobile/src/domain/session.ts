export const SESSION_MODES = ['live', 'mock', 'coding'] as const
export type SessionMode = typeof SESSION_MODES[number]

export type SessionDraft = {
  mode: SessionMode
  company: string
  role: string
  objective: string
}

export function normalizeSessionDraft(input: Partial<SessionDraft> = {}): SessionDraft {
  const mode = SESSION_MODES.includes(input.mode as SessionMode) ? input.mode as SessionMode : 'mock'
  return {
    mode,
    company: String(input.company || '').trim(),
    role: String(input.role || '').trim(),
    objective: String(input.objective || '').trim(),
  }
}

export function validateSessionDraft(input: Partial<SessionDraft> = {}) {
  const draft = normalizeSessionDraft(input)
  const errors: Partial<Record<'role' | 'company', string>> = {}
  if (!draft.role) errors.role = 'Add the role you are preparing for.'
  if (draft.mode === 'live' && !draft.company) errors.company = 'Add a company for a live session.'
  return { draft, errors, valid: Object.keys(errors).length === 0 }
}

export function sessionTitle(input: { mode?: string; company?: string; role?: string } = {}) {
  const company = String(input.company || '').trim()
  const role = String(input.role || '').trim()
  const rawMode = String(input.mode || 'mock')
  if (company && role) return `${company} · ${role}`
  if (role || company) return role || company
  return `${rawMode[0]?.toUpperCase() || 'M'}${rawMode.slice(1)} practice`
}

export function normalizePairCode(value = '') {
  return String(value).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8)
}
