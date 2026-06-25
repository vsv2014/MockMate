import { describe, it, expect } from 'vitest'
import { scoreColor, fmtClock } from './ui.js'

describe('scoreColor', () => {
  it('uses one consistent 75/50 scale', () => {
    expect(scoreColor(90)).toBe('#22c55e')   // strong
    expect(scoreColor(75)).toBe('#22c55e')   // boundary → strong
    expect(scoreColor(60)).toBe('#fbbf24')   // mixed
    expect(scoreColor(50)).toBe('#fbbf24')   // boundary → mixed
    expect(scoreColor(20)).toBe('#f87171')   // weak
  })
  it('returns a neutral color for null', () => expect(scoreColor(null)).toBe('#64748b'))
})

describe('fmtClock', () => {
  it('formats ms as m:ss', () => {
    expect(fmtClock(0)).toBe('0:00')
    expect(fmtClock(65000)).toBe('1:05')
    expect(fmtClock(600000)).toBe('10:00')
  })
  it('clamps negatives/garbage to 0:00', () => {
    expect(fmtClock(-5)).toBe('0:00')
    expect(fmtClock(null)).toBe('0:00')
  })
})
