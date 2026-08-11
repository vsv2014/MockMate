import { describe, it, expect } from 'vitest'
import { createGeneration, hasEnoughAnswerLength, createSessionId } from './sessionGen.js'
import { shouldTriggerHint } from '../useSystemAudio.js'

describe('createGeneration (stale finalize soak)', () => {
  it('bumped generation invalidates prior async work', () => {
    const hintGen = createGeneration('hint')
    const g1 = hintGen.bump()
    expect(hintGen.isCurrent(g1)).toBe(true)

    // Q2 / Retry supersedes Q1
    const g2 = hintGen.bump()
    expect(hintGen.isCurrent(g1)).toBe(false)
    expect(hintGen.isCurrent(g2)).toBe(true)

    // Late Q1 final token must not mutate
    const mutations = []
    const isCurrent = (g) => hintGen.isCurrent(g)
    const finalize = (g, answer) => {
      if (!isCurrent(g)) return
      mutations.push(answer)
    }
    finalize(g1, 'stale Q1 answer')
    finalize(g2, 'fresh Q2 answer')
    expect(mutations).toEqual(['fresh Q2 answer'])
  })

  it('createSessionId is unique-ish', () => {
    const a = createSessionId()
    const b = createSessionId()
    expect(a).not.toBe(b)
    expect(a.startsWith('s_')).toBe(true)
  })
})

describe('hasEnoughAnswerLength (CJK-safe)', () => {
  it('accepts 3+ English words', () => {
    expect(hasEnoughAnswerLength('I built systems')).toBe(true)
  })
  it('rejects tiny English', () => {
    expect(hasEnoughAnswerLength('yes')).toBe(false)
  })
  it('accepts dense CJK without spaces', () => {
    expect(hasEnoughAnswerLength('我在上一家公司负责后端架构')).toBe(true)
  })
})

describe('shouldTriggerHint', () => {
  it('never triggers on candidate speech', () => {
    expect(shouldTriggerHint('Can you repeat the question?', { isCandidate: true })).toBe(false)
  })
  it('allows short follow-ups after a prior question', () => {
    expect(shouldTriggerHint('Why?', { hadPriorQuestion: true })).toBe(true)
  })
  it('blocks short chatter without prior question', () => {
    expect(shouldTriggerHint('Why?', { hadPriorQuestion: false })).toBe(false)
  })
})
