import { describe, expect, it } from 'vitest'
import { readableTextSize, workspaceTextSize } from './typography.js'
describe('readable desktop typography', () => {
  it.each([[8,20],[10,20],[11,22],[12,24],[14,28],[16,32],[20,32],[24,32],[36,36]])('maps old %spx to %spx', (old, size) => expect(readableTextSize(old)).toBe(size))
  it('provides a readable fallback for invalid styles', () => expect(readableTextSize(NaN)).toBe(26))
})

describe('management workspace typography (separate from Live)', () => {
  it.each([[8,13],[10,13],[11,14],[12,14],[13,16],[15,18],[20,22],[27,27]])('sizes %spx as %spx without overflowing shell controls', (input, expected) => {
    expect(workspaceTextSize(input)).toBe(expected)
  })
  it('preserves the separate Live scale', () => {
    expect(readableTextSize(13)).toBe(26)
    expect(workspaceTextSize(13)).toBe(16)
  })
})
