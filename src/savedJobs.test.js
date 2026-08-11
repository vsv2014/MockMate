import { describe, it, expect, beforeEach, vi } from 'vitest'
import { saveJob, updateSavedJob, loadSavedJobs, removeSavedJob } from './savedJobs.js'

const store = new Map()
vi.stubGlobal('localStorage', {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)) },
  removeItem: k => { store.delete(k) },
})

describe('savedJobs tracking', () => {
  beforeEach(() => { store.clear() })

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
})
