import { describe, it, expect } from 'vitest'
import { estimateCost } from './cost.js'

describe('estimateCost', () => {
  it('prices current text models using approximate $/1M input and output tokens', () => {
    expect(estimateCost('gpt-6-luna', 1e6, 1e6)).toBeCloseTo(0.1 + 0.5, 5)
    expect(estimateCost('gpt-6-sol', 1e6, 1e6)).toBeCloseTo(2 + 10, 5)
    expect(estimateCost('gpt-6-astra', 1e6, 1e6)).toBeCloseTo(10 + 50, 5)
    expect(estimateCost('gemini-3.8-flash', 1e6, 1e6)).toBeCloseTo(0.75 + 3.75, 5)
    expect(estimateCost('claude-opus-5', 1e6, 0)).toBeCloseTo(5, 5)
    expect(estimateCost('claude-fable-5', 1e6, 1e6)).toBeCloseTo(60, 5)
  })
  it('falls back to a conservative default for unknown models', () => {
    expect(estimateCost('some-new-model', 1e6, 1e6)).toBeCloseTo(1 + 3, 5)
  })
  it('is zero for zero tokens', () => expect(estimateCost('gpt-6-sol', 0, 0)).toBe(0))
})
