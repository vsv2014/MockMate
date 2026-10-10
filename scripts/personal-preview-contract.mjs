import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createPersonalPreviewConfig } from './personal-preview-config.mjs'

const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url)))
const lock = JSON.parse(fs.readFileSync(new URL('../package-lock.json', import.meta.url)))

test('preview keeps versioned install isolated, unsigned and manual-update-only', () => {
  const src = structuredClone(pkg)
  const { pkg: p, lock: l, version, tag } = createPersonalPreviewConfig(pkg, lock, '1')
  assert.equal(version, '1.5.5-personal.1')
  assert.equal(tag, 'personal-v1.5.5-1')
  assert.equal(p.personalPreviewBuild, true)
  assert.equal(p.managedApiBase, '')
  assert.equal(p.build.appId, 'com.mockmate.personal.preview')
  assert.equal(p.productName, 'MockMate Personal Preview')
  assert.equal(p.build.productName, 'MockMate Personal Preview')
  assert.equal(p.build.executableName, 'MockMatePersonalPreview')
  assert.equal(p.build.nsis.shortcutName, 'MockMate Personal Preview')
  assert.equal(p.build.nsis.deleteAppDataOnUninstall, false)
  assert.equal(p.build.nsis.include, undefined)
  assert.equal(p.build.publish, undefined)
  assert.equal(p.build.win.verifyUpdateCodeSignature, true)
  assert.equal(p.build.win.artifactName, 'MockMate-Personal-Preview-${version}-UNSIGNED.${ext}')
  assert.equal(l.version, version)
  assert.equal(l.packages[''].version, version)
  assert.deepEqual(pkg, src, 'preview config must not mutate stable package')
  assert.equal(pkg.personalPreviewBuild, undefined)
})

test('reject malformed numbers, mismatched versions and weakened stable signature policy', () => {
  for (const number of ['0','01','1.0','-1','a','1000','']) {
    assert.throws(() => createPersonalPreviewConfig(pkg, lock, number))
  }
  assert.throws(() => createPersonalPreviewConfig(pkg, { ...lock, version: '1.5.3' }, '1'))
  const unsafe = structuredClone(pkg)
  unsafe.build.win.verifyUpdateCodeSignature = false
  assert.throws(() => createPersonalPreviewConfig(unsafe, lock, '1'))
})
