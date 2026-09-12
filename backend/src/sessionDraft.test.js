import { describe, expect, it } from 'vitest'
import { normalizeSessionPayload, normalizeTranscript, validateSessionPayload } from './sessionDraft.js'

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
    const value = normalizeSessionPayload({ mode: 'mock', role: 'x'.repeat(300), objective: 'y'.repeat(1200), customInstructions: 'z'.repeat(9000) })
    expect(value.role).toHaveLength(160)
    expect(value.objective).toHaveLength(1000)
    expect(value.customInstructions).toHaveLength(8000)
  })

  it('snapshots mobile response behavior and selected documents safely', () => {
    const value = normalizeSessionPayload({
      mode: 'live', source: 'mobile', company: 'Acme', role: 'SWE',
      responseStyle: 'detailed', selectedDocumentIds: ['resume', 'resume', ' jd ', '', 12],
    })
    expect(value.responseStyle).toBe('detailed')
    expect(value.selectedDocumentIds).toEqual(['resume', 'jd'])
    expect(normalizeSessionPayload({ mode: 'mock', responseStyle: 'essay' }).responseStyle).toBe('concise')
  })

  it('bounds and sanitizes synchronized transcript turns', () => {
    const transcript = normalizeTranscript([
      { role: 'interviewer', text: ' Question ', secret: 'drop me' },
      { role: 'candidate', text: 'x'.repeat(9000) },
      { role: 'system', text: '' },
    ])
    expect(transcript).toHaveLength(2)
    expect(transcript[0]).toEqual({ role: 'interviewer', text: 'Question', answer: undefined, isQuestion: undefined, kind: undefined, ts: undefined })
    expect(transcript[1].text).toHaveLength(8000)
  })
})
