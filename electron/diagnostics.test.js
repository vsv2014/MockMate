import { createRequire } from 'module'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { clean, DiagnosticStore } = require('./diagnostics.cjs')

describe('diagnostic redaction', () => {
  it('removes credentials and interview content recursively', () => {
    const out = clean({
      provider: 'openai',
      apiKey: 'sk-secret-value-1234567890',
      nested: { authorization: 'Bearer abc.def.ghi', transcript: 'private interview words' },
      outputTokens: 421,
      status: 429,
    })
    expect(out.provider).toBe('openai')
    expect(out.status).toBe(429)
    expect(out.outputTokens).toBe(421)
    expect(out.apiKey).toBe('[redacted]')
    expect(out.nested.authorization).toBe('[redacted]')
    expect(out.nested.transcript).toBe('[redacted]')
  })

  it('bounds large strings and collections', () => {
    const out = clean({ message: 'x'.repeat(900), values: Array.from({ length: 50 }, (_, i) => i) })
    expect(out.message).toBe('[redacted]')
    expect(out.values).toHaveLength(30)
  })

  it('never exports raw account identifiers and isolates even shared provider attempts', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-scoped-diag-'))
    const store = new DiagnosticStore({ userData: dir, appVersion: 'test', platform: 'win32', arch: 'x64' })
    try {
      store.event('api', 'request_started', { accountScope: 'alice-account', requestId: 'req_alice', path: '/api/hint' })
      store.event('llm', 'attempt_succeeded', { requestId: 'req_alice', attemptId: 'llm_0123',
        operation: 'stream', provider: 'openai', inputTokens: 4, outputTokens: 2 })
      store.event('api', 'request_started', { accountScope: 'bob-account', requestId: 'req_bob', path: '/api/evaluate' })
      const alice = await store.readOperations('alice-account')
      const bob = await store.readOperations('bob-account')
      expect(alice.requests).toHaveLength(1)
      expect(alice.requests[0].requestId).toBe('req_alice')
      expect(alice.usage[0].confirmedOutputTokens).toBe(2)
      expect(bob.requests).toHaveLength(1)
      expect(bob.requests[0].requestId).toBe('req_bob')
      expect(bob.usage).toHaveLength(0)
      const raw = fs.readFileSync(path.join(dir, 'logs', 'diagnostics.jsonl'), 'utf8')
      expect(raw).not.toContain('alice-account')
      expect(raw).not.toContain('bob-account')
      expect(raw).toMatch(/acct_[a-f0-9]{24}/)
      expect(store.hashScope('alice-account')).not.toBe(store.hashScope('bob-account'))
    } finally {
      await store.close()
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('writes, exports, and clears a redacted local bundle', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mockmate-diag-'))
    const store = new DiagnosticStore({ userData: dir, appVersion: 'test', platform: 'win32', arch: 'x64' })
    try {
      store.event('llm', 'attempt_failed', { provider: 'openai', apiKey: 'sk-private-value-123456789', status: 429 })
      const destination = path.join(dir, 'bundle.jsonl')
      const result = await store.exportTo(destination)
      const text = fs.readFileSync(destination, 'utf8')
      expect(result.files).toBe(1)
      expect(text).toContain('attempt_failed')
      expect(text).toContain('[redacted]')
      expect(text).not.toContain('sk-private-value')
      await store.clear()
      expect(fs.existsSync(path.join(dir, 'logs', 'diagnostics.jsonl'))).toBe(false)
    } finally {
      await store.close()
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })
})
