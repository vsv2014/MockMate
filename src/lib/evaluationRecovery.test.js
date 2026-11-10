import { describe, expect, it, vi } from 'vitest'
import { canRetrySavedEvaluation, retrySavedEvaluation } from './evaluationRecovery.js'

const sample = { id: 'live-1', mode: 'live', score: null, captureStatus: 'captured',
  evaluationStatus: 'cancelled', role: 'Engineer', company: 'Acme', transcript: [
    { role: 'interviewer', text: 'Explain indexing' }, { role: 'hint', text: 'suggested answer' },
    { role: 'candidate', text: 'I use B-trees' },
  ] }
function harness(session = sample, report = { overallScore: 76, summary: 'Clear answer' }) {
  const save = vi.fn(async (_id, r) => ({ report: r, score: r.overallScore }))
  const request = vi.fn(async (_path, opts) => ({
    ok: true, json: async () => ({ report }),
    options: opts,
  }))
  return { save, request, fetchSession: vi.fn(async () => session) }
}

describe('Live evaluation retry from preserved History', () => {
  it('requires candidate speech and a recoverable Live status', async () => {
    expect(canRetrySavedEvaluation(sample)).toBe(true)
    expect(canRetrySavedEvaluation({ ...sample, evaluationStatus: 'scored' })).toBe(false)
    expect(canRetrySavedEvaluation({ ...sample, legacyReadOnly: true })).toBe(false)
    await expect(retrySavedEvaluation('x', harness({ ...sample, transcript: [
      { role: 'interviewer', text: 'Only interviewer' },
    ] }))).rejects.toThrow(/Candidate speech is missing/)
  })

  it('sends real interviewer/candidate turns only and preserves the original saved transcript', async () => {
    const deps = harness()
    const completed = await retrySavedEvaluation('live-1', deps)
    expect(completed.score).toBe(76)
    expect(deps.request).toHaveBeenCalledTimes(1)
    const [path, opts] = deps.request.mock.calls[0]
    expect(path).toBe('/api/evaluate')
    const payload = JSON.parse(opts.body)
    expect(payload.transcript).toEqual([sample.transcript[0], sample.transcript[2]])
    expect(payload.transcript.some(t => t.role === 'hint')).toBe(false)
    expect(deps.save).toHaveBeenCalledWith('live-1', { overallScore: 76, summary: 'Clear answer' },
      { expectedTranscript: sample.transcript })
  })

  it('never overwrites a transcript with invalid or failed evaluation', async () => {
    const broken = harness(sample, { summary: 'no score' })
    await expect(retrySavedEvaluation('live-1', broken)).rejects.toThrow(/no valid score/)
    expect(broken.save).not.toHaveBeenCalled()
    const error = harness()
    error.request.mockResolvedValueOnce({ ok: false, status: 429 })
    await expect(retrySavedEvaluation('live-1', error)).rejects.toThrow(/429/)
    expect(error.save).not.toHaveBeenCalled()
  })
})
