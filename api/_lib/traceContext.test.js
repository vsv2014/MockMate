import { describe, expect, it } from 'vitest'
import { withRequestTrace, currentRequestTrace, requestTraceId } from './traceContext.js'

describe('request trace isolation', () => {
  it('accepts only opaque safe identifiers', () => {
    expect(requestTraceId({ headers: { 'x-mockmate-request-id': 'api_test_123' } })).toBe('api_test_123')
    expect(requestTraceId({ headers: { 'x-mockmate-request-id': 'Bearer secret /\\ user@example.com' } })).toMatch(/^req_[a-f0-9]{32}$/)
  })
  it('isolates concurrent async provider requests without leaking context', async () => {
    const events = await Promise.all(['first', 'second'].map(id => withRequestTrace({
      headers: { 'x-mockmate-request-id': id },
    }, async () => {
      await new Promise(resolve => setTimeout(resolve, id === 'first' ? 12 : 1))
      return currentRequestTrace().requestId
    })))
    expect(events).toEqual(['first', 'second'])
    expect(currentRequestTrace()).toBeNull()
  })
})
