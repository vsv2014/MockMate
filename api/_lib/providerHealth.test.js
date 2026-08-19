import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  shouldFailoverTextError,
  isProviderHardFail,
  isLoopbackAddress,
  getFallbackProviders,
  pickFastProvider,
  pickStrongProvider,
  pickBestProvider,
  resolveEmbeddingProvider,
  _resetProviderHealthForTests,
  _getProviderHealthForTests,
  _setProviderHealthForTests,
  _setDiscoveredModelsForTests,
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
  const prevAnthropic = process.env.ANTHROPIC_API_KEY
  const prevEmbedModel = process.env.EMBED_MODEL

  beforeEach(() => {
    _resetProviderHealthForTests()
    _resetVisionStateForTests()
    process.env.GEMINI_API_KEY = 'test-gemini'
    process.env.OPENAI_API_KEY = 'test-openai'
    process.env.ANTHROPIC_API_KEY = 'test-anthropic'
    delete process.env.EMBED_MODEL
  })

  afterEach(() => {
    _resetProviderHealthForTests()
    _resetVisionStateForTests()
    if (prevGemini === undefined) delete process.env.GEMINI_API_KEY
    else process.env.GEMINI_API_KEY = prevGemini
    if (prevOpenAI === undefined) delete process.env.OPENAI_API_KEY
    else process.env.OPENAI_API_KEY = prevOpenAI
    if (prevAnthropic === undefined) delete process.env.ANTHROPIC_API_KEY
    else process.env.ANTHROPIC_API_KEY = prevAnthropic
    if (prevEmbedModel === undefined) delete process.env.EMBED_MODEL
    else process.env.EMBED_MODEL = prevEmbedModel
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

  it('uses the QA-verified Gemini Flash-Lite model for automatic fast answers', () => {
    expect(pickFastProvider()).toBe('gemini_flash_lite')
  })

  it('routes maximum quality only to a model confirmed by the configured key', () => {
    _setDiscoveredModelsForTests('claude_sonnet', ['claude-fable-5', 'claude-sonnet-5'])
    _setDiscoveredModelsForTests('openai', ['gpt-5.6-sol', 'gpt-5.6-luna'])
    expect(pickBestProvider()).toBe('claude_sonnet::claude-fable-5')
    expect(pickStrongProvider()).toBe('openai')
  })

  it('uses a discovered balanced OpenAI model for hard questions', () => {
    _setDiscoveredModelsForTests('openai', ['gpt-5.6-terra', 'gpt-5.6-sol'])
    expect(pickStrongProvider()).toBe('openai::gpt-5.6-terra')
  })

  it('offers only one automatic fallback per configured API-key family', () => {
    const q = getFallbackProviders('auto')
    expect(q.filter(id => id.startsWith('gemini'))).toEqual(['gemini_flash_lite'])
    expect(q.filter(id => id.startsWith('claude'))).toEqual(['claude_haiku'])
    expect(q.filter(id => id.startsWith('openai') || id === 'gpt_5')).toEqual(['openai_mini'])
  })

  it('uses a supported Gemini embedding model instead of retired text-embedding-004', () => {
    delete process.env.OPENAI_API_KEY
    const p = resolveEmbeddingProvider()
    expect(p.model).toBe('gemini-embedding-001')
    expect(p.model).not.toBe('text-embedding-004')
  })

  it('honours an explicit embedding-model override', () => {
    delete process.env.OPENAI_API_KEY
    process.env.EMBED_MODEL = 'gemini-embedding-2'
    expect(resolveEmbeddingProvider().model).toBe('gemini-embedding-2')
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
