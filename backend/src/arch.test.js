import { afterEach, describe, expect, it, vi } from 'vitest'
import { executeWithFallback, resetArchCircuits, resolveCapabilities } from './arch.js'

const KEYS = ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'GROQ_API_KEY', 'CEREBRAS_API_KEY', 'LLM_API_KEY', 'DEEPGRAM_API_KEY', 'MONGO_URI']
const original = Object.fromEntries(KEYS.map(key => [key, process.env[key]]))

afterEach(() => {
  resetArchCircuits()
  vi.restoreAllMocks()
  for (const key of KEYS) {
    if (original[key] == null) delete process.env[key]
    else process.env[key] = original[key]
  }
})

describe('ARCH capability resolver', () => {
  it('falls back to local storage and typed input without paid services', () => {
    for (const key of KEYS) delete process.env[key]
    const result = resolveCapabilities({ hosted: false })
    expect(result.capabilities.reasoning.mode).toBe('unavailable')
    expect(result.capabilities.transcription.fallback).toBe('typed-input')
    expect(result.capabilities.knowledge.mode).toBe('local')
    expect(result.capabilities.persistence.mode).toBe('local')
  })

  it('uses configured private-beta credentials without exposing secret values', () => {
    process.env.GROQ_API_KEY = 'secret-groq-value'
    process.env.DEEPGRAM_API_KEY = 'secret-deepgram-value'
    process.env.MONGO_URI = 'mongodb://secret-host/mockmate'
    const serialized = JSON.stringify(resolveCapabilities({ hosted: false }))
    expect(serialized).not.toContain('secret-groq-value')
    expect(serialized).not.toContain('secret-deepgram-value')
    expect(serialized).not.toContain('secret-host')
    const result = JSON.parse(serialized)
    expect(result.capabilities.reasoning).toMatchObject({ available: true, mode: 'byok', provider: 'groq' })
    expect(result.capabilities.transcription).toMatchObject({ available: true, mode: 'byok', provider: 'deepgram' })
    expect(result.capabilities.persistence.mode).toBe('managed')
  })

  it('marks platform-owned hosted credentials as managed', () => {
    process.env.OPENAI_API_KEY = 'platform-openai'
    process.env.DEEPGRAM_API_KEY = 'platform-deepgram'
    const result = resolveCapabilities({ hosted: true })
    expect(result.capabilities.reasoning.mode).toBe('managed')
    expect(result.capabilities.transcription.mode).toBe('managed')
  })
})

describe('ARCH runtime fallback', () => {
  it('retries the preferred provider then switches providers without losing the request', async () => {
    const calls = []
    const result = await executeWithFallback({
      capability: 'reasoning', providers: ['primary', 'secondary'], retries: 1, timeoutMs: 100,
      execute: async (provider, attempt) => {
        calls.push(`${provider}:${attempt}`)
        if (provider === 'primary') throw new Error('provider-down')
        return 'answer'
      },
    })
    expect(result).toMatchObject({ ok: true, degraded: true, provider: 'secondary', result: 'answer' })
    expect(calls).toEqual(['primary:0', 'primary:1', 'secondary:0'])
  })

  it('uses degraded fallback after all providers fail', async () => {
    const result = await executeWithFallback({
      capability: 'transcription', providers: ['deepgram'], retries: 0,
      execute: async () => { throw new Error('offline') },
      fallback: async failures => ({ typedInputRequired: true, failures: failures.length }),
    })
    expect(result.ok).toBe(true)
    expect(result.fallback).toBe(true)
    expect(result.result).toEqual({ typedInputRequired: true, failures: 1 })
  })

  it('opens a short circuit after provider failure so repeated requests fail over immediately', async () => {
    const execute = vi.fn(async provider => {
      if (provider === 'primary') throw new Error('down')
      return 'ok'
    })
    await executeWithFallback({ capability: 'reasoning', providers: ['primary', 'secondary'], retries: 0, execute, cooldownMs: 60_000 })
    execute.mockClear()
    const second = await executeWithFallback({ capability: 'reasoning', providers: ['primary', 'secondary'], retries: 0, execute, cooldownMs: 60_000 })
    expect(execute).toHaveBeenCalledTimes(1)
    expect(execute).toHaveBeenCalledWith('secondary', 0)
    expect(second.failures[0]).toMatchObject({ provider: 'primary', reason: 'circuit-open' })
  })
})
