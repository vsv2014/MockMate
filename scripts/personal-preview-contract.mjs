import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createPersonalPreviewConfig, createUnsignedReleaseConfig } from './personal-preview-config.mjs'

const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url)))
const lock = JSON.parse(fs.readFileSync(new URL('../package-lock.json', import.meta.url)))

test('preview keeps versioned install isolated, unsigned and manual-update-only', () => {
  const src = structuredClone(pkg)
  const { pkg: p, lock: l, version, tag } = createPersonalPreviewConfig(pkg, lock, '1')
  assert.equal(version, `${pkg.version}-personal.1`)
  assert.equal(tag, `personal-v${pkg.version}-1`)
  assert.equal(p.personalPreviewBuild, true)
  assert.equal(p.managedApiBase, '')
  assert.equal(p.build.appId, 'com.mockmate.personal.preview')
  assert.equal(p.productName, 'MockMate Personal Preview')
  assert.equal(p.build.productName, 'MockMate Personal Preview')
  assert.equal(p.build.executableName, 'MockMatePersonalPreview')
  assert.equal(p.build.nsis.shortcutName, 'MockMate Personal Preview')
  assert.equal(p.build.nsis.deleteAppDataOnUninstall, false)
  assert.equal(p.build.nsis.include, undefined)
  assert.deepEqual(p.build.publish, [])
  assert.equal(p.build.win.verifyUpdateCodeSignature, true)
  assert.equal(p.build.win.signtoolOptions, undefined)
  assert.equal(p.build.win.artifactName, 'MockMate-Personal-Preview-${version}-UNSIGNED.${ext}')
  assert.equal(l.version, version)
  assert.equal(l.packages[''].version, version)
  assert.deepEqual(pkg, src, 'preview config must not mutate stable package')
  assert.equal(pkg.personalPreviewBuild, undefined)
})

test('unsigned version release keeps the exact tag version but isolates app and updater identity', () => {
  const src = structuredClone(pkg)
  const { pkg: p, lock: l, version, tag } = createUnsignedReleaseConfig(pkg, lock)
  assert.equal(version, pkg.version)
  assert.equal(tag, `v${pkg.version}`)
  assert.equal(p.version, pkg.version)
  assert.equal(p.personalPreviewBuild, true)
  assert.equal(p.managedApiBase, '')
  assert.equal(p.build.appId, 'com.mockmate.personal.preview')
  assert.equal(p.build.productName, 'MockMate Personal Preview')
  assert.equal(p.build.executableName, 'MockMatePersonalPreview')
  assert.deepEqual(p.build.publish, [])
  assert.equal(p.build.win.verifyUpdateCodeSignature, true)
  assert.equal(p.build.win.signtoolOptions, undefined)
  assert.equal(p.build.win.artifactName, 'MockMate-Personal-Preview-${version}-UNSIGNED.${ext}')
  assert.equal(l.version, pkg.version)
  assert.equal(l.packages[''].version, pkg.version)
  assert.deepEqual(pkg, src, 'unsigned release config must not mutate stable package')
})

test('reject malformed numbers, mismatched versions and weakened stable signature policy', () => {
  for (const number of ['0','01','1.0','-1','a','1000','']) {
    assert.throws(() => createPersonalPreviewConfig(pkg, lock, number))
  }
  assert.throws(() => createPersonalPreviewConfig(pkg, { ...lock, version: '1.5.3' }, '1'))
  const unsafe = structuredClone(pkg)
  unsafe.build.win.verifyUpdateCodeSignature = false
  assert.throws(() => createPersonalPreviewConfig(unsafe, lock, '1'))
  const missingPublisher = structuredClone(pkg)
  delete missingPublisher.build.win.signtoolOptions
  assert.throws(() => createPersonalPreviewConfig(missingPublisher, lock, '1'))
})
