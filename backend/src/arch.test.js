import { afterEach, describe, expect, it, vi } from 'vitest'
import { executeWithFallback, performanceSnapshot, reasoningPolicy, recordArchMetric, resetArchCircuits, resetArchPerformance, resolveCapabilities } from './arch.js'

const KEYS = ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'GROQ_API_KEY', 'CEREBRAS_API_KEY', 'LLM_API_KEY', 'DEEPGRAM_API_KEY', 'MONGO_URI']
const original = Object.fromEntries(KEYS.map(key => [key, process.env[key]]))
afterEach(() => { resetArchCircuits(); resetArchPerformance(); vi.restoreAllMocks(); for (const key of KEYS) { if (original[key] == null) delete process.env[key]; else process.env[key] = original[key] } })

describe('ARCH capability resolver', () => {
  it('falls back to local storage and typed input without paid services', () => {
    for (const key of KEYS) delete process.env[key]
    const result = resolveCapabilities({ hosted: false })
    expect(result.ablVersion).toBe('0.2')
    expect(result.capabilities.reasoning.mode).toBe('unavailable')
    expect(result.capabilities.speech.stt.live.fallback).toBe('typed-input')
    expect(result.capabilities.speech.stt.batch.fallback).toBe('typed-input')
    expect(result.capabilities.speech.tts.mode).toBe('browser')
    expect(result.capabilities.knowledge.mode).toBe('local')
    expect(result.capabilities.persistence.mode).toBe('local')
  })
  it('separates streaming and batch STT without exposing secrets', () => {
    process.env.GROQ_API_KEY = 'secret-groq-value'; process.env.DEEPGRAM_API_KEY = 'secret-deepgram-value'; process.env.MONGO_URI = 'mongodb://secret-host/mockmate'
    const serialized = JSON.stringify(resolveCapabilities({ hosted: false }))
    expect(serialized).not.toContain('secret-groq-value'); expect(serialized).not.toContain('secret-deepgram-value'); expect(serialized).not.toContain('secret-host')
    const result = JSON.parse(serialized)
    expect(result.capabilities.speech.stt.live).toMatchObject({ available: true, transport: 'stream', provider: 'deepgram' })
    expect(result.capabilities.speech.stt.batch).toMatchObject({ available: true, transport: 'upload', provider: 'deepgram' })
  })
})

describe('ARCH reasoning policy', () => {
  it('maps latency-sensitive and quality-sensitive work to explicit lanes without double retries', () => {
    expect(reasoningPolicy('hint')).toEqual({ lane: 'fast', executionAdapter: 'core', noDoubleRetry: true })
    expect(reasoningPolicy('interview').lane).toBe('balanced')
    expect(reasoningPolicy('evaluate').lane).toBe('strong')
    expect(reasoningPolicy('screen').lane).toBe('vision')
  })
})

describe('ARCH runtime fallback', () => {
  it('retries preferred provider then switches providers', async () => {
    const calls = []
    const result = await executeWithFallback({ capability: 'transcription', providers: ['primary', 'secondary'], retries: 1, timeoutMs: 100, execute: async (provider, attempt) => { calls.push(`${provider}:${attempt}`); if (provider === 'primary') throw new Error('provider-down'); return 'answer' } })
    expect(result).toMatchObject({ ok: true, degraded: true, provider: 'secondary', result: 'answer' }); expect(calls).toEqual(['primary:0', 'primary:1', 'secondary:0'])
  })
  it('uses degraded fallback after all providers fail', async () => {
    const result = await executeWithFallback({ capability: 'transcription', providers: ['deepgram'], retries: 0, execute: async () => { throw new Error('offline') }, fallback: async failures => ({ typedInputRequired: true, failures: failures.length }) })
    expect(result.ok).toBe(true); expect(result.fallback).toBe(true); expect(result.result).toEqual({ typedInputRequired: true, failures: 1 })
  })
  it('opens a short circuit so repeated requests fail over immediately', async () => {
    const execute = vi.fn(async provider => { if (provider === 'primary') throw new Error('down'); return 'ok' })
    await executeWithFallback({ capability: 'transcription', providers: ['primary', 'secondary'], retries: 0, execute, cooldownMs: 60_000 }); execute.mockClear()
    const second = await executeWithFallback({ capability: 'transcription', providers: ['primary', 'secondary'], retries: 0, execute, cooldownMs: 60_000 })
    expect(execute).toHaveBeenCalledTimes(1); expect(execute).toHaveBeenCalledWith('secondary', 0); expect(second.failures[0]).toMatchObject({ provider: 'primary', reason: 'circuit-open' })
  })
})

describe('ARCH performance telemetry', () => {
  it('reports bounded p50/p95 stage metrics', () => {
    for (const value of [100, 120, 140, 500]) recordArchMetric('stt_final_ms', value)
    expect(performanceSnapshot().stt_final_ms).toEqual({ count: 4, p50: 120, p95: 500 })
  })
})
