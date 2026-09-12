import { describe, expect, it } from 'vitest'
import { normalizePairCode, normalizeSessionDraft, PLAYBOOK_LIMIT, sessionTitle, validateSessionDraft } from './session'

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

  it('normalizes pair codes', () => {
    expect(normalizePairCode('ab-12 cd_345')).toBe('AB12CD34')
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
