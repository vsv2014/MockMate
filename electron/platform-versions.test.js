import { describe, expect, it } from 'vitest'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'))

const expected = {
  electron: '44.5.1',
  'electron-builder': '26.17.0',
  'electron-updater': '6.8.10',
}

describe('stable Electron platform toolchain', () => {
  it('pins the approved stable versions without prerelease ranges', () => {
    expect(pkg.devDependencies.electron).toBe(expected.electron)
    expect(pkg.devDependencies['electron-builder']).toBe(expected['electron-builder'])
    expect(pkg.dependencies['electron-updater']).toBe(expected['electron-updater'])

    for (const version of Object.values(expected)) {
      expect(version).not.toMatch(/(?:alpha|beta|rc|nightly)/i)
    }
  })

  it('keeps package-lock metadata and resolved platform versions in sync', () => {
    expect(lock.version).toBe(pkg.version)
    expect(lock.packages?.['']?.version).toBe(pkg.version)
    expect(lock.packages?.['']?.devDependencies?.electron).toBe(expected.electron)
    expect(lock.packages?.['']?.devDependencies?.['electron-builder']).toBe(expected['electron-builder'])
    expect(lock.packages?.['']?.dependencies?.['electron-updater']).toBe(expected['electron-updater'])
    expect(lock.packages?.['node_modules/electron']?.version).toBe(expected.electron)
    expect(lock.packages?.['node_modules/electron-builder']?.version).toBe(expected['electron-builder'])
    expect(lock.packages?.['node_modules/electron-updater']?.version).toBe(expected['electron-updater'])
  })
})
