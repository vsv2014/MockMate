import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'))

const expected = {
  electron: '44.5.1',
  'electron-builder': '26.5.0',
  'electron-updater': '6.8.10',
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

assert(pkg.devDependencies.electron === expected.electron, `electron must be ${expected.electron}`)
assert(pkg.devDependencies['electron-builder'] === expected['electron-builder'], `electron-builder must be ${expected['electron-builder']}`)
assert(pkg.dependencies['electron-updater'] === expected['electron-updater'], `electron-updater must be ${expected['electron-updater']}`)

for (const [name, version] of Object.entries(expected)) {
  assert(!/(?:alpha|beta|rc|nightly)/i.test(version), `${name} must not use a prerelease version`)
}

assert(lock.version === pkg.version, 'package-lock root version must match package.json')
assert(lock.packages?.['']?.version === pkg.version, 'package-lock root package version must match package.json')
assert(lock.packages?.['']?.devDependencies?.electron === expected.electron, 'lockfile electron spec must match')
assert(lock.packages?.['']?.devDependencies?.['electron-builder'] === expected['electron-builder'], 'lockfile electron-builder spec must match')
assert(lock.packages?.['']?.dependencies?.['electron-updater'] === expected['electron-updater'], 'lockfile electron-updater spec must match')
assert(lock.packages?.['node_modules/electron']?.version === expected.electron, 'resolved electron version must match')
assert(lock.packages?.['node_modules/electron-builder']?.version === expected['electron-builder'], 'resolved electron-builder version must match')
assert(lock.packages?.['node_modules/electron-updater']?.version === expected['electron-updater'], 'resolved electron-updater version must match')

console.log(`Platform dependency contract verified: Electron ${expected.electron}, builder ${expected['electron-builder']}, updater ${expected['electron-updater']}`)
