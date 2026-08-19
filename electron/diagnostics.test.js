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
    expect(out.message).toHaveLength(500)
    expect(out.values).toHaveLength(30)
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
