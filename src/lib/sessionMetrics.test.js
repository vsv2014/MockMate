import { describe, it, expect } from 'vitest'
import { sanitizeMetric, createSessionMetrics } from './sessionMetrics.js'

describe('sessionMetrics (Phase 6)', () => {
  it('strips transcript/resume-like fields', () => {
    const out = sanitizeMetric({
      ms: 120,
      resume: 'SECRET',
      question: 'tell me about yourself',
      code: 'ok',
    })
    expect(out.ms).toBe(120)
    expect(out.code).toBe('ok')
    expect(out.resume).toBeUndefined()
    expect(out.question).toBeUndefined()
  })

  it('tracks TTFT and summary without throwing offline', () => {
    const m = createSessionMetrics('live')
    const h = m.startHint()
    m.markFirstToken(h)
    m.markSttReconnect()
    m.markFallback()
    const s = m.end()
    expect(s.hints).toBe(1)
    expect(s.sttReconnects).toBe(1)
    expect(s.streamFallbacks).toBe(1)
    expect(s.ttftAvgMs).toEqual(expect.any(Number))
    expect(s.type).toBe('session_end')
  })

  it('counts provider failover, timeout, and cancellation lifecycle events', () => {
    const m = createSessionMetrics('live')
    m.markProviderEvent({ type: 'started', attemptIndex: 0, provider: 'gemini' })
    m.markProviderEvent({ type: 'failed', attemptIndex: 0, provider: 'gemini', status: 404 })
    m.markProviderEvent({ type: 'started', attemptIndex: 1, provider: 'groq' })
    m.markProviderEvent({ type: 'timed_out', attemptIndex: 1, provider: 'groq', status: 504 })
    m.markProviderEvent({ type: 'cancelled', attemptIndex: 2, provider: 'openai' })
    const s = m.summary()
    expect(s.streamFallbacks).toBe(1)
    expect(s.providerAttemptFailures).toBe(2)
    expect(s.providerTimeouts).toBe(1)
    expect(s.providerCancellations).toBe(1)
    expect(s.errors).toBe(2)
  })
})
