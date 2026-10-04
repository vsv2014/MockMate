import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'))
const srcRoot = path.join(root, 'src')

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

const expected = '19.3.0'
assert(pkg.dependencies.react === expected, `react must be pinned to ${expected}`)
assert(pkg.dependencies['react-dom'] === expected, `react-dom must be pinned to ${expected}`)
assert(lock.packages?.['']?.dependencies?.react === expected, 'lockfile React spec must match package.json')
assert(lock.packages?.['']?.dependencies?.['react-dom'] === expected, 'lockfile ReactDOM spec must match package.json')
assert(lock.packages?.['node_modules/react']?.version === expected, 'resolved React version must match')
assert(lock.packages?.['node_modules/react-dom']?.version === expected, 'resolved ReactDOM version must match')

const main = fs.readFileSync(path.join(srcRoot, 'main.jsx'), 'utf8')
assert(main.includes("react-dom/client"), 'renderer must use react-dom/client')
assert(main.includes('.createRoot('), 'renderer must use createRoot')

const removedPatterns = [
  ['ReactDOM.render', /\bReactDOM\.render\s*\(/],
  ['ReactDOM.hydrate', /\bReactDOM\.hydrate\s*\(/],
  ['unmountComponentAtNode', /\bunmountComponentAtNode\s*\(/],
  ['findDOMNode', /\bfindDOMNode\s*\(/],
  ['createFactory', /\b(?:React\.)?createFactory\s*\(/],
  ['react-dom/test-utils', /react-dom\/test-utils/],
  ['react-test-renderer/shallow', /react-test-renderer\/shallow/],
  ['legacy contextTypes', /\b(?:childContextTypes|contextTypes|getChildContext)\b/],
  ['string refs', /\bref\s*=\s*["'][^"']+["']/],
  ['propTypes assignment', /\.propTypes\s*=/],
  ['defaultProps assignment', /\.defaultProps\s*=/],
]

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return walk(full)
    return /\.(?:js|jsx)$/.test(entry.name) ? [full] : []
  })
}

for (const file of walk(srcRoot)) {
  const text = fs.readFileSync(file, 'utf8')
  for (const [label, pattern] of removedPatterns) {
    assert(!pattern.test(text), `React 19 removed/deprecated pattern "${label}" found in ${path.relative(root, file)}`)
  }
}

console.log('React 19 contract verified: pinned 19.3.0, modern createRoot entrypoint, no removed React 19 APIs in src/.')
