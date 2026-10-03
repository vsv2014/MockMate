import { describe, expect, it } from 'vitest'
import {
  duoInviteUrl,
  isValidPairCode,
  mergePreferences,
  normalizePairCode,
  normalizeSessionDraft,
  PLAYBOOK_LIMIT,
  sessionTitle,
  sttLanguage,
  validateSessionDraft,
} from './session'

describe('mobile session setup', () => {
  it('requires company and role for live sessions', () => {
    const result = validateSessionDraft({ mode: 'live', role: '  ' })
    expect(result.valid).toBe(false)
    expect(result.errors).toEqual({
      role: 'Add the role you are preparing for.',
      company: 'Add a company for a live session.',
    })
  })

  it('allows mock and coding practice without a company', () => {
    expect(validateSessionDraft({ mode: 'mock', role: 'Frontend Engineer' }).valid).toBe(true)
    expect(validateSessionDraft({ mode: 'coding', role: 'SDE-2' }).valid).toBe(true)
  })

  it('never defaults history cards to Untitled session', () => {
    expect(sessionTitle({ mode: 'live', company: 'Acme', role: 'SWE' })).toBe('Acme · SWE')
    expect(sessionTitle({ mode: 'mock' })).toBe('Mock practice')
    expect(sessionTitle({ mode: 'solo' })).toBe('Solo practice')
  })

  it('normalizes and validates pair codes across desktop mock-hex and short mobile formats', () => {
    expect(normalizePairCode('ab-12 cd_345')).toBe('AB12CD34')
    const desktopCode = 'mock-7f3a9c1d8b22e4aa107f3a9c1d8b22e4'
    expect(normalizePairCode(`  ${desktopCode.toUpperCase()} `)).toBe(desktopCode)
    expect(isValidPairCode(desktopCode)).toBe(true)
    expect(isValidPairCode('ab12cd')).toBe(true)
    expect(isValidPairCode('ab12cd34')).toBe(true)
    expect(isValidPairCode('ab12')).toBe(false)
    expect(duoInviteUrl(desktopCode, 'https://app.mockmate.ai/')).toBe(`https://app.mockmate.ai/?room=${desktopCode}`)
    expect(duoInviteUrl('ab-12cd', 'https://app.mockmate.ai/')).toBe('https://app.mockmate.ai/?duo=AB12CD')
  })

  it('maps account languages to Deepgram STT codes safely', () => {
    expect(sttLanguage('English')).toBe('en')
    expect(sttLanguage('Telugu')).toBe('te')
    expect(sttLanguage('Hindi')).toBe('hi')
    expect(sttLanguage('en-IN')).toBe('en-IN')
    expect(sttLanguage('UnknownLang')).toBe('en')
  })

  it('merges mobile preferences without dropping existing cross-device keys', () => {
    const existing = { desktopTheme: 'dark', mobilePlaybook: 'old', mobileResponseStyle: 'concise' as const }
    const merged = mergePreferences(existing, { mobilePlaybook: 'new rules' })
    expect(merged).toEqual({
      desktopTheme: 'dark',
      mobilePlaybook: 'new rules',
      mobileResponseStyle: 'concise',
    })
  })

  it('snapshots bounded playbook, response style and unique document choices', () => {
    const result = normalizeSessionDraft({
      mode: 'mock', role: 'SWE', customInstructions: `  ${'x'.repeat(PLAYBOOK_LIMIT + 20)}  `,
      responseStyle: 'detailed', selectedDocumentIds: ['resume', 'resume', ' jd ', ''],
    })
    expect(result.customInstructions).toHaveLength(PLAYBOOK_LIMIT)
    expect(result.responseStyle).toBe('detailed')
    expect(result.selectedDocumentIds).toEqual(['resume', 'jd'])
  })

  it('falls back to a safe response style', () => {
    expect(normalizeSessionDraft({ role: 'SWE', responseStyle: 'essay' as any }).responseStyle).toBe('concise')
  })
})
