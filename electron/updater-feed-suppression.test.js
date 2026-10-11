import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createUnsignedReleaseConfig } from '../scripts/personal-preview-config.mjs'
import { resolveUpdaterFeedIntent } from '../scripts/inspect-packaged-updater-metadata.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'))

// The unsigned-release CI job transforms the workspace before running this
// suite, so package.json is already the generated preview there.
// createUnsignedReleaseConfig() asserts a signed source and must not run in
// that mode - use whichever configuration is on disk.
const isPreviewMode = pkg.personalPreviewBuild === true

function unsignedBuildConfig() {
  return structuredClone(isPreviewMode ? pkg.build : createUnsignedReleaseConfig(pkg, lock).pkg.build)
}

// electron-builder only skips resources/app-update.yml when getPublishConfigs()
// returns null, which happens for exactly one build.publish value: null. These
// tests drive the real app-builder-lib resolution so a future "simplification"
// back to deleting publish or using [] fails here instead of in a 45-minute
// Windows packaging job.
describe('unsigned preview suppresses the embedded electron-builder updater feed', () => {
  const projectDirs = []
  const savedEnv = {}
  const envKeys = ['GITHUB_TOKEN', 'GH_TOKEN', 'TRAVIS_REPO_SLUG', 'APPVEYOR_REPO_NAME', 'CIRCLE_PROJECT_USERNAME', 'CIRCLE_PROJECT_REPONAME']

  // Mirror a GitHub Actions checkout: a CI token is present, package.json has no
  // "repository" field, and .git/config carries the GitHub remote. Both of those
  // are inputs electron-builder uses to re-derive a feed when publish is unset.
  function createCiProjectDir(build) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mockmate-updater-feed-'))
    projectDirs.push(dir)
    fs.mkdirSync(path.join(dir, '.git'), { recursive: true })
    fs.writeFileSync(
      path.join(dir, '.git', 'config'),
      [
        '[core]',
        '\trepositoryformatversion = 0',
        '[remote "origin"]',
        '\turl = https://github.com/vsv2014/MockMate.git',
        '\tfetch = +refs/heads/*:refs/remotes/origin/*',
        '',
      ].join('\n')
    )
    fs.writeFileSync(path.join(dir, 'package.json'), `${JSON.stringify({ name: 'mockmate', version: pkg.version, build }, null, 2)}\n`)
    return dir
  }

  async function resolveFeedIntent(build) {
    const dir = createCiProjectDir(build)
    const intent = await resolveUpdaterFeedIntent(build, dir, [])
    expect(intent.available, 'app-builder-lib must be resolvable for this gate to mean anything').toBe(true)
    expect(intent.error, intent.error).toBeUndefined()
    return intent
  }

  beforeAll(() => {
    for (const key of envKeys) {
      savedEnv[key] = process.env[key]
      delete process.env[key]
    }
    process.env.GITHUB_TOKEN = 'ghs_ci-token-placeholder-not-a-secret'
  })

  afterAll(() => {
    for (const key of envKeys) {
      if (savedEnv[key] === undefined) delete process.env[key]
      else process.env[key] = savedEnv[key]
    }
    for (const dir of projectDirs) fs.rmSync(dir, { recursive: true, force: true })
  })

  it('resolves repository info from a CI checkout the way the packager does', async () => {
    const intent = await resolveFeedIntent(pkg.build)
    expect(intent.repositoryInfo).toMatchObject({ type: 'github', user: 'vsv2014', project: 'MockMate' })
  })

  it('embeds no updater feed for the generated unsigned release configuration', async () => {
    const build = unsignedBuildConfig()
    expect(build.publish).toBeNull()
    const intent = await resolveFeedIntent(build)
    expect(intent.wouldWriteAppUpdateYml).toBe(false)
    expect(intent.publishConfig).toBeNull()
  })

  it('would embed a GitHub feed if publish were deleted instead of nulled', async () => {
    const build = unsignedBuildConfig()
    delete build.publish
    const intent = await resolveFeedIntent(build)
    expect(intent.wouldWriteAppUpdateYml).toBe(true)
    expect(intent.publishConfig).toMatchObject({ provider: 'github', owner: 'vsv2014', repo: 'MockMate' })
  })

  it('would embed a GitHub feed if publish were an empty array', async () => {
    const intent = await resolveFeedIntent({ ...unsignedBuildConfig(), publish: [] })
    expect(intent.wouldWriteAppUpdateYml).toBe(true)
    expect(intent.publishConfig).toMatchObject({ provider: 'github', owner: 'vsv2014', repo: 'MockMate' })
  })

  // Only meaningful against the checked-in signed configuration; the preview
  // workspace has already had that configuration replaced.
  it.skipIf(isPreviewMode)('still embeds the feed for the checked-in signed configuration', async () => {
    // Guards against a vacuous pass: the harness must detect a real feed.
    const intent = await resolveFeedIntent(pkg.build)
    expect(intent.wouldWriteAppUpdateYml).toBe(true)
    expect(intent.publishConfig).toMatchObject({ provider: 'github', owner: 'vsv2014', repo: 'MockMate' })
  })
})
