/**
 * API smoke — runs the route-contract suite (no long-lived listen / process.exit race).
 * Full HTTP registrar coverage is in api/_lib/apiRoutes.test.js.
 *
 *   npm run smoke:api
 */
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const child = spawn(
  process.execPath,
  [path.join(root, 'node_modules/vitest/vitest.mjs'), 'run', 'api/_lib/apiRoutes.test.js'],
  { cwd: root, stdio: 'inherit', env: process.env },
)
child.on('exit', (code, signal) => {
  if (signal) {
    console.error(`✗ API smoke killed by ${signal}`)
    process.exit(1)
  }
  process.exit(code ?? 1)
})
