import { describe, it, expect, beforeEach, vi } from 'vitest'
import { loadSavedJobs, saveJob, removeSavedJob, savedKeySet } from './savedJobs'

// jsdom-free localStorage stub
beforeEach(() => {
  let store = {}
  vi.stubGlobal('localStorage', {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v) },
    removeItem: k => { delete store[k] },
  })
})

const job = (id, extra = {}) => ({ id, title: `Role ${id}`, company: 'Acme', url: `https://x/${id}`, score: 80, ...extra })

describe('savedJobs', () => {
  it('starts empty', () => expect(loadSavedJobs()).toEqual([]))

  it('saves a job and reports it as saved', () => {
    saveJob(job('a'))
    expect(loadSavedJobs()).toHaveLength(1)
    expect(savedKeySet().has('a')).toBe(true)
  })

  it('dedupes the same job by id', () => {
    saveJob(job('a'))
    saveJob(job('a'))
    expect(loadSavedJobs()).toHaveLength(1)
  })

  it('falls back to url as the key when id is missing', () => {
    saveJob({ title: 'No id', url: 'https://x/z', score: 10 })
    expect(savedKeySet().has('https://x/z')).toBe(true)
  })

  it('ignores a job with neither id nor url', () => {
    saveJob({ title: 'orphan', score: 1 })
    expect(loadSavedJobs()).toHaveLength(0)
  })

  it('removes a saved job', () => {
    saveJob(job('a')); saveJob(job('b'))
    removeSavedJob('a')
    expect(savedKeySet().has('a')).toBe(false)
    expect(savedKeySet().has('b')).toBe(true)
  })

  it('survives corrupt storage', () => {
    localStorage.setItem('mm-saved-jobs', '{not json')
    expect(loadSavedJobs()).toEqual([])
  })
})
