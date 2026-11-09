import { describe, expect, it } from 'vitest'
import { createCandidateMicGate } from './dualChannelCapture.js'

describe('opt-in dual-channel candidate source', () => {
  it('never sends microphone text into the interviewer or candidate path when main capture is mic', () => {
    const gate = createCandidateMicGate()
    expect(gate({ text: 'Explain RAG', sourceId: 'microphone' })).toBeNull()
    expect(gate({ text: 'Explain RAG', sourceId: '' })).toBeNull()
    expect(gate({ text: 'Explain RAG', sourceId: 'screen:0', sessionActive: false })).toBeNull()
    expect(gate({ text: 'Hi', sourceId: 'screen:0' })).toBeNull()
  })
  it('keeps genuine candidate speech but deduplicates close repeated STT finals', () => {
    let t = 10000
    const gate = createCandidateMicGate({ now: () => t, duplicateWindowMs: 2500 })
    const args = { text: 'I used React', sourceId: 'screen:0' }
    expect(gate(args)).toBe('I used React')
    t += 1000
    expect(gate({ ...args, text: ' I  used React  ' })).toBeNull()
    t += 3000
    expect(gate(args)).toBe('I used React')
    expect(gate({ text: 'I used TypeScript', sourceId: 'screen:0' })).toBe('I used TypeScript')
  })
})
