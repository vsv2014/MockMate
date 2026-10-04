import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const dist = path.join(root, 'dist')
const assetsDir = path.join(dist, 'assets')

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

assert(fs.existsSync(path.join(dist, 'index.html')), 'dist/index.html missing')
assert(fs.existsSync(path.join(dist, 'landing.html')), 'public landing.html was not copied to dist')
assert(fs.existsSync(path.join(dist, 'media', 'card-solo-practice.png')), 'Solo landing media missing from dist')
assert(fs.existsSync(path.join(dist, 'media', 'card-live-mode.png')), 'Live landing media missing from dist')
assert(!fs.existsSync(path.join(dist, 'marketing')), 'marketing source directory must not be deployed through Vite public output')

const assets = fs.readdirSync(assetsDir)
const requiredChunkPrefixes = [
  'vendor-sentry-',
  'vendor-livekit-ui-',
  'vendor-livekit-client-',
  'vendor-html2canvas-',
  'vendor-jspdf-',
  'vendor-pdf-reader-',
  'vendor-react-',
]

for (const prefix of requiredChunkPrefixes) {
  assert(assets.some((name) => name.startsWith(prefix) && name.endsWith('.js')), `Expected Rolldown chunk ${prefix}*.js`)
}

console.log(`Vite output verified: ${assets.length} assets, stable vendor chunks present, public landing/media copied.`)
