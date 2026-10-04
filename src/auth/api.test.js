// Round-5 review P1: desktop signup must branch on the response union and must
// NEVER store a token (or proceed into a session) when the backend requires
// email verification and withholds the token.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const ls = new Map()
const ss = new Map()
vi.stubGlobal('localStorage', {
  getItem: k => (ls.has(k) ? ls.get(k) : null),
  setItem: (k, v) => { ls.set(k, String(v)) },
  removeItem: k => { ls.delete(k) },
})
vi.stubGlobal('sessionStorage', {
  getItem: k => (ss.has(k) ? ss.get(k) : null),
  setItem: (k, v) => { ss.set(k, String(v)) },
  removeItem: k => { ss.delete(k) },
})
const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

import { signup, getToken, clearToken } from './api.js'

const jsonResponse = (status, body) => Promise.resolve({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
})

describe('signup response union (round-5 P1)', () => {
  beforeEach(async () => { fetchMock.mockReset(); ls.clear(); ss.clear(); await clearToken() })

  it('stores NO token and reports verificationRequired when the backend withholds the token', async () => {
    fetchMock.mockReturnValueOnce(jsonResponse(201, { verificationRequired: true, user: { id: 'u1', email: 'a@b.c' } }))
    const result = await signup({ name: 'A', email: 'a@b.c', password: 'password123' })
    expect(result.verificationRequired).toBe(true)
    expect(result.user?.email).toBe('a@b.c')
    expect(await getToken()).toBeNull()
  })

  it('stores the token and reports an authenticated session on immediate signup', async () => {
    fetchMock.mockReturnValueOnce(jsonResponse(201, { token: 'jwt-1', user: { id: 'u2', email: 'b@b.c' } }))
    const result = await signup({ name: 'B', email: 'b@b.c', password: 'password123' })
    expect(result.verificationRequired).toBe(false)
    expect(await getToken()).toBe('jwt-1')
  })

  it('never fabricates a session when the response has neither token nor verification flag', async () => {
    fetchMock.mockReturnValueOnce(jsonResponse(201, { user: { id: 'u3' } }))
    const result = await signup({ name: 'C', email: 'c@b.c', password: 'password123' })
    expect(result.verificationRequired).toBe(true)
    expect(await getToken()).toBeNull()
  })
})
