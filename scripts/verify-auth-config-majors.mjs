import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = p => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'))
const pkg = read('package.json')
const lock = read('package-lock.json')
const backendPkg = read('backend/package.json')
const backendLock = read('backend/package-lock.json')
const expected = { bcryptjs: '3.0.3', dotenv: '18.0.5' }

for (const [name, version] of Object.entries(expected)) {
  for (const [label, manifest, lockfile] of [
    ['root', pkg, lock],
    ['backend', backendPkg, backendLock],
  ]) {
    const spec = manifest.dependencies?.[name]
    const lockedSpec = lockfile.packages?.['']?.dependencies?.[name]
    const resolved = lockfile.packages?.[`node_modules/${name}`]?.version
    if (spec !== version) throw new Error(`${label}: expected ${name} ${version} in package.json, found ${spec}`)
    if (lockedSpec !== version) throw new Error(`${label}: expected ${name} ${version} in lock metadata, found ${lockedSpec}`)
    if (resolved !== version) throw new Error(`${label}: expected resolved ${name} ${version}, found ${resolved}`)
  }
  if (/(alpha|beta|rc|nightly)/i.test(version)) throw new Error(`Prerelease ${name} is not allowed: ${version}`)
}

console.log('Auth/config dependency contract verified: bcryptjs 3.0.3, dotenv 18.0.5')
