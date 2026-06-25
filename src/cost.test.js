import { describe, it, expect } from 'vitest'
import { estimateCost } from './cost.js'

describe('estimateCost', () => {
  it('prices known models by $/1M in+out', () => {
    expect(estimateCost('gpt-4o-mini', 1e6, 1e6)).toBeCloseTo(0.15 + 0.6, 5)
    expect(estimateCost('claude-opus-4-8', 1e6, 0)).toBeCloseTo(5, 5)
  })
  it('falls back to a sane default for unknown models', () => {
    expect(estimateCost('some-new-model', 1e6, 1e6)).toBeCloseTo(1 + 3, 5)
  })
  it('is zero for zero tokens', () => expect(estimateCost('gpt-4o', 0, 0)).toBe(0))
})
