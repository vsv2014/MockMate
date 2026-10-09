import { beforeEach, describe, expect, it, vi } from 'vitest'

const { apiFetchMock } = vi.hoisted(() => ({ apiFetchMock: vi.fn() }))
vi.mock('./apiClient', () => ({ apiFetch: (...args) => apiFetchMock(...args) }))

import { listDocs, retrieveContext } from './docs.js'
import { activeAccountScope } from './accountScope.js'

const local = new Map()
const session = new Map()
vi.stubGlobal('localStorage', {
  getItem: k => local.get(k) ?? null,
  setItem: (k, v) => local.set(k, String(v)),
  removeItem: k => local.delete(k),
})
vi.stubGlobal('sessionStorage', {
  getItem: k => session.get(k) ?? null,
  setItem: (k, v) => session.set(k, String(v)),
  removeItem: k => session.delete(k),
})

function asUser(user, text) {
  session.set('mm-active-account-scope', user)
  if (text) local.set('mm-docs::' + user, JSON.stringify([
    { id: 'same-document-id', name: 'Private notes', type: 'knowledge', selected: true, text },
  ]))
}

const response = (texts, vector = [1, 0]) => ({
  ok: true,
  json: async () => ({
    vectors: texts.map(() => vector),
    embeddingModel: 'test:account-isolated-model',
  }),
})

describe('N06: never reuse RAG document embeddings or delayed results across account scopes', () => {
  beforeEach(() => {
    local.clear()
    session.clear()
    apiFetchMock.mockReset()
  })

  it('drops lexical fallback from an earlier account after switching during query embedding', async () => {
    asUser('account-a', 'PRIVATE ACCOUNT A TRANSCRIPT. '.repeat(35))
    let rejectFirst
    apiFetchMock.mockImplementation(() => new Promise((_resolve, reject) => {
      rejectFirst = reject
    }))
    const request = retrieveContext('PRIVATE ACCOUNT A TRANSCRIPT', { docIds: ['same-document-id'], budgetMs: 2500 })
    expect(rejectFirst).toBeTypeOf('function')
    asUser('account-b', 'ACCOUNT B SAFE DOCUMENT TEXT.')
    rejectFirst(new Error('Provider unavailable'))
    expect(await request).toBe('')
    expect(listDocs().map(x => x.id)).toEqual(['same-document-id'])
  })

  it('cannot persist in-flight A embeddings under B or return A results after switch', async () => {
    asUser('account-a', 'ACCOUNT-A-PRIVATE-EMBEDDING '.repeat(35))
    let completeDoc
    apiFetchMock.mockImplementation((_path, options) => {
      const texts = JSON.parse(options.body).input
      if (texts.length === 1 && texts[0] === 'Describe secure storage') {
        return Promise.resolve(response(texts))
      }
      return new Promise(resolve => { completeDoc = () => resolve(response(texts)) })
    })
    const request = retrieveContext('Describe secure storage', {
      docIds: ['same-document-id'], minScore: 0, budgetMs: 2500,
    })
    for (let i = 0; i < 20 && !completeDoc; i++) await new Promise(resolve => setTimeout(resolve, 5))
    expect(completeDoc).toBeTypeOf('function')
    asUser('account-b', 'ACCOUNT B UNIQUE ARCHITECTURE '.repeat(35))
    completeDoc()
    expect(await request).toBe('')
    expect(local.get('mm-docs-index-v1::account-b') || '').not.toContain('ACCOUNT-A-PRIVATE')
    apiFetchMock.mockImplementation((_path, options) => Promise.resolve(
      response(JSON.parse(options.body).input),
    ))
    const own = await retrieveContext('Describe secure storage', {
      docIds: ['same-document-id'], minScore: 0, budgetMs: 2500,
    })
    expect(own).toContain('ACCOUNT B UNIQUE')
    expect(own).not.toContain('ACCOUNT-A-PRIVATE')
  })

  it('rebuilds same-ID, same-signature in-memory vectors for a different account', async () => {
    const commonText = 'Shared product introduction for two different private accounts.'
    let documentEmbeds = 0
    asUser('account-a', commonText)
    apiFetchMock.mockImplementation((_path, options) => {
      const input = JSON.parse(options.body).input
      const isQuestion = input.length === 1 && input[0] === 'question for semantic index'
      if (!isQuestion) documentEmbeds += 1
      return Promise.resolve(response(input, activeAccountScope() === 'account-a' ? [1, 0] : [0, 1]))
    })
    const opts = { docIds: ['same-document-id'], minScore: 0.2, budgetMs: 2500 }
    expect(await retrieveContext('question for semantic index', opts)).toContain('Shared product introduction')
    expect(documentEmbeds).toBe(1)
    asUser('account-b', commonText)
    expect(await retrieveContext('question for semantic index', opts)).toContain('Shared product introduction')
    expect(documentEmbeds).toBe(2)
  })
})
