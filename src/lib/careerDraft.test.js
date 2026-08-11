import { describe, it, expect, beforeEach, vi } from 'vitest'
import { loadCareerDraft, saveCareerDraft, CAREER_DRAFT_KEY } from './careerDraft.js'

const store = new Map()
vi.stubGlobal('localStorage', {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)) },
  removeItem: k => { store.delete(k) },
})

describe('careerDraft', () => {
  beforeEach(() => { store.clear() })

  it('persists analysis JD without touching peerMockProfile', () => {
    saveCareerDraft({ jd: 'Need Node and Postgres for payments.', tab: 'tailor', limitedJd: true })
    const d = loadCareerDraft()
    expect(d.jd).toContain('Node')
    expect(d.tab).toBe('tailor')
    expect(d.limitedJd).toBe(true)
    expect(store.has('peerMockProfile')).toBe(false)
    expect(store.has(CAREER_DRAFT_KEY)).toBe(true)
  })

  it('keeps prior fields on partial save', () => {
    saveCareerDraft({ jd: 'JD A', person: 'Alex' })
    saveCareerDraft({ jd: 'JD B' })
    expect(loadCareerDraft().jd).toBe('JD B')
    expect(loadCareerDraft().person).toBe('Alex')
  })
})
