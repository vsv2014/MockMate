import { describe, expect, it } from 'vitest'
import { buildSessionReports, formatReport, parseDiagnostics, percentile, toScoresheetCsv } from './session-report.mjs'

const T0 = Date.parse('2026-10-13T10:00:00.000Z')
const at = (s, row) => JSON.stringify({ ts: new Date(T0 + s * 1000).toISOString(), level: 'info', ...row })
const S = { sessionId: 'live-abc', kind: 'live' }

function bundle() {
  return [
    JSON.stringify({ type: 'bundle_header', format: 'mockmate-diagnostics-v1', exportedAt: '2026-10-13T11:00:00.000Z', appVersion: '1.6.3', platform: 'win32', arch: 'x64' }),
    at(0, { component: 'session', event: 'session_start', ...S }),
    // Question 1: early start claimed, Gemini answer with reported usage.
    at(10, { component: 'live', event: 'speculative_hint', outcome: 'started', ...S }),
    at(11, { component: 'session', event: 'question_committed', captureLatencyMs: 1800, reason: 'terminal_question', ...S }),
    at(11, { component: 'live', event: 'speculative_hint', outcome: 'claimed', leadMs: 700, ...S }),
    at(10, { component: 'llm', event: 'attempt_started', attemptId: 'a1', operation: 'stream', provider: 'gemini_flash_lite', model: 'gemini-3.5-flash-lite', attemptIndex: 0, contextChars: 9000 }),
    at(11.4, { component: 'session', event: 'ttft', ms: 400, ...S }),
    at(14, { component: 'llm', event: 'attempt_succeeded', attemptId: 'a1', operation: 'stream', provider: 'gemini_flash_lite', model: 'gemini-3.5-flash-lite', ttftMs: 900, durationMs: 4000, inputTokens: 4000, outputTokens: 600 }),
    // Question 2: interviewer kept talking (early start cancelled); Claude stalls mid-answer.
    at(40, { component: 'live', event: 'speculative_hint', outcome: 'started', ...S }),
    at(42.9, { component: 'llm', event: 'attempt_started', attemptId: 'a-cancelled', operation: 'stream', provider: 'claude_sonnet', model: 'claude-sonnet-5', attemptIndex: 0 }),
    at(43, { component: 'llm', event: 'attempt_cancelled', attemptId: 'a-cancelled', operation: 'stream', provider: 'claude_sonnet', model: 'claude-sonnet-5' }),
    at(41, { component: 'live', event: 'speculative_hint', outcome: 'cancelled', reason: 'speech_continued', ageMs: 900, ...S }),
    at(43, { component: 'session', event: 'question_committed', captureLatencyMs: 3200, reason: 'semantic_complete', ...S }),
    at(43, { component: 'llm', event: 'attempt_started', attemptId: 'a2', operation: 'stream', provider: 'claude_sonnet', model: 'claude-sonnet-5-5', attemptIndex: 0, contextChars: 15000 }),
    at(44.5, { component: 'session', event: 'ttft', ms: 1500, ...S }),
    at(60, { component: 'llm', event: 'attempt_timed_out', attemptId: 'a2', operation: 'stream', provider: 'claude_sonnet', model: 'claude-sonnet-5-5', timeoutKind: 'stall', emitted: true }),
    at(60, { component: 'session', event: 'incomplete_stream', ...S }),
    at(61, { component: 'session', event: 'error', code: 'network', ...S }),
    at(70, { component: 'session', event: 'question_reject', reason: 'low_confidence', ...S }),
    at(80, { component: 'session', event: 'stt_final', confidence: 0.9, ...S }),
    at(81, { component: 'session', event: 'stt_final', confidence: 0.8, degraded: true, ...S }),
    at(120, { component: 'session', event: 'session_end', durationMs: 120_000, ...S }),
    // Outside the session window (plus grace): must not be counted.
    at(400, { component: 'llm', event: 'attempt_started', operation: 'stream', provider: 'groq', model: 'openai/gpt-oss-120b', attemptIndex: 0 }),
    'not json',
  ].join('\n')
}

describe('session-report', () => {
  it('parses the bundle header, rows and unreadable lines', () => {
    const { header, rows, invalid } = parseDiagnostics(bundle())
    expect(header).toMatchObject({ format: 'mockmate-diagnostics-v1', appVersion: '1.6.3' })
    expect(rows.length).toBe(22)
    expect(invalid).toBe(1)
  })

  it('summarizes timing, failures, usage, early starts and speech per session', () => {
    const { rows } = parseDiagnostics(bundle())
    const [r] = buildSessionReports(rows)
    expect(r).toMatchObject({ sessionId: 'live-abc', kind: 'live', durationMin: 2, ended: true })
    expect(r.questions).toMatchObject({ committed: 2, rejectedByReason: { low_confidence: 1 } })
    expect(r.answers).toMatchObject({ incompleteStreams: 1, errorsByCode: { network: 1 } })
    expect(r.answers.ttftFromCommitMs).toMatchObject({ count: 2, p50: 400, max: 1500 })
    expect(r.providers).toMatchObject({ attempts: 3, succeeded: 1, cancelled: 1, timedOutByKind: { stall: 1 } })
    expect(r.providers.byModel).toEqual({ 'gemini-3.5-flash-lite': 1, 'claude-sonnet-5-5': 1, 'claude-sonnet-5': 1 })
    expect(r.usage).toMatchObject({ inputTokens: 4000, outputTokens: 600, requestsWithoutUsage: 0 })
    expect(r.usage.estimatedCostUsd).toBeCloseTo(4000 / 1e6 * 0.3 + 600 / 1e6 * 2.5, 6)
    expect(r.earlyStart).toMatchObject({ started: 2, claimed: 1, claimRate: 0.5, cancelledByReason: { speech_continued: 1 } })
    expect(r.stt).toMatchObject({ finals: 2, avgConfidence: 0.85, degradedFinals: 1 })
  })

  it('correlates each committed question with its first token, model, early start and outcome', () => {
    const { rows } = parseDiagnostics(bundle())
    const [r] = buildSessionReports(rows)
    expect(r.questionRows).toEqual([
      expect.objectContaining({ n: 1, ttftMs: 400, model: 'gemini-3.5-flash-lite', earlyStartClaimed: true, incomplete: false, error: null }),
      expect.objectContaining({ n: 2, ttftMs: 1500, model: 'claude-sonnet-5-5', earlyStartClaimed: false, incomplete: true, error: 'network' }),
    ])
  })

  it('writes a scoresheet with empty, fixed rubric columns and a readable text report', () => {
    const { header, rows } = parseDiagnostics(bundle())
    const reports = buildSessionReports(rows)
    const csv = toScoresheetCsv(reports).trim().split('\n')
    expect(csv).toHaveLength(3)
    expect(csv[0]).toMatch(/^session,n,committed_at,.*A_answered_actual_question_0to2,.*notes$/)
    expect(csv[1].endsWith(',,,,,,,,')).toBe(true)
    const text = formatReport({ header, reports })
    expect(text).toMatch(/build 1\.6\.3/)
    expect(text).toMatch(/Early answer start: started 2, claimed 1 \(50%\)/)
    expect(text).toMatch(/timed out: stall 1/)
  })

  it('uses nearest-rank percentiles', () => {
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 50)).toBe(5)
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95)).toBe(10)
    expect(percentile([], 50)).toBeNull()
  })
})
