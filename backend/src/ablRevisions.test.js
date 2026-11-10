import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { loadAblSpec, _resetAblCacheForTests } from './abl.js'
import { currentAblPolicyStatus, listAblRevisions, applyAblRevision, rollbackAblRevision, previewAblRevision } from './ablRevisions.js'
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

  it('dry-runs valid routing changes without touching disk or exposing raw policy content', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-abl-review-')); dirs.push(dir)
    const current = structuredClone(loadAblSpec({ force: true }))
    const file = path.join(dir, 'current.json')
    const before = JSON.stringify(current)
    fs.writeFileSync(file, before)
    process.env.MOCKMATE_ABL_PATH = file
    _resetAblCacheForTests()
    const next = structuredClone(current)
    next.routing.reasoning.interview = next.routing.reasoning.interview === 'fast' ? 'strong' : 'fast'
    const review = previewAblRevision(JSON.stringify(next))
    expect(review.changed).toBe(true)
    expect(review.changedPaths).toContain('routing.reasoning.interview')
    expect(review.requiresLiveRetest).toBe(true)
    expect(review.currentDigest).toMatch(/^[a-f0-9]{16}$/)
    expect(review.note).toMatch(/No policy was published/)
    expect(fs.readFileSync(file, 'utf8')).toBe(before)
    expect(listAblRevisions()).toHaveLength(0)
    const applied = applyAblRevision(next, { expectedDigest: review.currentDigest })
    expect(applied.changed).toBe(true)
    expect(() => applyAblRevision(current, { expectedDigest: review.currentDigest }))
      .toThrow(/changed since review/)
    expect(() => rollbackAblRevision(applied.previousRevision,
      { expectedDigest: review.currentDigest })).toThrow(/changed since review/)
  })

  it('rejects invalid/secret-containing proposals before dry-run or policy mutation', () => {
    const current = structuredClone(loadAblSpec({ force: true }))
    current.capabilities.speech.turnDetection.apiKey = 'private-data'
    expect(() => previewAblRevision(current)).toThrow(/secrets/)
    expect(() => previewAblRevision('{bad-json')).toThrow()
    expect(() => previewAblRevision('a'.repeat(129 * 1024))).toThrow(/128 KiB/)
  })

  it('never modifies the bundled default without an explicit private ABL path', () => {
    delete process.env.MOCKMATE_ABL_PATH
    expect(currentAblPolicyStatus().source).toBe('bundled_default')
    expect(() => applyAblRevision({})).toThrow(/Set MOCKMATE_ABL_PATH/)
  })
})
