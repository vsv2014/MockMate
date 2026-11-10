import { describe, expect, it } from 'vitest'
import { analyzeLiveSession, MIN_LIVE_SOAK_MS } from './verify-live-60min.mjs'

const id = 'valid-session'
const at = offset => new Date(Date.parse('2026-11-10T08:00:00Z') + offset).toISOString()
function row(component, event, offset, extra = {}) {
  return { component, event, ts: at(offset), sessionId: id, ...extra }
}
function fixture({ minutes = 61, candidate = true, scored = true, finalErrors = 0 } = {}) {
  const rows = [
    row('session', 'session_start', 0, { kind: 'live', sessionKind: 'live' }),
    row('stt', 'socket_open', 1000, { mode: 'system_audio' }),
    row('stt', 'socket_open', 2000, { mode: 'microphone' }),
  ]
  for (let i = 0; i < 12; i++) {
    const t = 10_000 + i * 220_000
    rows.push(row('session', 'stt_final', t))
    rows.push(row('session', 'question_committed', t + 2000))
    rows.push(row('session', 'ttft', t + 4000, { ms: 900 }))
    if (candidate) rows.push(row('stt', 'candidate_microphone_final', t + 12_000))
  }
  rows.push(row('session', 'session_end', minutes * 60_000,
    { kind: 'live', sessionKind: 'live', durationMs: minutes * 60_000, hints: 12,
      errors: finalErrors, incompleteStreams: 0 }))
  rows.push({ component: 'session', event: 'history_commit_succeeded',
    runId: id, ts: at(minutes * 60_000 + 1000), captureStatus: 'captured',
    evaluationStatus: scored ? 'scored' : 'cancelled' })
  return rows
}

describe('real Live 60-minute diagnostics acceptance analyzer', () => {
  it('requires an actual completed long session with both audio channels and saved scored history', () => {
    const report = analyzeLiveSession(fixture())
    expect(report.passed).toBe(true)
    expect(report.durationMinutes).toBe(61)
    expect(report.checks.candidateResponses).toBe(true)
    expect(report.metrics.candidateSpeechSegments).toBe(12)
    expect(MIN_LIVE_SOAK_MS).toBe(3_600_000)
  })
  it('rejects a long session with no candidate speech or saved score', () => {
    const report = analyzeLiveSession(fixture({ candidate: false, scored: false }))
    expect(report.passed).toBe(false)
    expect(report.failures).toContain('Fewer than five candidate speech segments captured')
    expect(report.failures).toContain('Final saved evaluation is not scored (retry from Sessions)')
  })
  it('reports errors and duration correctly instead of accepting a simple open window', () => {
    const report = analyzeLiveSession(fixture({ minutes: 20, finalErrors: 1 }))
    expect(report.passed).toBe(false)
    expect(report.checks.duration).toBe(false)
    expect(report.checks.userVisibleErrors).toBe(false)
  })
  it('treats speech gaps as review warnings, not proof of audio failure', () => {
    const rows = fixture()
    const report = analyzeLiveSession(rows)
    expect(report.warnings.some(w => /Longest gap/.test(w))).toBe(true)
    expect(report.checks.audioCaptureHealthy).toBe(true)
  })
})
