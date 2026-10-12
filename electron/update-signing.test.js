import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const releaseWorkflow = fs.readFileSync(path.join(root, '.github/workflows/release.yml'), 'utf8')
const validationWorkflow = fs.readFileSync(path.join(root, '.github/workflows/desktop-ci.yml'), 'utf8')
const previewConfig = fs.readFileSync(path.join(root, 'scripts/personal-preview-config.mjs'), 'utf8')
const prereleaseWorkflow = fs.readFileSync(path.join(root, '.github/workflows/unsigned-personal-prerelease.yml'), 'utf8')
const personalPreviewWorkflow = fs.readFileSync(path.join(root, '.github/workflows/personal-preview.yml'), 'utf8')

describe('Windows release signing and unsigned isolation gates', () => {
  it('keeps signed updates verified or removes the updater identity in unsigned preview mode', () => {
    expect(pkg.build.win.verifyUpdateCodeSignature).toBe(true)
    if (pkg.personalPreviewBuild === true) {
      // Strictly null: an absent or empty-array publish makes electron-builder
      // re-derive a GitHub feed and embed resources/app-update.yml.
      expect(pkg.build.publish).toBeNull()
      expect(pkg.build.win.signtoolOptions).toBeUndefined()
    } else {
      expect(pkg.build.win.signtoolOptions?.publisherName).toBeTruthy()
    }
  })

  it('retains strict signature verification whenever all signing settings exist', () => {
    expect(releaseWorkflow).toContain('node scripts/require-windows-signing.mjs')
    expect(releaseWorkflow).toContain('secrets.WIN_CSC_LINK')
    expect(releaseWorkflow).toContain('secrets.WIN_CSC_KEY_PASSWORD')
    expect(releaseWorkflow).toContain('vars.MOCKMATE_WINDOWS_PUBLISHER')
    expect(releaseWorkflow).not.toContain('mode=unsigned')
    expect(releaseWorkflow).toContain('Get-AuthenticodeSignature')
    expect(releaseWorkflow).toContain("signature.Status -ne 'Valid'")
    expect(releaseWorkflow).not.toContain('forceCodeSigning=false')
    expect(validationWorkflow).toContain('--publish never --config.win.forceCodeSigning=false')
    expect(releaseWorkflow).toContain('prerelease: false')
    expect(releaseWorkflow).toContain('make_latest: true')
    if (!pkg.personalPreviewBuild) expect(pkg.build.win.forceCodeSigning).toBe(true)
  })

  it('keeps manual unsigned previews separate from the signed stable workflow', () => {
    expect(releaseWorkflow).not.toContain('node scripts/configure-unsigned-release.mjs')
    expect(releaseWorkflow).not.toContain('prerelease: true')
    expect(releaseWorkflow).not.toContain('Publish isolated UNSIGNED')
    expect(personalPreviewWorkflow).toContain('prerelease: true')
    expect(previewConfig).toContain("preview.build.appId = 'com.mockmate.personal.preview'")
    expect(previewConfig).toContain('preview.build.publish = null')
    expect(previewConfig).not.toContain('preview.build.publish = []')
    expect(previewConfig).toContain('delete preview.build.win.signtoolOptions')
  })

  it('inspects the packaged updater metadata before asserting it is absent', () => {
    // A failing "no updater feed" gate must show the offending app-update.yml in
    // the job log, because the packaged output dies with the runner.
    for (const [name, workflow] of [
      ['unsigned-personal-prerelease', prereleaseWorkflow],
      ['personal-preview', personalPreviewWorkflow],
    ]) {
      expect(workflow, `${name} must inspect packaged updater metadata`).toContain('scripts/inspect-packaged-updater-metadata.mjs')
      expect(workflow, `${name} must inspect before gating`).toContain('Inspect packaged updater metadata')
    }
  })

  it('publishes signed stable releases only after build verification and packaged smoke', () => {
    expect(releaseWorkflow).toContain('needs: [provenance, build-windows]')
    expect(releaseWorkflow).toContain('Verify Authenticode signatures and publisher')
    expect(releaseWorkflow).toContain('Smoke packaged Windows runtime before publication')
  })
})
