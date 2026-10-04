import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'))

const expected = '5.0.3'
const spec = pkg.devDependencies?.vitest
const lockedSpec = lock.packages?.['']?.devDependencies?.vitest
const resolved = lock.packages?.['node_modules/vitest']?.version

if (spec !== expected) throw new Error(`Expected vitest ${expected} in package.json, found ${spec}`)
if (lockedSpec !== expected) throw new Error(`Expected vitest ${expected} in package-lock root metadata, found ${lockedSpec}`)
if (resolved !== expected) throw new Error(`Expected resolved vitest ${expected}, found ${resolved}`)
if (/(alpha|beta|rc|nightly)/i.test(expected)) throw new Error(`Prerelease Vitest is not allowed: ${expected}`)

const viteConfig = fs.readFileSync(path.join(root, 'vite.config.js'), 'utf8')
if (!viteConfig.includes("from 'vitest/config'")) throw new Error('vite.config.js must continue importing configDefaults from vitest/config')
if (!viteConfig.includes("'mobile/**'")) throw new Error('Desktop test config must continue excluding mobile/**')

console.log(`Vitest contract verified: ${expected}; desktop mobile/** exclusion preserved`)
