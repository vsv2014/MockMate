import { describe, expect, it, vi } from 'vitest'
import { completeJSON } from './core.js'
import { evaluateSolo, groundedSoloGaps } from './interview.js'

vi.mock('./core.js', async importOriginal => ({ ...await importOriginal(), completeJSON: vi.fn() }))

const transcript = [
  { role: 'interviewer', text: 'How would you monitor retrieval quality?' },
  { role: 'candidate', text: 'I would measure precision.' },
]

describe('Solo feedback and retry', () => {
  it('keeps only exact candidate quotes tied to answered questions', async () => {
    const gap = { answerIndex: 1, evidence: 'measure precision', action: 'Define a threshold.' }
    expect(groundedSoloGaps([
      { ...gap, answerIndex: 0 },
      { ...gap, evidence: 'fabricated quote' },
      gap,
      { ...gap, action: 'Duplicate' },
    ], transcript)).toEqual([gap])

    vi.mocked(completeJSON).mockResolvedValueOnce({ overallScore: 60, practiceGaps: [gap] })
    await expect(evaluateSolo({ transcript })).resolves.toMatchObject({ overallScore: 60, practiceGaps: [gap] })
  })

  it('compares the same question and both answers in one call with a shared rubric', async () => {
    const dimensions = ['Correctness', 'Depth', 'Clarity'].map(name => ({ name, before: 2, after: 4, comment: 'Adds a target.' }))
    vi.mocked(completeJSON).mockResolvedValueOnce({ dimensions: [...dimensions].reverse() })
    const answer = 'Track precision@5 on labeled queries, targeting 80%.'
    await expect(evaluateSolo({ transcript, retry: { answerIndex: 1, answer } }))
      .resolves.toEqual({ retryComparison: dimensions })
    expect(JSON.parse(vi.mocked(completeJSON).mock.lastCall[0].messages[1].content)).toEqual({
      question: transcript[0].text, before: transcript[1].text, after: answer,
    })
  })

  it('rejects invalid selections and incomplete scoring', async () => {
    await expect(evaluateSolo({ transcript, retry: { answerIndex: 0, answer: 'retry' } }))
      .rejects.toMatchObject({ status: 400 })
    vi.mocked(completeJSON).mockResolvedValueOnce({ dimensions: [{ name: 'Depth', before: 2, after: 8 }] })
    await expect(evaluateSolo({ transcript, retry: { answerIndex: 1, answer: 'retry' } }))
      .rejects.toMatchObject({ status: 502 })
  })
})
