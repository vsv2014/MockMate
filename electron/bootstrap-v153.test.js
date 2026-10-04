import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const gate = fs.readFileSync(path.join(root, 'electron', 'bootstrap-v153.cjs'), 'utf8')

describe('v1.5.3 Windows installer handoff guard', () => {
  it('uses the pre-bootstrap gate and does not auto-run after NSIS finish', () => {
    expect(pkg.version).toBe('1.5.3')
    expect(pkg.main).toBe('electron/bootstrap-v153.cjs')
    expect(pkg.build?.nsis?.runAfterFinish).toBe(false)
  })

  it('disables updater auto-relaunch before loading the existing bootstrap', () => {
    const disableAt = gate.indexOf('autoUpdater.autoRunAppAfterInstall = false')
    const bootstrapAt = gate.indexOf("require('./bootstrap.cjs')")
    expect(disableAt).toBeGreaterThan(-1)
    expect(bootstrapAt).toBeGreaterThan(disableAt)
  })

  it('does not load the normal bootstrap when the packaged executable is absent', () => {
    expect(gate).toContain('if (!installedExecutablePresent())')
    expect(gate).toContain('do not fork the local API')
    expect(gate).toContain('Windows Security → Protection history')
  })
})
