import { describe, it, expect } from 'vitest'
import { mergeTurns, normalizeQ, isStragglerDuplicate } from './transcript.js'

describe('mergeTurns', () => {
  it('merges consecutive same-speaker segments and drops empties', () => {
    const out = mergeTurns([
      { role: 'interviewer', text: 'Tell me about yourself' },
      { role: 'candidate', text: 'Sure, I am' },
      { role: 'candidate', text: 'a backend engineer' },
      { role: 'candidate', text: '   ' },
      { role: 'interviewer', text: 'What did you build?' },
    ])
    expect(out.map(t => t.role)).toEqual(['interviewer', 'candidate', 'interviewer'])
    expect(out[1].text).toBe('Sure, I am a backend engineer')
  })
  it('handles empty/garbage input', () => {
    expect(mergeTurns([])).toEqual([])
    expect(mergeTurns(null)).toEqual([])
  })
})

describe('normalizeQ', () => {
  it('lowercases + strips punctuation + collapses spaces', () => {
    expect(normalizeQ('  What IS a Closure?? ')).toBe('what is a closure')
  })
})

describe('isStragglerDuplicate', () => {
  it('treats exact / near-exact repeats as stragglers', () => {
    expect(isStragglerDuplicate('what is a closure', 'what is a closure')).toBe(true)
    expect(isStragglerDuplicate('what is a closure', 'what is a closure exactly')).toBe(true)
  })
  it('does NOT collapse genuine rephrases or "+ more" follow-ups', () => {
    expect(isStragglerDuplicate('tell me about hashmaps', 'tell me about hashmaps and their time complexity')).toBe(false)
    expect(isStragglerDuplicate('what is a closure', 'what is a promise')).toBe(false)
  })
})
