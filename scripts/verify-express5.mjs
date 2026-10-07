import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = p => JSON.parse(fs.readFileSync(path.join(root, p), 'utf8'))
const expected = '5.2.1'

for (const [label, manifestPath, lockPath] of [
  ['root', 'package.json', 'package-lock.json'],
  ['backend', 'backend/package.json', 'backend/package-lock.json'],
]) {
  const manifest = read(manifestPath)
  const lock = read(lockPath)
  const spec = manifest.dependencies?.express
  const lockedSpec = lock.packages?.['']?.dependencies?.express
  const resolved = lock.packages?.['node_modules/express']?.version
  if (spec !== expected) throw new Error(`${label}: expected express ${expected}, found ${spec}`)
  if (lockedSpec !== expected) throw new Error(`${label}: expected lock express ${expected}, found ${lockedSpec}`)
  if (resolved !== expected) throw new Error(`${label}: expected resolved express ${expected}, found ${resolved}`)
}
if (/(alpha|beta|rc|nightly)/i.test(expected)) throw new Error(`Prerelease Express is not allowed: ${expected}`)
console.log(`Express contract verified: ${expected}`)
