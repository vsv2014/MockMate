import { describe, it, expect, beforeEach, vi } from 'vitest'
import { saveJob, updateSavedJob, loadSavedJobs, removeSavedJob, savedKeySet, SAVED_MAX } from './savedJobs.js'
import { setActiveAccountScope, clearActiveAccountScope, scopedKey } from './lib/accountScope.js'

const store = new Map()
const session = new Map()
vi.stubGlobal('localStorage', {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)) },
  removeItem: k => { store.delete(k) },
})
vi.stubGlobal('sessionStorage', {
  getItem: k => session.get(k) ?? null,
  setItem: (k, v) => { session.set(k, String(v)) },
  removeItem: k => { session.delete(k) },
})

describe('savedJobs tracking and account isolation (N01)', () => {
  beforeEach(() => {
    store.clear()
    session.clear()
    setActiveAccountScope('guest')
  })

  it('defaults status to interested', () => {
    saveJob({ id: '1', title: 'Eng', url: 'https://x.test/1' })
    expect(loadSavedJobs()[0].status).toBe('interested')
  })

  it('updates status and notes', () => {
    saveJob({ id: '1', title: 'Eng', url: 'https://x.test/1' })
    updateSavedJob('1', { status: 'applied', notes: 'Referred by Priya' })
    const j = loadSavedJobs()[0]
    expect(j.status).toBe('applied')
    expect(j.notes).toBe('Referred by Priya')
  })

  it('ignores invalid status', () => {
    saveJob({ id: '1', title: 'Eng', url: 'https://x.test/1' })
    updateSavedJob('1', { status: 'nope' })
    expect(loadSavedJobs()[0].status).toBe('interested')
  })

  it('removes by id', () => {
    saveJob({ id: '1', title: 'Eng', url: 'https://x.test/1' })
    removeSavedJob('1')
    expect(loadSavedJobs()).toHaveLength(0)
  })

  it('isolates account A, B, and guest saved jobs and notes through logout', () => {
    setActiveAccountScope('account-A')
    saveJob({ id: 'shared-id', title: 'A job', notes: 'Private interview notes A' })
    updateSavedJob('shared-id', { status: 'offer' })
    const accountAKey = scopedKey('mm-saved-jobs')
    expect(store.get(accountAKey)).toContain('Private interview notes A')

    setActiveAccountScope('account-B')
    expect(loadSavedJobs()).toEqual([])
    saveJob({ id: 'shared-id', title: 'B job', notes: 'Private notes B' })
    expect(loadSavedJobs()[0].title).toBe('B job')
    expect(savedKeySet().has('shared-id')).toBe(true)

    clearActiveAccountScope()
    expect(loadSavedJobs()).toEqual([])
    saveJob({ id: 'guest-job', title: 'Guest bookmark' })
    setActiveAccountScope('account-A')
    expect(loadSavedJobs()).toHaveLength(1)
    expect(loadSavedJobs()[0]).toMatchObject({
      title: 'A job', status: 'offer', notes: 'Private interview notes A',
    })
    expect(loadSavedJobs()[0].title).not.toBe('B job')
    clearActiveAccountScope()
    expect(loadSavedJobs().map(x => x.id)).toEqual(['guest-job'])
  })

  it('preserves URL/id deduplication, timestamp order, and size cap', () => {
    saveJob({ url: 'https://x.test/one', title: 'One' })
    saveJob({ url: 'https://x.test/one', title: 'Duplicate' })
    expect(loadSavedJobs()).toHaveLength(1)
    for (let i = 0; i < SAVED_MAX + 10; i++) saveJob({ id: 'job-' + i, title: 'Job ' + i })
    expect(loadSavedJobs()).toHaveLength(SAVED_MAX)
    expect(loadSavedJobs().some(x => x.id === 'job-509')).toBe(true)
    expect(loadSavedJobs().some(x => x.id === 'job-0')).toBe(false)
  })

  it('does not return optimistic bookmarks after a failed storage write', () => {
    saveJob({ id: 'persisted', title: 'Existing' })
    const prior = localStorage.setItem
    localStorage.setItem = () => { throw new Error('quota') }
    try {
      expect(saveJob({ id: 'not-saved', title: 'New' }).map(x => x.id)).toEqual(['persisted'])
      expect(removeSavedJob('persisted').map(x => x.id)).toEqual(['persisted'])
      expect(updateSavedJob('persisted', { status: 'offer' })[0].status).toBe('interested')
      expect(loadSavedJobs().map(x => x.id)).toEqual(['persisted'])
    } finally { localStorage.setItem = prior }
  })

  it('handles malformed and legacy-shaped saved job containers safely', () => {
    store.set(scopedKey('mm-saved-jobs'), '{broken')
    expect(loadSavedJobs()).toEqual([])
    store.set(scopedKey('mm-saved-jobs'), JSON.stringify({ jobs: [{ id: 'wrong' }] }))
    expect(loadSavedJobs()).toEqual([])
  })
})
