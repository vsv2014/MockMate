import { describe, it, expect } from 'vitest'

/**
 * Contract: when clientClassification is present with classifierVersion,
 * resolveTurnClassification must not invent a different questionType.
 * We exercise via classifyTurn equivalence in interview module through a thin re-test
 * of the shared rule (full streamHint needs providers).
 */
import { classifyTurn } from './interviewClassify.js'

describe('one classification authority (client commit)', () => {
  it('committed classification shape is stable enough for server trust', () => {
    const c = classifyTurn({
      question: 'What are your strengths?',
      profile: { targetRole: 'Software Engineer' },
    })
    expect(c.classifierVersion).toBeTruthy()
    expect(c.questionType).toBe('experience')
    // Server resolveTurnClassification trusts this object as-is when both fields present.
    expect(!!(c.questionType && c.classifierVersion)).toBe(true)
  })
})
