import { afterEach, describe, expect, it } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { compileAblRuntime, loadAblSpec, validateAblSpec, _resetAblCacheForTests } from './abl.js'

const previousPath = process.env.MOCKMATE_ABL_PATH
afterEach(() => {
  if (previousPath == null) delete process.env.MOCKMATE_ABL_PATH
  else process.env.MOCKMATE_ABL_PATH = previousPath
  _resetAblCacheForTests()
})

describe('ABL compiler', () => {
  it('loads MockMate ABL as the executable routing source of truth', () => {
    const spec = loadAblSpec({ force: true })
    const runtime = compileAblRuntime()
    expect(spec.application).toBe('mockmate')
    expect(runtime.ablVersion).toBe(spec.ablVersion)
    expect(runtime.reasoning.routing.hint).toBe('fast')
    expect(runtime.reasoning.routing.evaluate).toBe('strong')
    expect(runtime.reasoning.noDoubleRetry).toBe(true)
    expect(runtime.speech.stt.batch.fallback).toBe('typed-input')
  })

  it('rejects routing to an undeclared lane', () => {
    const base = structuredClone(loadAblSpec({ force: true }))
    base.routing.reasoning.hint = 'imaginary'
    expect(() => validateAblSpec(base)).toThrow(/unknown lane/)
  })

  it('rejects credentials in ABL documents', () => {
    const base = structuredClone(loadAblSpec({ force: true }))
    base.runtime.provider = { apiKey: 'must-never-live-here' }
    expect(() => validateAblSpec(base)).toThrow(/credentials\/secrets are forbidden/)
  })

  it('supports an explicitly selected validated ABL file', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mockmate-abl-'))
    const spec = structuredClone(loadAblSpec({ force: true }))
    spec.application = 'mockmate-test'
    const file = path.join(dir, 'test.abl.json')
    fs.writeFileSync(file, JSON.stringify(spec))
    process.env.MOCKMATE_ABL_PATH = file
    _resetAblCacheForTests()
    expect(compileAblRuntime().application).toBe('mockmate-test')
  })
})
