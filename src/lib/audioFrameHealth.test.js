import { describe, expect, it } from 'vitest'
import { AUDIO_FRAME_STALL_MS, isAudioFrameStalled } from './audioFrameHealth.js'

const base = { activeSocket: true, contextState: 'running',
  stopped: false, suspended: false, lastFrameAt: 1_000 }

describe('PCM audio continuity watchdog', () => {
  it('reports missing audio frames only when capture graph is running with an open socket', () => {
    expect(isAudioFrameStalled({ ...base, now: 1_000 + AUDIO_FRAME_STALL_MS - 1 })).toBe(false)
    expect(isAudioFrameStalled({ ...base, now: 1_000 + AUDIO_FRAME_STALL_MS })).toBe(true)
    expect(isAudioFrameStalled({ ...base, now: 1_000 + 300_000, activeSocket: false })).toBe(false)
    expect(isAudioFrameStalled({ ...base, now: 1_000 + 300_000, suspended: true })).toBe(false)
    expect(isAudioFrameStalled({ ...base, now: 1_000 + 300_000, stopped: true })).toBe(false)
    expect(isAudioFrameStalled({ ...base, now: 1_000 + 300_000, contextState: 'suspended' })).toBe(false)
  })

  it('does not mistake transcript silence for a failed capture graph while PCM frames flow', () => {
    expect(isAudioFrameStalled({ ...base, now: 250_000, lastFrameAt: 249_950 })).toBe(false)
    expect(isAudioFrameStalled({ ...base, now: 250_000, lastFrameAt: 0 })).toBe(false)
  })
})
