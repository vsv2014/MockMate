import { activeAccountScope, getScopedItem, setScopedItem } from './accountScope'
import { LANGUAGES } from './languages'

export const INTERVIEW_KITS_KEY = 'mm-interview-kits'
export const INTERVIEW_KITS_SCHEMA = 1
export const MAX_INTERVIEW_KITS = 30
export const MAX_KIT_TEXT_CHARS = 40_000

const INTERVIEW_TYPES = new Set(['Technical', 'Behavioral', 'System Design', 'Mixed'])
const LANGUAGE_SET = new Set(LANGUAGES)
const VOICE_STYLES = new Set(['Professional', 'Friendly', 'Concise', 'Detailed'])

function cleanText(value, max = 240) {
  return String(value ?? '').slice(0, max)
}

function nowIso() { return new Date().toISOString() }

function makeId() {
  try {
    if (globalThis.crypto?.randomUUID) return `kit_${globalThis.crypto.randomUUID()}`
  } catch {}
  return `kit_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
}

function validDate(value, fallback) {
  const date = String(value || '')
  return date && Number.isFinite(Date.parse(date)) ? date : fallback
}

export function normalizeInterviewKit(value = {}, { preserveId = true } = {}) {
  value = value && typeof value === 'object' ? value : {}
  const createdAt = validDate(value.createdAt, nowIso())
  const interviewType = INTERVIEW_TYPES.has(value.interviewType) ? value.interviewType : 'Technical'
  const language = LANGUAGE_SET.has(value.language) ? value.language : 'English'
  const voiceStyle = VOICE_STYLES.has(value.voiceStyle) ? value.voiceStyle : 'Professional'
  const targetRole = cleanText(value.targetRole, 120).trim()
  const targetCompany = cleanText(value.targetCompany, 120).trim()
  const title = cleanText(value.title, 100).trim() || [targetRole, targetCompany].filter(Boolean).join(' at ') || 'Untitled interview kit'
  return {
    id: preserveId && value.id ? cleanText(value.id, 180) : makeId(),
    title,
    candidateName: cleanText(value.candidateName, 120).trim(),
    targetRole,
    targetCompany,
    yearsExp: cleanText(value.yearsExp, 80).trim(),
    interviewType,
    language,
    voiceStyle,
    resume: cleanText(value.resume, MAX_KIT_TEXT_CHARS),
    jobDescription: cleanText(value.jobDescription, MAX_KIT_TEXT_CHARS),
    customPrompt: cleanText(value.customPrompt, 3_000),
    createdAt,
    updatedAt: validDate(value.updatedAt, createdAt),
  }
}

export function createInterviewKit(profile = {}, overrides = {}) {
  return normalizeInterviewKit({
    title: '',
    candidateName: profile.name || '',
    targetRole: profile.targetRole || '',
    targetCompany: profile.targetCompany || '',
    yearsExp: profile.yearsExp || '',
    interviewType: profile.interviewType || 'Technical',
    language: profile.language || 'English',
    voiceStyle: profile.voiceStyle || 'Professional',
    resume: profile.resume || '',
    jobDescription: profile.jobDescription || '',
    customPrompt: profile.customPrompt || '',
    ...overrides,
    id: overrides.id || makeId(),
    createdAt: overrides.createdAt || nowIso(),
    updatedAt: overrides.updatedAt || nowIso(),
  })
}

function normalizeStore(value) {
  const source = Array.isArray(value?.kits) ? value.kits : []
  const seen = new Set()
  const kits = source.slice(0, MAX_INTERVIEW_KITS).map(raw => normalizeInterviewKit(raw)).filter(kit => {
    if (!kit.id || seen.has(kit.id)) return false
    seen.add(kit.id)
    return true
  })
  const activeKitId = kits.some(kit => kit.id === value?.activeKitId)
    ? value.activeKitId
    : (kits[0]?.id || null)
  return { schemaVersion: INTERVIEW_KITS_SCHEMA, kits, activeKitId }
}

/**
 * Read Kit state from the current account's local scope. On first use only,
 * seed a separate starter Kit from the existing shared profile, if one exists.
 * Future profile edits never flow back into the Kit or vice versa.
 */
export function loadInterviewKitState(starterProfile = {}) {
  try {
    const raw = getScopedItem(INTERVIEW_KITS_KEY, null)
    if (raw !== null) {
      const parsed = JSON.parse(raw)
      return normalizeStore(parsed)
    }
  } catch {}

  const hasStarterContext = [
    starterProfile.name, starterProfile.targetRole, starterProfile.targetCompany,
    starterProfile.resume, starterProfile.jobDescription,
  ].some(value => String(value || '').trim())
  if (hasStarterContext) {
    const starter = createInterviewKit(starterProfile, { title: 'My interview kit' })
    const seeded = { schemaVersion: INTERVIEW_KITS_SCHEMA, kits: [starter], activeKitId: starter.id }
    saveInterviewKitState(seeded)
    return seeded
  }
  return { schemaVersion: INTERVIEW_KITS_SCHEMA, kits: [], activeKitId: null }
}

export function saveInterviewKitState(value) {
  try {
    const normalized = normalizeStore(value)
    return setScopedItem(INTERVIEW_KITS_KEY, JSON.stringify(normalized))
  } catch {
    return false
  }
}

export function activeInterviewKit(state) {
  const kits = Array.isArray(state?.kits) ? state.kits : []
  return kits.find(kit => kit.id === state?.activeKitId) || kits[0] || null
}

/** Compose a Kit-owned profile without writing to the shared account profile. */
export function profileFromInterviewKit(kit, baseProfile = {}) {
  if (!kit) return { ...baseProfile }
  return {
    ...baseProfile,
    name: kit.candidateName || '',
    targetRole: kit.targetRole || '',
    targetCompany: kit.targetCompany || '',
    yearsExp: kit.yearsExp || '',
    interviewType: kit.interviewType || 'Technical',
    language: kit.language || 'English',
    voiceStyle: kit.voiceStyle || 'Professional',
    resume: kit.resume || '',
    jobDescription: kit.jobDescription || '',
    customPrompt: kit.customPrompt || '',
  }
}

/** Copy only interview-owned fields back into an existing Kit. */
export function interviewKitFromProfile(kit, profile = {}) {
  return normalizeInterviewKit({
    ...kit,
    candidateName: profile.name || '',
    targetRole: profile.targetRole || '',
    targetCompany: profile.targetCompany || '',
    yearsExp: profile.yearsExp || '',
    interviewType: profile.interviewType || kit.interviewType,
    language: profile.language || kit.language,
    voiceStyle: profile.voiceStyle || kit.voiceStyle,
    resume: profile.resume || '',
    jobDescription: profile.jobDescription || '',
    customPrompt: profile.customPrompt || '',
    updatedAt: nowIso(),
  })
}

export function currentKitOwnerScope() { return activeAccountScope() }
