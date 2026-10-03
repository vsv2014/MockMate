import { describe, expect, it } from 'vitest'
import { createInterviewState } from './interviewState.js'

describe('InterviewState generation authority', () => {
  it('rejects a stale generation for the same question', () => {
    const state = createInterviewState()
    const q = state.commitQuestion('Explain event sourcing.', { questionType: 'technical', isFollowUp: false })
    expect(state.setQuestionGeneration(q.id, 'gen-new')).toBe(true)
    expect(state.commitAnswer({ questionId: q.id, generationId: 'gen-old', text: 'stale' })).toBeNull()
    expect(state.commitAnswer({ questionId: q.id, generationId: 'gen-new', text: 'current' })?.text).toBe('current')
    expect(state.getUiQuestions().find(x => x.questionId === q.id)?.answer).toBe('current')
  })

  it('does not truncate the opening conversation during long segmented sessions', () => {
    const state = createInterviewState()
    const q = state.commitQuestion('Opening question', { questionType: 'experience', isFollowUp: false })
    state.recordCandidate('opening answer')
    for (let i = 0; i < 1100; i += 1) state.recordCandidate(`segment-${i}`)
    const snap = state.getSnapshot()
    expect(snap.speechTurns[0].questionId).toBe(q.id)
    expect(snap.speechTurns[0].text).toBe('Opening question')
    expect(snap.speechTurns.some(t => t.text === 'opening answer')).toBe(true)
    expect(snap.speechTurns.length).toBeGreaterThan(1000)
  })
})
