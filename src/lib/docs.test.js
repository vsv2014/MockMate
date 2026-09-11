import { describe, it, expect, beforeEach, vi } from 'vitest'
const { apiFetchMock } = vi.hoisted(() => ({ apiFetchMock: vi.fn() }))
vi.mock('./apiClient', () => ({ apiFetch: (...args) => apiFetchMock(...args) }))
import {
  addDoc, listDocs, removeDoc, inferDocType, getSelectedDocIds, setDocSelected,
  setDocType, filterDocsForRetrieve, DOC_TYPES,
  sampleChunksForIndex, retrieveContext,
} from './docs.js'

const store = new Map()
vi.stubGlobal('localStorage', {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)) },
  removeItem: k => { store.delete(k) },
})

describe('inferDocType', () => {
  it('maps resume/cv/jd/knowledge filenames', () => {
    expect(inferDocType('My_Resume.pdf')).toBe('resume')
    expect(inferDocType('cv-2024.txt')).toBe('resume')
    expect(inferDocType('Acme_job_description.pdf')).toBe('jd')
    expect(inferDocType('role-jd.md')).toBe('jd')
    expect(inferDocType('architecture-knowledge.pdf')).toBe('knowledge')
    expect(inferDocType('Opptra-Pricing-Signal-Interview-Knowledge-Bank.pdf')).toBe('knowledge')
    expect(inferDocType('interview-training.md')).toBe('training')
    expect(inferDocType('notes.txt')).toBe('supporting')
  })

  it('never returns the display phrase "job description"', () => {
    expect(inferDocType('job description.pdf')).toBe('jd')
  })
})

describe('addDoc upsert + selection', () => {
  beforeEach(() => { store.clear(); apiFetchMock.mockReset() })

  it('replaces existing resume instead of appending', () => {
    addDoc({ name: 'Resume', type: 'resume', text: 'First version of my resume with enough chars' })
    addDoc({ name: 'Resume (pasted)', type: 'resume', text: 'Second version of my resume with enough chars' })
    const docs = listDocs().filter(d => d.type === 'resume')
    expect(docs).toHaveLength(1)
    expect(docs[0].chars).toBeGreaterThan(20)
    expect(docs[0].selected).toBe(true)
  })

  it('replaces existing jd instead of appending', () => {
    addDoc({ name: 'Job Description', type: 'jd', text: 'First JD text long enough to store' })
    addDoc({ name: 'Job Description', type: 'jd', text: 'Updated JD text long enough to store again' })
    expect(listDocs().filter(d => d.type === 'jd')).toHaveLength(1)
  })

  it('still appends generic documents', () => {
    addDoc({ name: 'Notes A', type: 'document', text: 'Note one with enough content here' })
    addDoc({ name: 'Notes B', type: 'document', text: 'Note two with enough content here' })
    expect(listDocs().filter(d => d.type === 'document')).toHaveLength(2)
  })

  it('marks long documents as representative retrieval coverage', () => {
    const d = addDoc({ name: 'Handbook', type: 'knowledge', text: 'x'.repeat(21000) })
    expect(d.retrievalCoverage).toBe('representative')
  })

  it('reports a storage failure instead of pretending the document was saved', () => {
    const original = localStorage.setItem
    localStorage.setItem = () => { throw new Error('quota') }
    expect(addDoc({ name: 'Too large', type: 'knowledge', text: 'content' })).toBeNull()
    localStorage.setItem = original
  })

  it('removeDoc still works after upsert', () => {
    const d = addDoc({ name: 'Resume', type: 'resume', text: 'Removable resume text with enough length' })
    removeDoc(d.id)
    expect(listDocs().filter(x => x.type === 'resume')).toHaveLength(0)
  })

  it('unchecking excludes id from getSelectedDocIds', () => {
    const a = addDoc({ name: 'A', type: 'knowledge', text: 'Knowledge bank content long enough' })
    const b = addDoc({ name: 'B', type: 'knowledge', text: 'Other knowledge content long enough' })
    setDocSelected(b.id, false)
    expect(getSelectedDocIds()).toEqual([a.id])
  })

  it('setDocType updates category', () => {
    const d = addDoc({ name: 'x.pdf', type: 'document', text: 'Some supporting material text here' })
    setDocType(d.id, 'training')
    expect(listDocs().find(x => x.id === d.id).type).toBe('training')
    expect(DOC_TYPES).toContain('training')
  })
})

describe('filterDocsForRetrieve isolation', () => {
  it('empty docIds yields no docs', () => {
    const docs = [
      { id: '1', type: 'resume', text: 'a' },
      { id: '2', type: 'knowledge', text: 'b' },
    ]
    expect(filterDocsForRetrieve(docs, { docIds: [] })).toEqual([])
  })
  it('filters by ids and types', () => {
    const docs = [
      { id: '1', type: 'resume', text: 'a' },
      { id: '2', type: 'knowledge', text: 'b' },
      { id: '3', type: 'jd', text: 'c' },
    ]
    const out = filterDocsForRetrieve(docs, { docIds: ['1', '2', '3'], types: ['knowledge'] })
    expect(out.map(d => d.id)).toEqual(['2'])
  })
  it('treats an explicit type filter as a hard grounding boundary', () => {
    const docs = [
      { id: '1', type: 'resume', text: 'a' },
      { id: '2', type: 'supporting', text: 'b' },
    ]
    const out = filterDocsForRetrieve(docs, { docIds: ['1', '2'], types: ['knowledge'] })
    expect(out).toEqual([])
  })
})

describe('long document indexing', () => {
  it('samples the whole document instead of only its opening', () => {
    const chunks = Array.from({ length: 100 }, (_, i) => `chunk-${i}`)
    const sampled = sampleChunksForIndex(chunks, 5)
    expect(sampled).toEqual(['chunk-0', 'chunk-25', 'chunk-50', 'chunk-74', 'chunk-99'])
  })

  it('returns no grounding when every document chunk is below the relevance threshold', async () => {
    const d = addDoc({ name: 'Backend notes', type: 'knowledge', text: 'Node services and API reliability patterns.' })
    apiFetchMock.mockImplementation(async (_path, options) => {
      const input = JSON.parse(options.body).input
      const query = input.length === 1 && input[0] === 'unrelated question'
      return { ok: true, json: async () => ({ vectors: input.map(() => query ? [0, 1] : [1, 0]) }) }
    })
    const result = await retrieveContext('unrelated question', { docIds: [d.id], minScore: 0.2, budgetMs: 500 })
    expect(result).toBe('')
  })
})
