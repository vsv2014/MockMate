import { describe, expect, it } from 'vitest'
import { compareVoiceCorpus } from './corpus.mjs'
import { scoreCapturePlayback } from './score.mjs'

function fixtures() {
  const scenarios = ['first_question', 'silence_gap', 'interruption', 'source_switch']
  const sha = 'a'.repeat(64)
  const baseline = scenarios.map((scenario, idx) => ({
    scenario, recordingId: 'consented-' + idx, recordingSha256: sha,
    orphanFalseCommits: idx === 0 ? 2 : 0,
    turns: Array.from({ length: 10 }, (_, n) => ({
      referenceId: 'q' + n, missed: false,
      falseCommits: 0, correctionAttempts: n === 0 ? 2 : 0, userOverrides: 0,
      firstUsefulAnswerMs: 800,
    })),
  }))
  const candidate = structuredClone(baseline)
  for (const run of candidate) {
    run.orphanFalseCommits = 0
    run.turns[0].correctionAttempts = 0
    run.turns.forEach(turn => { turn.firstUsefulAnswerMs = 820 })
  }
  return [{ schemaVersion: 1, runs: baseline }, { schemaVersion: 1, runs: candidate }]
}

describe('production voice benchmark gating', () => {
  it('includes orphan phantom questions in voice error burden', () => {
    expect(scoreCapturePlayback(fixtures()[0].runs[0]).orphanFalseCommits).toBe(2)
    expect(scoreCapturePlayback(fixtures()[0].runs[0]).totalUserVisibleErrors).toBe(4)
  })
  it('can promote only documented improvement with same audio, full coverage and bounded p95', () => {
    const [baseline, candidate] = fixtures()
    const result = compareVoiceCorpus(baseline, candidate)
    expect(result.decision).toBe('CANDIDATE_IMPROVED')
    expect(result.referenceQuestions).toBe(40)
    expect(result.candidateErrors).toBe(0)
    expect(result.noFalseRegressions).toBe(true)
  })
  it('does not promote when coverage is too thin or a scenario is missing', () => {
    const [baseline, candidate] = fixtures()
    baseline.runs.pop()
    candidate.runs.pop()
    expect(compareVoiceCorpus(baseline, candidate).decision).toBe('INCONCLUSIVE_INSUFFICIENT_COVERAGE')
  })
  it('rejects any false commit regression even when overall error decreases', () => {
    const [baseline, candidate] = fixtures()
    candidate.runs[1].turns[4].falseCommits = 1
    expect(compareVoiceCorpus(baseline, candidate).decision).toBe('DO_NOT_ADOPT')
  })
  it('rejects partial latency evidence, slow p95 and substituted audio', () => {
    const [baseline, candidate] = fixtures()
    candidate.runs[1].turns[2].firstUsefulAnswerMs = null
    expect(compareVoiceCorpus(baseline, candidate).decision).toBe('INCONCLUSIVE_MISSING_LATENCY')
    candidate.runs[1].turns[2].firstUsefulAnswerMs = 901
    expect(compareVoiceCorpus(baseline, candidate).decision).toBe('DO_NOT_ADOPT')
    candidate.runs[1].recordingSha256 = 'b'.repeat(64)
    expect(() => compareVoiceCorpus(baseline, candidate)).toThrow(/identical recording/)
  })
  it('rejects missing orphan counts and non-unique recording IDs', () => {
    const [baseline, candidate] = fixtures()
    candidate.runs[0].orphanFalseCommits = -1
    expect(() => compareVoiceCorpus(baseline, candidate)).toThrow(/orphanFalseCommits/)
    candidate.runs[0].orphanFalseCommits = 0
    candidate.runs[1].recordingId = candidate.runs[0].recordingId
    expect(() => compareVoiceCorpus(baseline, candidate)).toThrow(/unique/)
  })
})
