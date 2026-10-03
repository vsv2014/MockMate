import { afterEach, describe, expect, it, vi } from 'vitest'
import { archProductIntelligenceSnapshot, archRuntimeSummary, executeWithFallback, performanceSnapshot, reasoningPolicy, recordArchMetric, recordArchProductEvent, resetArchCircuits, resetArchPerformance, resetArchProductIntelligence, resolveCapabilities } from './arch.js'

const KEYS = ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'GROQ_API_KEY', 'CEREBRAS_API_KEY', 'LLM_API_KEY', 'DEEPGRAM_API_KEY', 'MONGO_URI']
const original = Object.fromEntries(KEYS.map(key => [key, process.env[key]]))
afterEach(() => { resetArchCircuits(); resetArchPerformance(); resetArchProductIntelligence(); vi.restoreAllMocks(); for (const key of KEYS) { if (original[key] == null) delete process.env[key]; else process.env[key] = original[key] } })

describe('ARCH capability resolver', () => {
  it('declares typed-input/client-local fallbacks without inventing client capabilities', () => {
    for (const key of KEYS) delete process.env[key]
    const result = resolveCapabilities({ hosted: false })
    expect(result.ablVersion).toBe('0.2')
    expect(result.capabilities.reasoning.mode).toBe('unavailable')
    expect(result.capabilities.speech.stt.live.fallback).toBe('typed-input')
    expect(result.capabilities.speech.stt.batch.fallback).toBe('typed-input')
    expect(result.capabilities.speech.tts).toMatchObject({ available: null, mode: 'client' })
    expect(result.capabilities.knowledge).toMatchObject({ available: false, mode: 'client-local' })
    expect(result.capabilities.persistence).toMatchObject({ available: false, mode: 'client-local' })
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
  it('uses executable ABL lanes without adding a second retry owner', () => {
    expect(reasoningPolicy('hint')).toEqual({ lane: 'fast', executionAdapter: 'existing-resilient-core-adapter', noDoubleRetry: true })
    expect(reasoningPolicy('interview').lane).toBe('balanced')
    expect(reasoningPolicy('evaluate').lane).toBe('strong')
    expect(reasoningPolicy('screen').lane).toBe('vision')
  })

  it('closes the loop by promoting balanced operations to the fast lane when ARCH p95 TTFT breaches the ABL threshold', () => {
    for (const ms of [3400, 3600, 3900]) recordArchMetric('llm_ttft_ms', ms)
    const adaptive = reasoningPolicy('interview', { adaptive: true })
    expect(adaptive.baseLane).toBe('balanced')
    expect(adaptive.lane).toBe('fast')
    expect(adaptive.adaptivePromotion).toBe('high_latency_guardrail')

    // Strong/vision lanes remain preserved for deep evaluation and screen analysis
    expect(reasoningPolicy('evaluate', { adaptive: true }).lane).toBe('strong')
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
    expect(execute).toHaveBeenCalledTimes(1)
    expect(execute.mock.calls[0][0]).toBe('secondary')
    expect(execute.mock.calls[0][1]).toBe(0)
    expect(execute.mock.calls[0][2]).toBeInstanceOf(AbortSignal)
    expect(second.failures[0]).toMatchObject({ provider: 'primary', reason: 'circuit-open' })
  })

  it('does not retry or open a global circuit for request-specific 400s when classifiers reject them', async () => {
    const execute = vi.fn(async provider => {
      if (provider === 'primary') { const error = new Error('bad input'); error.status = 400; throw error }
      return 'secondary-ok'
    })
    const opts = {
      capability: 'transcription', providers: ['primary', 'secondary'], retries: 1, execute,
      shouldRetry: error => Number(error.status) >= 500,
      shouldOpenCircuit: error => Number(error.status) >= 500,
    }
    const first = await executeWithFallback(opts)
    expect(first.provider).toBe('secondary')
    execute.mockClear()
    const second = await executeWithFallback(opts)
    expect(execute.mock.calls[0][0]).toBe('primary')
    expect(second.provider).toBe('secondary')
  })
})

describe('ARCH performance telemetry', () => {
  it('reports bounded p50/p95 stage metrics Locally and omits process-global performance on hosted mode', () => {
    for (const value of [100, 120, 140, 500]) recordArchMetric('stt_final_ms', value)
    expect(performanceSnapshot().stt_final_ms).toEqual({ count: 4, p50: 120, p95: 500 })
    const summary = archRuntimeSummary({ hosted: false })
    expect(summary.routing.hint).toBe('fast')
    expect(summary.performance.stt_final_ms).toEqual({ count: 4, p50: 120, p95: 500 })

    const hostedSummary = archRuntimeSummary({ hosted: true })
    expect(hostedSummary.performance).toBeUndefined()
  })

  it('tracks redacted Product Intelligence events inside ARCH without leaking PII or secrets', () => {
    recordArchProductEvent({
      sessionId: 's1',
      ts: 1000,
      action: 'live_setup',
      resume: 'Staff Engineer at SecretCorp',
      apiKey: 'sk-secret-key-9999999999',
    })
    recordArchProductEvent({ sessionId: 's1', ts: 2000, action: 'preflight_failed', reason: 'share_unverified' })
    const snap = archProductIntelligenceSnapshot()
    expect(snap.totalEvents).toBe(2)
    expect(snap.policy.mode).toBe('structured_redacted')
    expect(snap.headlineInsights[0].text).toMatch(/100% of Live setup attempts stall or fail at Live preflight/i)
    expect(JSON.stringify(snap)).not.toMatch(/SecretCorp|sk-secret/i)
  })
})
