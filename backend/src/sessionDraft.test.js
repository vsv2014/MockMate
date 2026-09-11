import { describe, expect, it } from 'vitest'
import { normalizeSessionPayload, validateSessionPayload } from './sessionDraft.js'

describe('synced session payloads', () => {
  it('accepts the mobile session modes and normalizes source', () => {
    expect(validateSessionPayload({ mode: 'coding', role: 'SDE-2', source: 'mobile' }).error).toBe('')
    expect(normalizeSessionPayload({ mode: 'mock', role: 'QA', source: 'unknown' }).source).toBe('desktop')
  })

  it('requires role and company where appropriate', () => {
    expect(validateSessionPayload({ mode: 'mock' }).error).toBe('Add the role you are preparing for.')
    expect(validateSessionPayload({ mode: 'live', role: 'SWE', source: 'mobile' }).error).toBe('Add a company for a live session.')
    expect(validateSessionPayload({ mode: 'live' }).error).toBe('')
  })

  it('bounds user-authored fields', () => {
    const value = normalizeSessionPayload({ mode: 'mock', role: 'x'.repeat(300), objective: 'y'.repeat(1200) })
    expect(value.role).toHaveLength(160)
    expect(value.objective).toHaveLength(1000)
  })
})
