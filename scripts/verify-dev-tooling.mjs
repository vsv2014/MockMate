import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'))
const expected = { concurrently: '10.0.5', 'wait-on': '9.5.1' }

for (const [name, version] of Object.entries(expected)) {
  const spec = pkg.devDependencies?.[name]
  const lockedSpec = lock.packages?.['']?.devDependencies?.[name]
  const resolved = lock.packages?.[`node_modules/${name}`]?.version
  if (spec !== version) throw new Error(`Expected ${name} ${version} in package.json, found ${spec}`)
  if (lockedSpec !== version) throw new Error(`Expected ${name} ${version} in package-lock root metadata, found ${lockedSpec}`)
  if (resolved !== version) throw new Error(`Expected resolved ${name} ${version}, found ${resolved}`)
  if (/(alpha|beta|rc|nightly)/i.test(version)) throw new Error(`Prerelease ${name} is not allowed: ${version}`)
}

console.log(`Dev-tooling contract verified: concurrently ${expected.concurrently}, wait-on ${expected['wait-on']}`)
