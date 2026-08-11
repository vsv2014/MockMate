import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  addDoc, listDocs, removeDoc, inferDocType, getSelectedDocIds, setDocSelected,
  setDocType, filterDocsForRetrieve, DOC_TYPES,
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
  beforeEach(() => { store.clear() })

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
  it('soft: type filter that matches nothing keeps selected docs', () => {
    const docs = [
      { id: '1', type: 'resume', text: 'a' },
      { id: '2', type: 'supporting', text: 'b' },
    ]
    const out = filterDocsForRetrieve(docs, { docIds: ['1', '2'], types: ['knowledge'] })
    expect(out.map(d => d.id).sort()).toEqual(['1', '2'])
  })
})
