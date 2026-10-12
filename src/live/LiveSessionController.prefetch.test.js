import { describe, it, expect, vi } from 'vitest'
import { createLiveSessionController } from './LiveSessionController.js'
import { streamLiveHint, fetchLiveHintFallback } from './hintTransport.js'

vi.mock('./hintTransport.js', () => ({
  streamLiveHint: vi.fn(async () => ({ mode: 'stream' })),
  fetchLiveHintFallback: vi.fn(async () => ({ hint: { fullAnswer: 'Fallback answer' } })),
}))

describe('createLiveSessionController early response', () => {
  it('passes an already-started response to the stream transport but never to the JSON fallback', async () => {
    const prefetched = Promise.resolve({ ok: true })
    let handedOut = prefetched
    const ctrl = createLiveSessionController({
      isCurrent: () => true,
      getSignal: () => undefined,
      getHintBody: () => ({ question: 'Q?' }),
      getPrefetchedResponse: () => { const r = handedOut; handedOut = null; return r },
      onStreamEvent: vi.fn(),
      onFallbackHint: vi.fn(),
    })
    await ctrl.generateViaTransport()
    expect(streamLiveHint).toHaveBeenCalledWith(expect.objectContaining({ response: prefetched, body: { question: 'Q?' } }))
    await ctrl.runFallback()
    expect(fetchLiveHintFallback).toHaveBeenCalledWith(expect.not.objectContaining({ response: expect.anything() }))
  })

  it('sends a normal request when there is no early response', async () => {
    streamLiveHint.mockClear()
    const ctrl = createLiveSessionController({
      isCurrent: () => true, getSignal: () => undefined, getHintBody: () => ({ question: 'Q?' }),
      onStreamEvent: vi.fn(), onFallbackHint: vi.fn(),
    })
    await ctrl.generateViaTransport()
    expect(streamLiveHint).toHaveBeenCalledWith(expect.objectContaining({ response: null }))
  })
})
