// Preflight "doctor" — catches the classes of breakage that build+test miss:
//   1. a declared dependency isn't actually installed in node_modules
//   2. a tool the npm scripts invoke has no runnable bin shim (the "electron.cmd missing" bug)
// Run before saying "it runs": `npm run doctor`. Exits non-zero on any failure.
import { readFileSync, existsSync } from 'fs'
import { spawnSync } from 'child_process'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { tmpdir } from 'os'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const isWin = process.platform === 'win32'
let fail = 0
const bad = (m) => { console.log('  ✗ ' + m); fail++ }

// 1) Every declared dependency resolves.
const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) }
let missing = 0
for (const name of Object.keys(deps)) {
  if (!existsSync(join(root, 'node_modules', name, 'package.json'))) { bad(`dependency not installed: ${name}`); missing++ }
}
if (!missing) console.log(`  ✓ all ${Object.keys(deps).length} dependencies installed`)

// 2) Every tool the scripts call has a runnable bin (this is what would have caught electron.cmd).
const scriptText = Object.values(pkg.scripts || {}).join(' ')
const TOOLS = ['vite', 'vitest', 'electron', 'electron-builder', 'concurrently', 'wait-on']
for (const t of TOOLS) {
  if (!new RegExp(`\\b${t}\\b`).test(scriptText)) continue          // only check tools actually used
  const shim = join(root, 'node_modules', '.bin', isWin ? `${t}.cmd` : t)
  if (!existsSync(shim)) bad(`bin shim missing for "${t}" (scripts call it but node_modules/.bin/${isWin ? t + '.cmd' : t} is absent)`)
  else console.log(`  ✓ bin ok: ${t}`)
}

// 3) Electron 42+ downloads its binary lazily on first CLI invocation. Bootstrap it here,
// then verify the resolved executable rather than falsely reporting a broken install.
if (deps.electron) {
  const cli = join(root, 'node_modules', 'electron', 'cli.js')
  let reportedVersion = ''
  if (existsSync(cli)) {
    const args = [cli, ...(process.platform === 'linux' && process.getuid?.() === 0 ? ['--no-sandbox'] : []), '--version']
    const boot = spawnSync(process.execPath, args, {
      cwd: root, encoding: 'utf8', timeout: 120_000,
      env: { ...process.env, electron_config_cache: process.env.electron_config_cache || join(tmpdir(), 'mockmate-electron-cache') },
    })
    if (boot.status !== 0) bad(`electron runtime bootstrap failed: ${String(boot.stderr || boot.error?.message || 'unknown error').trim()}`)
    reportedVersion = String(boot.stdout || '').trim().replace(/^v/, '')
  }
  const p = join(root, 'node_modules', 'electron', 'path.txt')
  const exe = existsSync(p) && join(root, 'node_modules', 'electron', 'dist', readFileSync(p, 'utf8').trim())
  if (!exe || !existsSync(exe)) bad('electron binary missing (node_modules/electron/dist/<path.txt>) — `electron .` would fail')
  else {
    const declaredVersion = JSON.parse(readFileSync(join(root, 'node_modules', 'electron', 'package.json'), 'utf8')).version
    if (reportedVersion && reportedVersion !== declaredVersion) bad(`electron runtime ${reportedVersion} does not match installed package ${declaredVersion}`)
    else console.log(`  ✓ electron ${reportedVersion || declaredVersion} runtime present`)
  }
}

console.log(fail ? `\nDOCTOR: ${fail} problem(s) — the app is NOT runnable as-is.` : '\nDOCTOR: ✓ install is complete and runnable.')
process.exit(fail ? 1 : 0)
