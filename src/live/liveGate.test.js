import { describe, it, expect } from 'vitest'
import { computeLiveCanStart, resolveAnswerNowCandidate } from './liveGate.js'

describe('computeLiveCanStart (Live preflight safety gate)', () => {
  it('blocks browser mode in production even when Deepgram and LLM are ready', () => {
    expect(computeLiveCanStart({
      dgAvailable: true,
      noLLM: false,
      inElectron: false,
      isLinux: false,
      protectionStatus: 'passed',
      shareVerified: true,
      isDevLocal: false,
    })).toBe(false)
  })

  it('requires OS capture protection + shareVerified in Windows/macOS Electron production builds', () => {
    expect(computeLiveCanStart({
      dgAvailable: true,
      noLLM: false,
      inElectron: true,
      isLinux: false,
      protectionStatus: 'passed',
      shareVerified: false,
      isDevLocal: false,
    })).toBe(false)

    expect(computeLiveCanStart({
      dgAvailable: true,
      noLLM: false,
      inElectron: true,
      isLinux: false,
      protectionStatus: 'passed',
      shareVerified: true,
      isDevLocal: false,
    })).toBe(true)
  })

  it('requires linuxAck on Linux Electron builds', () => {
    expect(computeLiveCanStart({
      dgAvailable: true,
      noLLM: false,
      inElectron: true,
      isLinux: true,
      linuxAck: false,
      isDevLocal: false,
    })).toBe(false)

    expect(computeLiveCanStart({
      dgAvailable: true,
      noLLM: false,
      inElectron: true,
      isLinux: true,
      linuxAck: true,
      isDevLocal: false,
    })).toBe(true)
  })

  it('allows local dev testing only when isDevLocal is true and Deepgram + LLM are configured', () => {
    expect(computeLiveCanStart({
      dgAvailable: true,
      noLLM: false,
      inElectron: false,
      isDevLocal: true,
    })).toBe(true)

    expect(computeLiveCanStart({
      dgAvailable: false,
      noLLM: false,
      inElectron: false,
      isDevLocal: true,
    })).toBe(false)
  })
})

describe('resolveAnswerNowCandidate (Alt+R current question resolution)', () => {
  it('prioritizes in-progress liveCaptureText over previous lastHintText', () => {
    expect(resolveAnswerNowCandidate({
      liveCaptureText: 'How would you shard PostgreSQL?',
      manualQ: '',
      pendingManualText: '',
      lastHintText: 'Tell me about yourself',
    })).toBe('How would you shard PostgreSQL?')
  })

  it('falls back through manualQ, pendingManualText, then lastHintText', () => {
    expect(resolveAnswerNowCandidate({
      liveCaptureText: '',
      manualQ: 'Explain Redis consumer groups',
      pendingManualText: 'Older pending',
      lastHintText: 'Oldest committed',
    })).toBe('Explain Redis consumer groups')

    expect(resolveAnswerNowCandidate({
      liveCaptureText: '',
      manualQ: '',
      pendingManualText: '',
      lastHintText: 'Oldest committed',
    })).toBe('Oldest committed')
  })
})
