import { beforeEach, describe, expect, it, vi } from 'vitest'
import { loadSessions, saveSession } from './history.js'

const store = new Map()
vi.stubGlobal('localStorage', {
  getItem: key => store.get(key) ?? null,
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: key => store.delete(key),
})

describe('session history persistence', () => {
  beforeEach(() => store.clear())

  it('stores a compact immutable interview setup snapshot', () => {
    const entry = saveSession({
      report: { overallScore: 82, verdict: 'Strong' },
      transcript: [{ role: 'candidate', text: 'Answer' }],
      config: { interviewSetup: {
        source: 'live', targetCompany: 'Acme', targetRole: 'Backend Engineer',
        selectedDocumentIds: ['d1'], customInstructions: 'Be concise',
        resumeText: 'Resume', jobDescriptionText: 'JD',
      } },
    })
    expect(entry.label).toBe('Acme · Backend Engineer')
    expect(entry.mode).toBe('live')
    expect(entry.setup).toEqual({
      selectedDocumentIds: ['d1'], playbookActive: true,
      resumeIncluded: true, jobDescriptionIncluded: true,
    })
    expect(loadSessions()[0].company).toBe('Acme')
  })

  it('drops oldest history first to preserve the newest session under quota pressure', () => {
    saveSession({ report: { overallScore: 50 }, transcript: [{ text: 'old'.repeat(100) }] })
    const original = localStorage.setItem
    localStorage.setItem = (key, value) => {
      if (String(value).length > 650) throw new Error('quota')
      store.set(key, String(value))
    }
    const newest = saveSession({ report: { overallScore: 90 }, transcript: [{ text: 'new' }] })
    localStorage.setItem = original
    expect(newest).not.toBeNull()
    expect(newest.storagePruned).toBe(1)
    expect(loadSessions()).toHaveLength(1)
    expect(loadSessions()[0].score).toBe(90)
  })

  it('returns null when even the newest session cannot be stored', () => {
    const original = localStorage.setItem
    localStorage.setItem = () => { throw new Error('quota') }
    const result = saveSession({ report: { overallScore: 90 }, transcript: [{ text: 'new' }] })
    localStorage.setItem = original
    expect(result).toBeNull()
  })
})
