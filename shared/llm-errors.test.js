import { describe, it, expect } from 'vitest'
import { isTransient, isRateLimit, isQuotaExhausted } from './llm-errors.js'

describe('isTransient', () => {
  it('flags transient HTTP statuses', () => {
    for (const s of [408, 425, 500, 502, 503, 504, 529]) expect(isTransient({ status: s })).toBe(true)
  })
  it('flags network/overload messages (node + browser forms)', () => {
    for (const m of ['failed to fetch', 'fetch failed', 'ECONNRESET', 'socket hang up', 'overloaded', '503 (no body)'])
      expect(isTransient({ message: m })).toBe(true)
  })
  it('does NOT flag auth / bad-request as transient', () => {
    expect(isTransient({ status: 401, message: 'invalid api key' })).toBe(false)
    expect(isTransient({ status: 400, message: 'bad request' })).toBe(false)
  })
})

describe('isRateLimit', () => {
  it('flags 429 + rate-limit/quota messages', () => {
    expect(isRateLimit({ status: 429 })).toBe(true)
    expect(isRateLimit({ message: 'rate limit exceeded' })).toBe(true)
    expect(isRateLimit({ message: 'resource exhausted' })).toBe(true)
  })
  it('does not flag a 503', () => expect(isRateLimit({ status: 503 })).toBe(false))
})

describe('isQuotaExhausted', () => {
  it('flags insufficient-quota / billing', () => {
    expect(isQuotaExhausted({ code: 'insufficient_quota' })).toBe(true)
    expect(isQuotaExhausted({ message: 'exceeded your current quota' })).toBe(true)
  })
  it('does not flag a generic rate-limit', () => expect(isQuotaExhausted({ status: 429, message: 'slow down' })).toBe(false))
})
