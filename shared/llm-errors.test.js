import { describe, it, expect } from 'vitest'
import { getRetryAfterMs, isTransient, isRateLimit, isQuotaExhausted } from './llm-errors.js'

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

describe('LLM limit classification', () => {
  it('identifies request-rate limits without calling them exhausted credits', () => {
    expect(isRateLimit({ status: 429, message: 'Too many requests' })).toBe(true)
    expect(isRateLimit({ message: 'rate limit exceeded' })).toBe(true)
    expect(isRateLimit({ message: 'resource exhausted' })).toBe(true)
    expect(isQuotaExhausted({ status: 429, code: 'rate_limit_exceeded', message: 'Too many requests' })).toBe(false)
  })

  it('classifies exhausted usage as quota even when the provider returns HTTP 429', () => {
    const error = { status: 429, code: 'insufficient_quota', message: 'You exceeded your current quota; check billing.' }
    expect(isQuotaExhausted(error)).toBe(true)
    expect(isRateLimit(error)).toBe(false)
    expect(isRateLimit({ message: 'Your quota has been exhausted' })).toBe(false)
  })

  it('does not label a plain 503 as a rate limit', () => {
    expect(isRateLimit({ status: 503 })).toBe(false)
  })
})

describe('getRetryAfterMs', () => {
  const now = Date.parse('2026-10-11T12:00:00Z')

  it('reads seconds, milliseconds, and composite reset headers', () => {
    expect(getRetryAfterMs({ headers: { 'Retry-After': '2.5' } }, now)).toBe(2500)
    expect(getRetryAfterMs({ headers: { 'retry-after-ms': '1250' } }, now)).toBe(1250)
    expect(getRetryAfterMs({ headers: { 'x-ratelimit-reset-tokens': '1m30s' } }, now)).toBe(90_000)
  })

  it('reads HTTP-date Retry-After and SDK response headers', () => {
    expect(getRetryAfterMs({ response: { headers: new Headers({ 'retry-after': 'Sun, 11 Oct 2026 12:00:10 GMT' }) } }, now)).toBe(10_000)
  })

  it('uses the longest active reset and ignores invalid or expired values', () => {
    expect(getRetryAfterMs({ headers: {
      'retry-after': '3',
      'x-ratelimit-reset-requests': '5s',
      'x-ratelimit-reset-tokens': 'nope',
    } }, now)).toBe(5000)
    expect(getRetryAfterMs({ headers: { 'retry-after': 'not a date' } }, now)).toBe(0)
    expect(getRetryAfterMs({ headers: { 'retry-after': 'Sun, 11 Oct 2026 11:59:50 GMT' } }, now)).toBe(0)
  })
})
