import { describe, it, expect, vi } from 'vitest'
import { sanitizeMetric, createSessionMetrics } from './sessionMetrics.js'

describe('sessionMetrics (Phase 6)', () => {
  it('uses the Live run identity rather than allocating another metrics identity', () => {
    const m = createSessionMetrics('live', { runId: 'same-run' })
    expect(m.end().sessionId).toBe('same-run')
  })
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

  it('records capture, preparation and retrieval once per first answer', () => {
    const appendSessionMetrics = vi.fn()
    vi.stubGlobal('window', { electronAPI: { appendSessionMetrics } })
    const now = vi.spyOn(performance, 'now').mockReturnValueOnce(100).mockReturnValueOnce(150)
    try {
      const m = createSessionMetrics('live')
      const hint = m.startHint({ captureMs: 200, preparationMs: 10, retrievalMs: 40 })
      m.markFirstToken(hint)
      m.markFirstToken(hint)
      const rows = appendSessionMetrics.mock.calls.map(([row]) => row).filter(row => row.type === 'ttft')
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({
        ms: 50, captureMs: 200, preparationMs: 10, retrievalMs: 40,
        triggerToFirstMs: 100, captureToFirstMs: 300,
      })
      m.end()
    } finally {
      now.mockRestore()
      vi.unstubAllGlobals()
    }
  })

  it('never persists raw provider errors containing interview questions or secrets', () => {
    const originalWindow = globalThis.window
    const saved = []
    globalThis.window = {
      electronAPI: { appendSessionMetrics: row => { saved.push(row) } },
    }
    try {
      const m = createSessionMetrics('live')
      m.markError('API 401: Bearer sk-private-secret: Explain your employer architecture')
      m.markError('Network dropped while asking: What is your salary?')
      m.markError('Unrecognized error with transcript and unredacted résumé details')
      expect(saved.filter(row => row.type === 'error').map(row => row.code))
        .toEqual(['auth', 'network', 'unknown'])
      const persisted = JSON.stringify(saved)
      expect(persisted).not.toContain('sk-private-secret')
      expect(persisted).not.toContain('employer architecture')
      expect(persisted).not.toContain('salary')
      expect(persisted).not.toContain('résumé')
      m.end()
    } finally {
      if (originalWindow === undefined) delete globalThis.window
      else globalThis.window = originalWindow
    }
  })

  it('counts provider failover, timeout, and cancellation lifecycle events', () => {
    const m = createSessionMetrics('live')
    m.markProviderEvent({ type: 'started', attemptIndex: 0, provider: 'gemini' })
    m.markProviderEvent({ type: 'failed', attemptIndex: 0, provider: 'gemini', status: 404 })
    m.markProviderEvent({ type: 'started', attemptIndex: 1, provider: 'groq' })
    m.markProviderEvent({ type: 'timed_out', attemptIndex: 1, provider: 'groq', status: 504 })
    m.markProviderEvent({ type: 'cancelled', attemptIndex: 2, provider: 'openai' })
    const s = m.summary()
    expect(s.streamFallbacks).toBe(0)
    expect(s.providerFallbacks).toBe(1)
    expect(s.providerAttemptFailures).toBe(2)
    expect(s.providerTimeouts).toBe(1)
    expect(s.providerCancellations).toBe(1)
    expect(s.errors).toBe(0)
  })
})
