import { describe, it, expect, vi } from 'vitest'
import { createLiveSessionController } from './LiveSessionController.js'

vi.mock('./hintTransport.js', () => ({
  streamLiveHint: vi.fn(async ({ onFallback }) => {
    await onFallback?.()
    return { mode: 'fallback' }
  }),
  fetchLiveHintFallback: vi.fn(async () => ({ hint: { fullAnswer: 'Fallback answer', skip: false } })),
}))

describe('createLiveSessionController', () => {
  it('runs fallback hint path when stream falls back', async () => {
    const onFallbackHint = vi.fn()
    const ctrl = createLiveSessionController({
      isCurrent: () => true,
      getSignal: () => undefined,
      getHintBody: () => ({ question: 'Q?' }),
      onStreamEvent: vi.fn(),
      onFallbackHint,
      onMarkFallback: vi.fn(),
    })
    await ctrl.generateViaTransport()
    expect(onFallbackHint).toHaveBeenCalledWith(expect.objectContaining({ fullAnswer: 'Fallback answer' }))
  })
})
