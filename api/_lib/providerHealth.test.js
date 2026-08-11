import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  shouldFailoverTextError,
  isProviderHardFail,
  isLoopbackAddress,
  getFallbackProviders,
  _resetProviderHealthForTests,
  _getProviderHealthForTests,
  _setProviderHealthForTests,
} from './core.js'
import { markVision429Family, isVisionCooling, _resetVisionStateForTests } from './visionPolicy.js'

describe('unified text failover policy', () => {
  it('hard-fails 400/401/403/404 before emit (same as completeJSON)', () => {
    for (const status of [400, 401, 403, 404]) {
      expect(isProviderHardFail({ status })).toBe(true)
      expect(shouldFailoverTextError({ status }, { emitted: false })).toBe(true)
    }
  })

  it('does not failover after tokens were already streamed', () => {
    expect(shouldFailoverTextError({ status: 401 }, { emitted: true })).toBe(false)
    expect(shouldFailoverTextError({ status: 429 }, { emitted: true })).toBe(false)
  })

  it('fails over on rate / transient / quota before emit', () => {
    expect(shouldFailoverTextError({ status: 429 }, { emitted: false })).toBe(true)
    expect(shouldFailoverTextError({ status: 503 }, { emitted: false })).toBe(true)
    expect(shouldFailoverTextError({ status: 402, code: 'insufficient_quota', message: 'insufficient_quota' }, { emitted: false })).toBe(true)
  })
})

describe('text vs vision provider health', () => {
  const prevGemini = process.env.GEMINI_API_KEY
  const prevOpenAI = process.env.OPENAI_API_KEY

  beforeEach(() => {
    _resetProviderHealthForTests()
    _resetVisionStateForTests()
    process.env.GEMINI_API_KEY = 'test-gemini'
    process.env.OPENAI_API_KEY = 'test-openai'
  })

  afterEach(() => {
    _resetProviderHealthForTests()
    _resetVisionStateForTests()
    if (prevGemini === undefined) delete process.env.GEMINI_API_KEY
    else process.env.GEMINI_API_KEY = prevGemini
    if (prevOpenAI === undefined) delete process.env.OPENAI_API_KEY
    else process.env.OPENAI_API_KEY = prevOpenAI
  })

  it('vision last-working does not reorder text fallbacks', () => {
    _setProviderHealthForTests({ vision: 'gemini_flash_lite', text: null })
    const q = getFallbackProviders('openai')
    expect(q[0]).toBe('openai')
    // Text lane still follows its own preference, not the vision slot.
    expect(_getProviderHealthForTests().lastWorkingVisionProvider).toBe('gemini_flash_lite')
    expect(_getProviderHealthForTests().lastWorkingTextProvider).toBeNull()
  })

  it('text last-working reorders only text fallbacks', () => {
    _setProviderHealthForTests({ text: 'gemini', vision: null })
    const q = getFallbackProviders('openai')
    expect(q[0]).toBe('openai')
    expect(q[1]).toBe('gemini')
  })

  it('vision cooldown does not write text bans', () => {
    markVision429Family('openai')
    expect(isVisionCooling('openai')).toBe(true)
    expect(isVisionCooling('openai_mini')).toBe(true)
    expect(_getProviderHealthForTests().textBannedUntil.openai).toBeUndefined()
    expect(_getProviderHealthForTests().textBannedUntil.openai_mini).toBeUndefined()
    // Text queue still offers openai when only vision cooled.
    const q = getFallbackProviders('openai')
    expect(q).toContain('openai')
  })

  it('text ban excludes provider from text queue only', () => {
    _setProviderHealthForTests({ banText: { openai: Date.now() + 60_000 } })
    const q = getFallbackProviders('openai')
    expect(q).not.toContain('openai')
    expect(q.length).toBeGreaterThan(0)
  })
})

describe('isLoopbackAddress', () => {
  it('accepts IPv4, IPv6, and IPv4-mapped forms', () => {
    expect(isLoopbackAddress('127.0.0.1')).toBe(true)
    expect(isLoopbackAddress('::1')).toBe(true)
    expect(isLoopbackAddress('::ffff:127.0.0.1')).toBe(true)
    expect(isLoopbackAddress('localhost')).toBe(true)
    expect(isLoopbackAddress('192.168.1.10')).toBe(false)
    expect(isLoopbackAddress('10.0.0.2')).toBe(false)
  })
})
