import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const releaseWorkflow = fs.readFileSync(path.join(root, '.github/workflows/release.yml'), 'utf8')

describe('signed Windows release security gates', () => {
  it('requires verifying downloaded NSIS updates against the signing certificate', () => {
    expect(pkg.build.win.verifyUpdateCodeSignature).toBe(true)
    expect(pkg.build.win.signtoolOptions.publisherName).toBeTruthy()
  })

  it('never publishes Windows releases with signing disabled', () => {
    expect(releaseWorkflow).toContain('Require production Windows signing identity')
    expect(releaseWorkflow).toContain('secrets.WIN_CSC_LINK')
    expect(releaseWorkflow).toContain('secrets.WIN_CSC_KEY_PASSWORD')
    expect(releaseWorkflow).toContain('vars.MOCKMATE_WINDOWS_PUBLISHER')
    expect(releaseWorkflow).toContain('Get-AuthenticodeSignature')
    expect(releaseWorkflow).toContain("signature.Status -ne 'Valid'")
    expect(releaseWorkflow).not.toMatch(/unset\s+WIN_CSC_LINK/)
  })

  it('only publishes after the signed installer build and verification job', () => {
    expect(releaseWorkflow).toContain('needs: [provenance, build-windows]')
    expect(releaseWorkflow).toContain('Verify Authenticode signatures and publisher')
    expect(releaseWorkflow).toContain('Smoke packaged Windows runtime before publication')
  })
})
