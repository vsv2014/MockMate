import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const releaseWorkflow = fs.readFileSync(path.join(root, '.github/workflows/release.yml'), 'utf8')
const desktopWorkflow = fs.readFileSync(path.join(root, '.github/workflows/desktop-ci.yml'), 'utf8')
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
    expect(releaseWorkflow).toContain('Select signed or isolated unsigned release mode')
    expect(releaseWorkflow).toContain('secrets.WIN_CSC_LINK')
    expect(releaseWorkflow).toContain('secrets.WIN_CSC_KEY_PASSWORD')
    expect(releaseWorkflow).toContain('vars.MOCKMATE_WINDOWS_PUBLISHER')
    expect(releaseWorkflow).toContain('Set all three signing settings or remove all three')
    expect(releaseWorkflow).toContain('Get-AuthenticodeSignature')
    expect(releaseWorkflow).toContain("signature.Status -ne 'Valid'")
    expect(releaseWorkflow).toContain("if: steps.release-mode.outputs.signed == 'true'")
  })

  it('isolates an explicitly unsigned fallback from stable identity and auto-updates', () => {
    expect(releaseWorkflow).toContain('node scripts/configure-unsigned-release.mjs')
    expect(releaseWorkflow).toContain("signature.Status -ne 'NotSigned'")
    expect(releaseWorkflow).toContain('MockMate-Personal-Preview-*-UNSIGNED.exe')
    expect(releaseWorkflow).toContain('UNSIGNED-RELEASE-NOTICE.txt')
    expect(releaseWorkflow).toContain('SHA256SUMS.txt')
    expect(releaseWorkflow).toContain('prerelease: true')
    expect(releaseWorkflow).toContain('make_latest: false')
    expect(releaseWorkflow).toContain("-name 'latest*.yml' -o -name '*.blockmap' -o -name 'app-update.yml'")
    expect(previewConfig).toContain("preview.build.appId = 'com.mockmate.personal.preview'")
    expect(previewConfig).toContain('preview.build.publish = null')
    expect(previewConfig).not.toContain('preview.build.publish = []')
    expect(previewConfig).toContain('delete preview.build.win.signtoolOptions')
    expect(releaseWorkflow).toContain('Unsigned build must not retain a signing identity')
    expect(desktopWorkflow).toContain('unsigned-release-windows:')
    expect(desktopWorkflow).toContain('node scripts/configure-unsigned-release.mjs')
    expect(desktopWorkflow).toContain('Smoke exact unsigned packaged runtime')
  })

  it('inspects the packaged updater metadata before asserting it is absent', () => {
    // A failing "no updater feed" gate must show the offending app-update.yml in
    // the job log, because the packaged output dies with the runner.
    for (const [name, workflow] of [
      ['desktop-ci', desktopWorkflow],
      ['release', releaseWorkflow],
      ['unsigned-personal-prerelease', prereleaseWorkflow],
      ['personal-preview', personalPreviewWorkflow],
    ]) {
      expect(workflow, `${name} must inspect packaged updater metadata`).toContain('scripts/inspect-packaged-updater-metadata.mjs')
      expect(workflow, `${name} must inspect before gating`).toContain('Inspect packaged updater metadata')
    }
  })

  it('publishes either mode only after build verification and packaged smoke', () => {
    expect(releaseWorkflow).toContain('needs: [provenance, build-windows]')
    expect(releaseWorkflow).toContain('Verify Authenticode signatures and publisher')
    expect(releaseWorkflow).toContain('Verify isolated unsigned installer and disabled update feed')
    expect(releaseWorkflow).toContain('Smoke packaged Windows runtime before publication')
  })
})
