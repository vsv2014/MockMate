import { describe, it, expect } from 'vitest'
import { analyze, countWords, BANNED_WORDS, JARGON } from './delivery.js'

describe('countWords', () => {
  it('counts words, ignores empty', () => {
    expect(countWords('hello there world')).toBe(3)
    expect(countWords('')).toBe(0)
    expect(countWords('   ')).toBe(0)
  })
})

describe('analyze', () => {
  it('detects fillers, jargon, and hedges', () => {
    const a = analyze('um so basically i think we leverage synergy, you know', null)
    expect(a.fillers.count).toBeGreaterThan(0)   // um / you know / basically
    expect(a.jargon.count).toBeGreaterThan(0)    // leverage / synergy
    expect(a.hedges.count).toBeGreaterThan(0)    // i think
  })
  it('computes wpm only with a real duration', () => {
    expect(analyze('one two three four five six', null).wpm).toBeNull()
    expect(analyze('one two three four five six', 6000).wpm).toBeGreaterThan(0)
  })
  it('clean answer has zero fillers/jargon', () => {
    const a = analyze('I designed the indexing layer and cut query time in half.', null)
    expect(a.fillers.count).toBe(0)
    expect(a.jargon.count).toBe(0)
  })
})

describe('BANNED_WORDS', () => {
  it('is the JARGON list joined (single source for coach + AI prompts)', () => {
    expect(BANNED_WORDS).toContain('leverage')
    expect(BANNED_WORDS.split(', ').length).toBe(JARGON.length)
  })
})
