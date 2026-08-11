import { describe, it, expect } from 'vitest'
import { createInterviewState } from './interviewState.js'

describe('InterviewState Phase 1 authorities', () => {
  it('marks unanswered questions superseded when a new question opens', () => {
    const state = createInterviewState({ profile: { targetRole: 'SWE' } })
    const q1 = state.commitQuestion('Design IRCTC.', { questionType: 'system_design', isFollowUp: false, classifierVersion: 't' })
    const q2 = state.commitQuestion('What are your strengths?', { questionType: 'experience', isFollowUp: false, classifierVersion: 't' })
    state.supersedeOpenQuestions(q2.id, 'new_question')
    expect(state.getQuestion(q1.id).status).toBe('superseded')
    expect(state.getQuestion(q2.id).status).toBe('committed')
  })

  it('terminal cancel/fail keep question text visible', () => {
    const state = createInterviewState()
    const q = state.commitQuestion('What are your strengths?', { questionType: 'experience', isFollowUp: false, classifierVersion: 't' })
    state.markQuestionCancelled(q.id, 'skip')
    expect(state.getQuestion(q.id).status).toBe('cancelled')
    expect(state.getUiQuestions().some(u => u.questionId === q.id && u.text.includes('strengths'))).toBe(true)

    const q2 = state.commitQuestion('Why Redis?', { questionType: 'follow_up', isFollowUp: true, classifierVersion: 't' })
    state.markQuestionFailed(q2.id, 'provider')
    expect(state.getQuestion(q2.id).status).toBe('failed')
  })

  it('speechTurns are the history authority (interviewer + candidate)', () => {
    const state = createInterviewState()
    state.commitQuestion('Q1', { questionType: 'experience', isFollowUp: false, classifierVersion: 't' })
    state.recordCandidate('I led payments')
    const hist = state.getLlmHistory({ includeLastAnswer: false })
    expect(hist.map(t => t.role)).toEqual(['interviewer', 'candidate'])
  })
})
