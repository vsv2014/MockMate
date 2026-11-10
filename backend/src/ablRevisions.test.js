import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { loadAblSpec, _resetAblCacheForTests } from './abl.js'
import { currentAblPolicyStatus, listAblRevisions, applyAblRevision, rollbackAblRevision } from './ablRevisions.js'
const original = process.env.MOCKMATE_ABL_PATH
const dirs = []
afterEach(() => {
  if (original == null) delete process.env.MOCKMATE_ABL_PATH
  else process.env.MOCKMATE_ABL_PATH = original
  _resetAblCacheForTests()
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe('versioned ABL policy governance', () => {
  it('atomically applies validated JSON, archives the previous version and rolls back', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-abl-policy-')); dirs.push(dir)
    const base = structuredClone(loadAblSpec({ force: true }))
    const file = path.join(dir, 'active.json')
    fs.writeFileSync(file, JSON.stringify(base))
    process.env.MOCKMATE_ABL_PATH = file
    _resetAblCacheForTests()
    const next = structuredClone(base)
    next.routing.reasoning.interview = 'fast'
    const first = applyAblRevision(next)
    expect(first.changed).toBe(true)
    expect(first.source).toBe('operator_override')
    expect(listAblRevisions()).toContain(first.previousRevision)
    expect(loadAblSpec({ force: true }).routing.reasoning.interview).toBe('fast')
    expect(rollbackAblRevision(first.previousRevision).changed).toBe(true)
    expect(loadAblSpec({ force: true }).routing.reasoning.interview).toBe(base.routing.reasoning.interview)
    expect(currentAblPolicyStatus().availableRollbackRevisions).toBe(2)
  })

  it('rejects invalid policies and secrets without overwriting the active policy', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-abl-policy-')); dirs.push(dir)
    const base = structuredClone(loadAblSpec({ force: true }))
    const file = path.join(dir, 'active.json')
    fs.writeFileSync(file, JSON.stringify(base))
    process.env.MOCKMATE_ABL_PATH = file
    const next = structuredClone(base)
    next.routing.reasoning.hint = 'imaginary'
    expect(() => applyAblRevision(next)).toThrow(/unknown lane/)
    next.routing.reasoning.hint = 'fast'
    next.runtime.credentials = { apiKey: 'secret-key' }
    expect(() => applyAblRevision(next)).toThrow(/secrets/)
    expect(JSON.parse(fs.readFileSync(file)).routing.reasoning.hint).toBe(base.routing.reasoning.hint)
    expect(listAblRevisions()).toEqual([])
    expect(() => rollbackAblRevision('../unsafe')).toThrow(/Invalid rollback/)
  })

  it('never modifies the bundled default without an explicit private ABL path', () => {
    delete process.env.MOCKMATE_ABL_PATH
    expect(currentAblPolicyStatus().source).toBe('bundled_default')
    expect(() => applyAblRevision({})).toThrow(/Set MOCKMATE_ABL_PATH/)
  })
})
