import { describe, it, expect, beforeEach, vi } from 'vitest'
import { loadCareerDraft, saveCareerDraft, CAREER_DRAFT_KEY } from './careerDraft.js'
import { setActiveAccountScope, clearActiveAccountScope, scopedKey } from './accountScope.js'

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

describe('careerDraft account-scoped persistence (N02)', () => {
  beforeEach(() => {
    store.clear()
    session.clear()
    setActiveAccountScope('guest')
  })

  it('persists analysis JD without touching peerMockProfile', () => {
    saveCareerDraft({ jd: 'Need Node and Postgres for payments.', tab: 'tailor', limitedJd: true })
    const d = loadCareerDraft()
    expect(d.jd).toContain('Node')
    expect(d.tab).toBe('tailor')
    expect(d.limitedJd).toBe(true)
    expect(store.has('peerMockProfile')).toBe(false)
    expect(store.has(scopedKey(CAREER_DRAFT_KEY))).toBe(true)
    expect(store.has(CAREER_DRAFT_KEY)).toBe(false)
  })

  it('keeps prior fields on partial save', () => {
    saveCareerDraft({ jd: 'JD A', person: 'Alex', company: 'Acme' })
    saveCareerDraft({ jd: 'JD B' })
    expect(loadCareerDraft().jd).toBe('JD B')
    expect(loadCareerDraft().person).toBe('Alex')
    expect(loadCareerDraft().company).toBe('Acme')
  })

  it('isolates account A, account B and guest drafts including private generated results', () => {
    setActiveAccountScope('account-A')
    saveCareerDraft({
      jd: 'Private recruiter details account A', person: 'A person', company: 'Company A',
      tab: 'referral', result: { fullAnswer: 'PRIVATE-A-RESUME-ANALYSIS' }, resultTab: 'referral',
    })
    setActiveAccountScope('account-B')
    expect(loadCareerDraft()).toEqual({})
    saveCareerDraft({ jd: 'Account B JD', person: 'B person', company: 'Company B' })
    expect(JSON.stringify(loadCareerDraft())).not.toContain('PRIVATE-A-RESUME-ANALYSIS')
    clearActiveAccountScope()
    expect(loadCareerDraft()).toEqual({})
    saveCareerDraft({ jd: 'Guest private draft' })
    setActiveAccountScope('account-A')
    expect(loadCareerDraft().result.fullAnswer).toBe('PRIVATE-A-RESUME-ANALYSIS')
    expect(loadCareerDraft().jd).toContain('account A')
    setActiveAccountScope('account-B')
    expect(loadCareerDraft().jd).toBe('Account B JD')
    clearActiveAccountScope()
    expect(loadCareerDraft().jd).toBe('Guest private draft')
  })

  it('returns null when quota prevents persistence instead of reporting a successful save', () => {
    saveCareerDraft({ jd: 'Persisted draft' })
    const prior = localStorage.setItem
    localStorage.setItem = () => { throw new Error('quota') }
    try {
      expect(saveCareerDraft({ jd: 'Unsaved draft' })).toBeNull()
      expect(loadCareerDraft().jd).toBe('Persisted draft')
    } finally { localStorage.setItem = prior }
  })

  it('handles corrupt JSON and invalid shapes', () => {
    store.set(scopedKey(CAREER_DRAFT_KEY), '{bad-json')
    expect(loadCareerDraft()).toEqual({})
    store.set(scopedKey(CAREER_DRAFT_KEY), JSON.stringify(['not a career object']))
    const draft = loadCareerDraft()
    expect(draft.jd).toBe('')
    expect(draft.result).toBeNull()
  })
})
