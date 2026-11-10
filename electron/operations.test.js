import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
const require = createRequire(import.meta.url)
const { UsageLedger, ledgerRow, summarizeUsage, summarizeOperations, summarizeModuleActivity,
  filterAccountOperations } = require('./operations.cjs')

describe('privacy-safe operational ledger and execution explorer', () => {
  it('accepts numeric known usage, keeps unavailable distinct from zero and rejects content keys', () => {
    const row = ledgerRow({ component: 'llm', event: 'attempt_succeeded',
      attemptId: 'llm_123', requestId: 'api_123', operation: 'stream',
      provider: 'groq', model: 'example/model', inputTokens: 0, outputTokens: 3,
      prompt: 'my private transcript', apiKey: 'sk-private-value', durationMs: 5 })
    expect(row.inputTokens).toBe(0)
    expect(row.outputTokens).toBe(3)
    expect(JSON.stringify(row)).not.toContain('private')
    expect(ledgerRow({ component: 'llm', event: 'attempt_failed', attemptId: 'bad key with spaces' })).toBeNull()
    expect(ledgerRow({ component: 'llm', event: 'attempt_failed', attemptId: 'llm_123',
      inputTokens: null, outputTokens: null })).toMatchObject({ inputTokens: null, outputTokens: null })
  })

  it('counts every paid JSON retry once, handles stream usage and unknown failure without invented cost', () => {
    const rows = [
      { attemptId: 'json_1', operation: 'json', provider: 'gemini', event: 'attempt_started' },
      { attemptId: 'json_1', operation: 'json', provider: 'gemini', event: 'request_usage',
        requestIndex: 0, inputTokens: 20, outputTokens: 4 },
      { attemptId: 'json_1', operation: 'json', provider: 'gemini', event: 'request_usage',
        requestIndex: 1, inputTokens: 30, outputTokens: 8 },
      { attemptId: 'json_1', operation: 'json', provider: 'gemini', event: 'request_usage',
        requestIndex: 1, inputTokens: 30, outputTokens: 8 },
      { attemptId: 'json_1', operation: 'json', provider: 'gemini', event: 'attempt_succeeded' },
      { attemptId: 'stream_1', operation: 'stream', provider: 'groq', event: 'attempt_succeeded',
        inputTokens: 10, outputTokens: 12 },
      { attemptId: 'stream_2', operation: 'stream', provider: 'groq', event: 'attempt_timed_out',
        inputTokens: null, outputTokens: null },
    ]
    const by = summarizeUsage(rows)
    expect(by.find(r => r.provider === 'gemini')).toMatchObject({
      attempts: 1, measuredRequests: 2, confirmedInputTokens: 50, confirmedOutputTokens: 12, unmeasuredAttempts: 0 })
    expect(by.find(r => r.provider === 'groq')).toMatchObject({
      attempts: 2, measuredRequests: 1, unmeasuredAttempts: 1, confirmedInputTokens: 10 })
  })

  it('counts only actual non-LLM work and never invents provider billing amounts', () => {
    expect(summarizeModuleActivity([
      { component: 'rag', event: 'embedding_completed', inputCount: 5, durationMs: 125 },
      { component: 'rag', event: 'embedding_failed', inputCount: 9, durationMs: 30 },
      { component: 'stt', event: 'final_received', wordCount: 10 },
      { component: 'stt', event: 'audio_frames_stalled' },
      { component: 'connectors', event: 'sync_pass_completed', checked: 3, failures: 1, durationMs: 110 },
    ])).toEqual([
      { module: 'rag', unit: 'embedding inputs', completedCalls: 1, failedCalls: 1, processedUnits: 5, elapsedMs: 155 },
      { module: 'stt', unit: 'final speech segments', completedCalls: 1, failedCalls: 1, processedUnits: 1, elapsedMs: null },
      { module: 'connectors', unit: 'approved source checks', completedCalls: 1, failedCalls: 1, processedUnits: 3, elapsedMs: 110 },
    ])
  })

  it('isolates provider retries, STT and usage per account without guessing legacy owners', () => {
    const rows = [
      { component: 'api', event: 'request_started', accountScope: 'alice', requestId: 'req_a', path: '/api/hint' },
      { component: 'api', event: 'request_started', accountScope: 'bob', requestId: 'req_b', path: '/api/evaluate' },
      { component: 'llm', event: 'attempt_started', requestId: 'req_a', attemptId: 'llm_a' },
      { component: 'llm', event: 'attempt_started', requestId: 'req_b', attemptId: 'llm_b' },
      { component: 'llm', event: 'attempt_started', attemptId: 'llm_legacy' },
      { component: 'stt', event: 'final_received', accountScope: 'bob' },
      { component: 'stt', event: 'final_received', accountScope: 'alice' },
    ]
    const ledger = [
      { event: 'attempt_succeeded', requestId: 'req_a', attemptId: 'llm_a', operation: 'stream', provider: 'openai', inputTokens: 10, outputTokens: 5 },
      { event: 'attempt_succeeded', requestId: 'req_b', attemptId: 'llm_b', operation: 'stream', provider: 'groq', inputTokens: 20, outputTokens: 9 },
      { event: 'attempt_succeeded', attemptId: 'llm_legacy', operation: 'stream', provider: 'gemini', inputTokens: 30, outputTokens: 10 },
    ]
    const alice = filterAccountOperations(rows, ledger, 'alice')
    const bob = filterAccountOperations(rows, ledger, 'bob')
    expect(alice.rows.map(row => row.attemptId).filter(Boolean)).toEqual(['llm_a'])
    expect(bob.rows.map(row => row.attemptId).filter(Boolean)).toEqual(['llm_b'])
    expect(alice.ledgerEntries).toHaveLength(1)
    expect(bob.ledgerEntries).toHaveLength(1)
    expect(summarizeOperations(alice.rows, alice.ledgerEntries).usage[0].confirmedOutputTokens).toBe(5)
    expect(summarizeOperations(bob.rows, bob.ledgerEntries).usage[0].confirmedOutputTokens).toBe(9)
    expect(() => filterAccountOperations(rows, ledger, 'bad/../alice')).toThrow(/Invalid/)
  })

  it('durably records usage across process reopening and isolates request timelines', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-operations-'))
    const a = new UsageLedger(dir)
    try {
      a.record({ component: 'llm', event: 'attempt_succeeded', attemptId: 'llm_test_1',
        operation: 'stream', provider: 'groq', inputTokens: 12, outputTokens: 7 })
      await a.close()
      const b = new UsageLedger(dir)
      const entries = await b.entries()
      expect(entries).toHaveLength(1)
      expect(summarizeUsage(entries)[0].confirmedOutputTokens).toBe(7)
      await b.clear()
      expect(await b.entries()).toEqual([])
      await b.close()
    } finally { fs.rmSync(dir, { recursive: true, force: true }) }
    const view = summarizeOperations([
      { component: 'api', event: 'request_started', requestId: 'api_q', path: '/api/hint-stream', ts: '2026-11-10T10:00:00Z' },
      { component: 'llm', event: 'attempt_started', requestId: 'api_q', attemptId: 'llm_1', provider: 'groq', ts: '2026-11-10T10:00:01Z' },
      { component: 'api', event: 'request_completed', requestId: 'api_q', durationMs: 1200, ok: true, ts: '2026-11-10T10:00:02Z' },
      { component: 'llm', event: 'attempt_failed', attemptId: 'llm_legacy', ts: '2026-11-10T10:00:02Z' },
    ], [])
    expect(view.requests[0]).toMatchObject({ requestId: 'api_q', route: '/api/hint-stream',
      status: 'completed', durationMs: 1200, providerAttempts: 1 })
    expect(view.uncorrelatedProviderEvents).toBe(1)
  })
})
