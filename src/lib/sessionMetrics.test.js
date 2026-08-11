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
})
