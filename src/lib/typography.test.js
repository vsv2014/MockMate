import { describe, expect, it } from 'vitest'
import { readableTextSize } from './typography.js'
describe('readable desktop typography', () => {
  it.each([[8,20],[10,20],[11,22],[12,24],[14,28],[16,32],[20,32],[24,32],[36,36]])('maps old %spx to %spx', (old, size) => expect(readableTextSize(old)).toBe(size))
  it('provides a readable fallback for invalid styles', () => expect(readableTextSize(NaN)).toBe(26))
})
