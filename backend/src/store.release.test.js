import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { initStore, store } from './store.js'

describe('durable usage release', () => {
  let dir, oldDir, oldMongo
  beforeEach(async () => {
    oldDir = process.env.MOCKMATE_DATA_DIR; oldMongo = process.env.MONGO_URI
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mockmate-release-'))
    process.env.MOCKMATE_DATA_DIR = dir; delete process.env.MONGO_URI
    await initStore()
    await store().addUsage('u1', '2026-10', { llmCalls: 2, sttSeconds: 30 })
  })
  afterEach(() => {
    vi.restoreAllMocks(); fs.rmSync(dir, { recursive: true, force: true })
    if (oldDir === undefined) delete process.env.MOCKMATE_DATA_DIR; else process.env.MOCKMATE_DATA_DIR = oldDir
    if (oldMongo === undefined) delete process.env.MONGO_URI; else process.env.MONGO_URI = oldMongo
  })
  for (const [method, units, field] of [['releaseLlmUsage', 1, 'llmCalls'], ['releaseSttUsage', 5, 'sttSeconds']]) {
    it(`${method} rejects when persisting the release fails`, async () => {
      vi.spyOn(fs, 'renameSync').mockImplementationOnce(() => { throw new Error('disk unavailable') })
      await expect(store()[method]('u1', '2026-10', units)).rejects.toThrow('disk unavailable')
      // Caller can distinguish a changed in-memory value from durable state.
      const disk = JSON.parse(fs.readFileSync(path.join(dir, 'auth-db.json'), 'utf8'))
      expect(disk.usage[0][field]).toBe(field === 'llmCalls' ? 2 : 30)
    })
  }
  it('returns success only after a successful durable release', async () => {
    await expect(store().releaseLlmUsage('u1', '2026-10', 1)).resolves.toBe(true)
    const disk = JSON.parse(fs.readFileSync(path.join(dir, 'auth-db.json'), 'utf8'))
    expect(disk.usage[0].llmCalls).toBe(1)
  })
})
