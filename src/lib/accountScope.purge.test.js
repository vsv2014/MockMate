import { describe, it, expect, beforeEach } from 'vitest'

// Minimal localStorage stub (vitest node environment has no DOM storage).
function makeStorage() {
  const map = new Map()
  return {
    get length() { return map.size },
    key: i => [...map.keys()][i] ?? null,
    getItem: k => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)) },
    removeItem: k => { map.delete(k) },
    clear: () => map.clear(),
  }
}

describe('purgeScopedStorage (Delete Account cleanup)', () => {
  beforeEach(() => {
    globalThis.localStorage = makeStorage()
    globalThis.sessionStorage = makeStorage()
  })

  it('removes every key for the account scope and nothing else', async () => {
    localStorage.setItem('mm-product-intel-v1::user-1', '[]')
    localStorage.setItem('mm-docs-index-v1::user-1', '{}')
    localStorage.setItem('mm-saved-playbooks-v1::user-1', '[]')
    localStorage.setItem('mm-product-intel-v1::user-2', '[]')
    localStorage.setItem('unrelated-key', 'x')

    const { purgeScopedStorage } = await import('./accountScope.js')
    const removed = purgeScopedStorage('user-1')

    expect(removed).toBe(3)
    expect(localStorage.getItem('mm-product-intel-v1::user-1')).toBeNull()
    expect(localStorage.getItem('mm-docs-index-v1::user-1')).toBeNull()
    expect(localStorage.getItem('mm-saved-playbooks-v1::user-1')).toBeNull()
    expect(localStorage.getItem('mm-product-intel-v1::user-2')).toBe('[]')
    expect(localStorage.getItem('unrelated-key')).toBe('x')
  })
})
