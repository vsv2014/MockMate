import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readScopedArrayWithRecovery } from './storageRecovery.js'
import { setActiveAccountScope, getScopedItem, setScopedItem } from './accountScope.js'

function storage() {
  const values = new Map()
  return {
    values,
    get length() { return values.size },
    key: i => [...values.keys()][i] ?? null,
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, String(value)) },
    removeItem: key => { values.delete(key) },
  }
}
const local = storage(), session = storage()
vi.stubGlobal('localStorage', local)
vi.stubGlobal('sessionStorage', session)

describe('N05: scoped malformed JSON recovery', () => {
  beforeEach(() => {
    local.values.clear()
    session.values.clear()
    setActiveAccountScope('account-a')
  })

  it('backs up corrupt bytes before allowing a replacement and isolates backup by account', () => {
    setScopedItem('mm-sessions', '{corrupt private A data')
    const old = readScopedArrayWithRecovery('mm-sessions', 'mm-sessions-corrupt-backup-v1')
    expect(old.items).toEqual([])
    expect(old.writable).toBe(true)
    expect(old.corrupted).toBe(true)
    expect(getScopedItem('mm-sessions-corrupt-backup-v1')).toBe('{corrupt private A data')
    setScopedItem('mm-sessions', '[]')
    expect(readScopedArrayWithRecovery('mm-sessions', 'mm-sessions-corrupt-backup-v1').items).toEqual([])
    setActiveAccountScope('account-b')
    expect(getScopedItem('mm-sessions-corrupt-backup-v1')).toBeNull()
    expect(readScopedArrayWithRecovery('mm-sessions', 'mm-sessions-corrupt-backup-v1').corrupted).toBe(false)
  })

  it('refuses overwrites if quota prevents backing up original corrupt JSON', () => {
    setScopedItem('mm-docs', '{"broken":')
    const oldSet = local.setItem
    local.setItem = (key, value) => {
      if (key.includes('corrupt-backup')) throw new Error('quota')
      oldSet(key, value)
    }
    try {
      const read = readScopedArrayWithRecovery('mm-docs', 'mm-docs-corrupt-backup-v1')
      expect(read.writable).toBe(false)
      expect(getScopedItem('mm-docs')).toBe('{"broken":')
    } finally { local.setItem = oldSet }
  })

  it('refuses to overwrite an earlier different backup when corruption happens twice', () => {
    setScopedItem('mm-docs', 'first corrupt payload')
    expect(readScopedArrayWithRecovery('mm-docs', 'backup').writable).toBe(true)
    setScopedItem('mm-docs', 'second corrupt payload')
    const next = readScopedArrayWithRecovery('mm-docs', 'backup')
    expect(next.writable).toBe(false)
    expect(getScopedItem('backup')).toBe('first corrupt payload')
    expect(getScopedItem('mm-docs')).toBe('second corrupt payload')
  })

  it('accepts valid existing JSON arrays without producing backups', () => {
    setScopedItem('mm-docs', JSON.stringify([{ id: 'doc-1' }]))
    expect(readScopedArrayWithRecovery('mm-docs', 'backup')).toEqual({
      items: [{ id: 'doc-1' }], writable: true, corrupted: false,
    })
    expect(getScopedItem('backup')).toBeNull()
  })
})
