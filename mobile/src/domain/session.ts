export const SESSION_MODES = ['live', 'mock', 'coding'] as const
export type SessionMode = typeof SESSION_MODES[number]

export const RESPONSE_STYLES = ['concise', 'balanced', 'detailed'] as const
export type ResponseStyle = typeof RESPONSE_STYLES[number]
export const PLAYBOOK_LIMIT = 8000

export const STARTER_PLAYBOOK = `Answer the exact current question first.
Use natural first-person spoken English.
Keep factual answers short; explain trade-offs only when useful or requested.
Use my selected documents as evidence and never invent experience, ownership, metrics or tools.
If the question is materially unclear, ask one short clarification.
If the interviewer interrupts or corrects the question, stop and adapt.`

export type SessionDraft = {
  mode: SessionMode
  company: string
  role: string
  objective: string
  customInstructions: string
  responseStyle: ResponseStyle
  selectedDocumentIds: string[]
}

export function normalizeSessionDraft(input: Partial<SessionDraft> = {}): SessionDraft {
  const mode = SESSION_MODES.includes(input.mode as SessionMode) ? input.mode as SessionMode : 'mock'
  return {
    mode,
    company: String(input.company || '').trim(),
    role: String(input.role || '').trim(),
    objective: String(input.objective || '').trim(),
    customInstructions: String(input.customInstructions || '').trim().slice(0, PLAYBOOK_LIMIT),
    responseStyle: RESPONSE_STYLES.includes(input.responseStyle as ResponseStyle)
      ? input.responseStyle as ResponseStyle
      : 'concise',
    selectedDocumentIds: Array.from(new Set(
      (Array.isArray(input.selectedDocumentIds) ? input.selectedDocumentIds : [])
        .map(String).map(id => id.trim()).filter(Boolean).slice(0, 50),
    )),
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
  const trimmed = String(value || '').trim()
  const mockMatch = trimmed.match(/mock-[a-f0-9]{8,64}/i)
  if (mockMatch) return mockMatch[0].toLowerCase().slice(0, 69)
  return trimmed.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8)
}

export function isValidPairCode(value = '') {
  const code = normalizePairCode(value)
  if (/^mock-[a-f0-9]{32,64}$/i.test(code)) return true
  return code.length >= 6 && code.length <= 8
}

export function duoInviteUrl(code = '', baseUrl = 'https://app.mockmate.ai') {
  const cleanBase = String(baseUrl || 'https://app.mockmate.ai').trim().replace(/\/$/, '')
  const cleanCode = normalizePairCode(code)
  if (!cleanCode) return `${cleanBase}/duo`
  const param = /^mock-/i.test(cleanCode) ? 'room' : 'duo'
  return `${cleanBase}/?${param}=${encodeURIComponent(cleanCode)}`
}

export function sttLanguage(value?: string) {
  const raw = String(value || 'English').trim()
  if (/^[a-z]{2}(?:-[A-Z]{2})?$/.test(raw)) return raw
  const map: Record<string, string> = {
    english: 'en', hindi: 'hi', telugu: 'te', tamil: 'ta', kannada: 'kn',
    malayalam: 'ml', marathi: 'mr', bengali: 'bn', spanish: 'es', french: 'fr', german: 'de',
  }
  return map[raw.toLowerCase()] || 'en'
}

export function mergePreferences<T extends Record<string, unknown>>(existing: T | undefined | null, patch: Partial<T>): T {
  return { ...(existing && typeof existing === 'object' ? existing : {} as T), ...patch }
}
