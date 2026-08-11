import { describe, it, expect } from 'vitest'
import { chunkText, topK, groundingBlock, cosineSim } from './retrieval.js'

describe('chunkText', () => {
  it('returns empty for blank', () => {
    expect(chunkText('')).toEqual([])
  })
  it('keeps short text as one chunk', () => {
    expect(chunkText('Hello world')).toEqual(['Hello world'])
  })
  it('splits long text near size with overlap', () => {
    const text = Array.from({ length: 40 }, (_, i) => `Sentence number ${i}.`).join(' ')
    const chunks = chunkText(text, { size: 80, overlap: 20 })
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.every(c => c.length > 0)).toBe(true)
  })
})

describe('cosineSim / topK', () => {
  it('ranks identical vector highest', () => {
    const q = [1, 0, 0]
    const items = [
      { text: 'a', vector: [0, 1, 0] },
      { text: 'b', vector: [1, 0, 0], doc: 'Resume', type: 'resume' },
    ]
    expect(cosineSim(q, q)).toBeCloseTo(1)
    const hits = topK(q, items, { k: 1, minScore: 0.5 })
    expect(hits).toHaveLength(1)
    expect(hits[0].text).toBe('b')
  })
})

describe('groundingBlock', () => {
  it('includes source attribution when present', () => {
    const block = groundingBlock([
      { text: 'Built Kafka pipelines', doc: 'Resume.pdf', type: 'resume' },
    ])
    expect(block).toMatch(/RELEVANT FROM YOUR DOCUMENTS/)
    expect(block).toMatch(/Resume\.pdf/)
    expect(block).toMatch(/resume/)
    expect(block).toMatch(/Built Kafka/)
  })
  it('returns empty for no chunks', () => {
    expect(groundingBlock([])).toBe('')
  })
})
