import { describe, expect, it } from 'vitest'
import { buildDocumentContext, DOCUMENT_TEXT_LIMIT, normalizeDocumentPayload, validateDocumentPayload } from './documentDraft.js'

describe('hosted mobile documents', () => {
  it('requires a name and non-empty text', () => {
    expect(validateDocumentPayload({}).error).toBe('Add a document name.')
    expect(validateDocumentPayload({ name: 'Resume' }).error).toBe('Paste document text before saving.')
  })

  it('normalizes type and bounds stored text', () => {
    const value = normalizeDocumentPayload({ name: ' Resume ', type: 'unknown', text: 'x'.repeat(DOCUMENT_TEXT_LIMIT + 20) })
    expect(value.name).toBe('Resume')
    expect(value.type).toBe('document')
    expect(value.text).toHaveLength(DOCUMENT_TEXT_LIMIT)
  })

  it('returns only relevant selected-document context', () => {
    const context = buildDocumentContext('How did you handle Kafka retries?', [
      { name: 'Resume', type: 'resume', text: 'Built Kafka consumers with idempotency and bounded retries.' },
      { name: 'Cooking', type: 'supporting', text: 'A recipe for tomato soup.' },
    ])
    expect(context).toContain('Resume')
    expect(context).toContain('Kafka consumers')
    expect(context).not.toContain('tomato soup')
    expect(buildDocumentContext('unrelated vocabulary', [{ name: 'Resume', text: 'Kafka only' }])).toBe('')
  })
})
