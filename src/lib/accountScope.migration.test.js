import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  STORAGE_SCHEMA_VERSION, migrateLegacyState, setActiveAccountScope,
  clearActiveAccountScope, getScopedItem, scopedKey, purgeScopedStorage,
} from './accountScope.js'

function makeStorage() {
  const values = new Map()
  return {
    values,
    get length() { return values.size },
    key: i => [...values.keys()][i] ?? null,
    getItem: k => values.get(k) ?? null,
    setItem: (k, v) => { values.set(k, String(v)) },
    removeItem: k => { values.delete(k) },
  }
}
const local = makeStorage()
const session = makeStorage()
vi.stubGlobal('localStorage', local)
vi.stubGlobal('sessionStorage', session)

describe('account-scoped schema v4 saved jobs and Resume Studio migration', () => {
  beforeEach(() => {
    local.values.clear()
    session.values.clear()
  })

  it('copies global legacy data to first authenticated account once, then removes global keys', () => {
    expect(STORAGE_SCHEMA_VERSION).toBe(4)
    localStorage.setItem('mm-saved-jobs', '[{"id":"private-A","notes":"Interview followup"}]')
    localStorage.setItem('mm-career-draft', '{"jd":"Private historical job description"}')
    setActiveAccountScope('account-A')
    expect(getScopedItem('mm-saved-jobs')).toContain('private-A')
    expect(getScopedItem('mm-career-draft')).toContain('Private historical')
    expect(localStorage.getItem('mm-saved-jobs')).toBeNull()
    expect(localStorage.getItem('mm-career-draft')).toBeNull()
    expect(localStorage.getItem('mm-storage-schema::account-A')).toBe('4')
    expect(migrateLegacyState('account-A')).toBe(false)
    setActiveAccountScope('account-B')
    expect(getScopedItem('mm-saved-jobs')).toBeNull()
    expect(getScopedItem('mm-career-draft')).toBeNull()
  })

  it('preserves existing account-specific values rather than overwriting with legacy data', () => {
    localStorage.setItem('mm-storage-schema::account-A', '3')
    localStorage.setItem('mm-saved-jobs::account-A', '[{"id":"already-A"}]')
    localStorage.setItem('mm-career-draft::account-A', '{"jd":"Already scoped A"}')
    localStorage.setItem('mm-saved-jobs', '[{"id":"legacy"}]')
    localStorage.setItem('mm-career-draft', '{"jd":"Global legacy"}')
    setActiveAccountScope('account-A')
    expect(getScopedItem('mm-saved-jobs')).toContain('already-A')
    expect(getScopedItem('mm-career-draft')).toContain('Already scoped A')
    expect(localStorage.getItem('mm-saved-jobs')).toBeNull()
    expect(localStorage.getItem('mm-career-draft')).toBeNull()
  })

  it('does not migrate data to Guest merely by loading or clearing a session', () => {
    localStorage.setItem('mm-saved-jobs', '[{"id":"legacy"}]')
    localStorage.setItem('mm-career-draft', '{"jd":"legacy"}')
    setActiveAccountScope('guest')
    expect(getScopedItem('mm-saved-jobs')).toBeNull()
    expect(getScopedItem('mm-career-draft')).toBeNull()
    expect(localStorage.getItem('mm-saved-jobs')).toContain('legacy')
    clearActiveAccountScope()
    expect(localStorage.getItem('mm-career-draft')).toContain('legacy')
  })

  it('keeps the legacy key and schema version if a scoped quota write fails, allowing retry', () => {
    localStorage.setItem('mm-storage-schema::account-A', '3')
    localStorage.setItem('mm-saved-jobs', '[{"id":"legacy job"}]')
    localStorage.setItem('mm-career-draft', '{"jd":"private draft"}')
    const prior = localStorage.setItem
    localStorage.setItem = (key, val) => {
      if (key === 'mm-career-draft::account-A') throw new Error('quota')
      prior(key, val)
    }
    try {
      setActiveAccountScope('account-A')
      expect(localStorage.getItem('mm-storage-schema::account-A')).toBe('3')
      expect(localStorage.getItem('mm-career-draft')).toContain('private draft')
      expect(localStorage.getItem('mm-saved-jobs::account-A')).toContain('legacy job')
    } finally { localStorage.setItem = prior }
    expect(migrateLegacyState('account-A')).toBe(true)
    expect(localStorage.getItem('mm-storage-schema::account-A')).toBe('4')
    expect(getScopedItem('mm-career-draft')).toContain('private draft')
  })

  it('purges both newly scoped keys on account deletion without touching another account', () => {
    localStorage.setItem('mm-saved-jobs::account-A', '[{"id":"A"}]')
    localStorage.setItem('mm-career-draft::account-A', '{"jd":"A"}')
    localStorage.setItem('mm-saved-jobs::account-B', '[{"id":"B"}]')
    localStorage.setItem('mm-career-draft::account-B', '{"jd":"B"}')
    expect(purgeScopedStorage('account-A')).toBe(2)
    expect(localStorage.getItem('mm-saved-jobs::account-A')).toBeNull()
    expect(localStorage.getItem('mm-career-draft::account-A')).toBeNull()
    expect(localStorage.getItem('mm-saved-jobs::account-B')).toContain('"B"')
    expect(localStorage.getItem('mm-career-draft::account-B')).toContain('"B"')
  })
})
