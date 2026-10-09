import { describe, it, expect, beforeEach, vi } from 'vitest'
const { apiFetchMock } = vi.hoisted(() => ({ apiFetchMock: vi.fn() }))
vi.mock('./apiClient', () => ({ apiFetch: (...args) => apiFetchMock(...args) }))
import {
  addDoc, listDocs, removeDoc, inferDocType, getSelectedDocIds, setDocSelected,
  setDocType, filterDocsForRetrieve, DOC_TYPES,
  sampleChunksForIndex, retrieveContext, canReuseSpeculativeRag,
} from './docs.js'

const store = new Map()
vi.stubGlobal('localStorage', {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)) },
  removeItem: k => { store.delete(k) },
})

describe('N05: corrupt document recovery without losing original bytes', () => {
  beforeEach(() => { store.clear(); apiFetchMock.mockReset() })

  it('keeps a scoped backup before adding a document over corrupt JSON', () => {
    store.set('mm-docs::guest', '{broken private document data')
    const saved = addDoc({ name: 'New notes', type: 'knowledge', text: 'A freshly imported set of notes.' })
    expect(saved).not.toBeNull()
    expect(listDocs()).toHaveLength(1)
    expect(store.get('mm-docs-corrupt-backup-v1::guest')).toBe('{broken private document data')
  })

  it('rejects a new document when existing corruption cannot be backed up', () => {
    store.set('mm-docs::guest', '{broken private document data')
    const prev = localStorage.setItem
    localStorage.setItem = (key, value) => {
      if (key.includes('corrupt-backup')) throw new Error('quota')
      store.set(key, String(value))
    }
    try {
      const saved = addDoc({ name: 'Another document', type: 'knowledge', text: 'New notes content.' })
      expect(saved).toBeNull()
      expect(store.get('mm-docs::guest')).toBe('{broken private document data')
    } finally { localStorage.setItem = prev }
  })
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

describe('RAG privacy race: delete/replace while embed in flight (blast-radius BR-11)', () => {
  beforeEach(() => { store.clear(); apiFetchMock.mockReset() })

  const persistedIndexRaw = () => {
    const key = [...store.keys()].find(k => k.startsWith('mm-docs-index-v1'))
    return key ? store.get(key) : null
  }
  const okEmbedResponse = input => ({
    ok: true,
    json: async () => ({ vectors: input.map(() => [1, 0]), embeddingModel: 'openai:text-embedding-3-small' }),
  })

  it('never resurrects persisted chunk text after removeDoc (stale embed resolves late)', async () => {
    const secret = 'SECRET-RESUME-RACE-TEXT ' + 'padding word '.repeat(80) // >600 chars => 2+ chunks
    const d = addDoc({ name: 'Secret_Resume.pdf', type: 'resume', text: secret })

    let resolveDocEmbed
    let docEmbedSignal
    apiFetchMock.mockImplementation((_path, options) => {
      const input = JSON.parse(options.body).input
      if (input.length === 1 && input[0] === 'Tell me about your background') {
        return Promise.resolve(okEmbedResponse(input)) // query embed resolves instantly
      }
      docEmbedSignal = options.signal
      return new Promise(resolve => { resolveDocEmbed = () => resolve(okEmbedResponse(input)) })
    })

    const retrieval = retrieveContext('Tell me about your background', { docIds: [d.id], minScore: 0, budgetMs: 8000 })
    await new Promise(r => setTimeout(r, 20)) // query embed done; document embed now pending
    expect(resolveDocEmbed).toBeTypeOf('function')

    removeDoc(d.id)          // user deletes the resume while embed is in flight
    resolveDocEmbed()        // old embed response arrives AFTER deletion
    await retrieval
    await new Promise(r => setTimeout(r, 20)) // let any (incorrect) late persist happen

    const raw = persistedIndexRaw()
    expect(raw || '{}').not.toContain('SECRET-RESUME-RACE-TEXT')
    expect(docEmbedSignal?.aborted).toBe(true) // stale in-flight request was cancelled
  })

  it('never persists old text when a resume is replaced while the old index is in flight', async () => {
    const oldText = 'OLD-PRIVATE-RESUME-TEXT ' + 'padding word '.repeat(80)
    const d = addDoc({ name: 'Resume', type: 'resume', text: oldText })

    let resolveOldEmbed
    apiFetchMock.mockImplementation((_path, options) => {
      const input = JSON.parse(options.body).input
      if (input.length === 1) return Promise.resolve(okEmbedResponse(input))
      const isOldText = input.some(t => t.includes('OLD-PRIVATE-RESUME-TEXT'))
      if (isOldText) return new Promise(resolve => { resolveOldEmbed = () => resolve(okEmbedResponse(input)) })
      return Promise.resolve(okEmbedResponse(input))
    })

    const first = retrieveContext('How do you scale systems?', { docIds: [d.id], minScore: 0, budgetMs: 8000 })
    await new Promise(r => setTimeout(r, 20)) // old document embed now pending
    expect(resolveOldEmbed).toBeTypeOf('function')

    addDoc({ name: 'Resume', type: 'resume', text: 'Brand new resume content about distributed systems and reliability engineering.' })
    resolveOldEmbed() // stale embed for the OLD text resolves after replacement
    await first
    await new Promise(r => setTimeout(r, 20))

    const raw = persistedIndexRaw()
    expect(raw || '{}').not.toContain('OLD-PRIVATE-RESUME-TEXT')
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

  it('reuses speculative RAG when committed question shares significant terms and cancels aborted speculative requests', async () => {
    expect(canReuseSpeculativeRag(
      'How did you implement Redis streams',
      'How did you implement Redis streams in production?',
    )).toBe(true)
    expect(canReuseSpeculativeRag(
      'How did you implement Redis streams',
      'Design a URL shortener with Postgres',
    )).toBe(false)

    const d = addDoc({ name: 'Resume', type: 'resume', text: 'Implemented Redis streams and consumer groups for high throughput.' })
    const ac = new AbortController()
    ac.abort()
    apiFetchMock.mockClear()
    const cancelled = await retrieveContext('How did you implement Redis streams?', { docIds: [d.id], signal: ac.signal })
    expect(cancelled).toBe('')
    expect(apiFetchMock).not.toHaveBeenCalled()
  })

  it('invalidates cached and persisted vectors when the embedding provider/model changes even if dimensions match', async () => {
    store.clear()
    apiFetchMock.mockReset()
    const d = addDoc({
      name: 'Distributed_Systems_Resume.pdf',
      type: 'resume',
      text: 'Architected Kafka event pipelines and Redis stream consumer groups handling 150k msg/sec.',
    })

    let currentEmbeddingModel = 'openai:text-embedding-3-small'
    let docEmbedCalls = 0
    apiFetchMock.mockImplementation(async (_path, options) => {
      const input = JSON.parse(options.body).input
      const isQuery = input.length === 1 && input[0].startsWith('How did you architect')
      if (!isQuery) docEmbedCalls += 1
      // Model A maps matching vectors along [1, 0]; Model B maps matching vectors along [0, 1] (same dimension = 2!)
      const vec = currentEmbeddingModel.startsWith('openai:') ? [1, 0] : [0, 1]
      return {
        ok: true,
        json: async () => ({
          vectors: input.map(() => vec),
          embeddingModel: currentEmbeddingModel,
        }),
      }
    })

    // First retrieval indexes under openai:text-embedding-3-small
    const first = await retrieveContext('How did you architect Kafka pipelines?', { docIds: [d.id], minScore: 0.2, budgetMs: 800 })
    expect(first).toContain('Kafka event pipelines')
    expect(docEmbedCalls).toBe(1)

    // Switch active embedding model to gemini:gemini-embedding-001 with identical vector dimension (2)
    // If stale [1, 0] vectors from Model A were reused against Model B's [0, 1] query vector,
    // cosine similarity would be 0 and retrieval would fail unless re-indexed!
    currentEmbeddingModel = 'gemini:gemini-embedding-001'
    const second = await retrieveContext('How did you architect Kafka pipelines?', { docIds: [d.id], minScore: 0.2, budgetMs: 800 })
    expect(second).toContain('Kafka event pipelines')
    expect(docEmbedCalls).toBe(2)
  })
})
