import { describe, it, expect, beforeEach, vi } from 'vitest'
import { addDoc, listDocs, removeDoc } from './docs.js'

const KEY = 'mm-docs'
const store = new Map()
vi.stubGlobal('localStorage', {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)) },
  removeItem: k => { store.delete(k) },
})

describe('addDoc upsert for resume/jd', () => {
  beforeEach(() => { store.clear() })

  it('replaces existing resume instead of appending', () => {
    addDoc({ name: 'Resume', type: 'resume', text: 'First version of my resume with enough chars' })
    addDoc({ name: 'Resume (pasted)', type: 'resume', text: 'Second version of my resume with enough chars' })
    const docs = listDocs().filter(d => d.type === 'resume')
    expect(docs).toHaveLength(1)
    expect(docs[0].chars).toBeGreaterThan(20)
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
})
