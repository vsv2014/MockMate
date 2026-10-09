import { describe, it, expect, vi } from 'vitest'
import { watchAudioTrackEnded, shouldRecoverEndedTrack } from './audioTrackRecovery.js'

function fakeTrack() {
  const listeners = new Map()
  return {
    readyState: 'live',
    addEventListener: vi.fn((name, fn) => listeners.set(name, fn)),
    removeEventListener: vi.fn((name, fn) => {
      if (listeners.get(name) === fn) listeners.delete(name)
    }),
    end() {
      this.readyState = 'ended'
      listeners.get('ended')?.()
    },
    triggerWithoutEnding() { listeners.get('ended')?.() },
  }
}

describe('audio track end recovery', () => {
  it('observes lost audio capture even without devicechange and fires once', () => {
    const track = fakeTrack()
    const cb = vi.fn()
    const off = watchAudioTrackEnded({ getAudioTracks: () => [track] }, cb)
    track.triggerWithoutEnding()
    expect(cb).not.toHaveBeenCalled()
    track.end()
    track.end()
    expect(cb).toHaveBeenCalledTimes(1)
    off()
    expect(track.removeEventListener).toHaveBeenCalledTimes(1)
  })

  it('disposes all listeners and never resurrects stopped capture', () => {
    const a = fakeTrack(), b = fakeTrack()
    const cb = vi.fn()
    const off = watchAudioTrackEnded({ getAudioTracks: () => [a,b] }, cb)
    off()
    a.end()
    b.end()
    expect(cb).not.toHaveBeenCalled()
  })

  it('only recovers the currently owned stream while capture is running', () => {
    const old = { id: 'old' }, current = { id: 'current' }
    expect(shouldRecoverEndedTrack({ expectedStream: old, activeStream: current })).toBe(false)
    expect(shouldRecoverEndedTrack({ expectedStream: current, activeStream: current, stopped: true })).toBe(false)
    expect(shouldRecoverEndedTrack({ expectedStream: current, activeStream: current, suspended: true })).toBe(false)
    expect(shouldRecoverEndedTrack({ expectedStream: current, activeStream: current })).toBe(true)
  })
})
