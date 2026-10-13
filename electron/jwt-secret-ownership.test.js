import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const main = fs.readFileSync(path.join(root, 'electron', 'main.cjs'), 'utf8')
const bootstrap = fs.readFileSync(path.join(root, 'electron', 'bootstrap.cjs'), 'utf8')
const entry = fs.readFileSync(path.join(root, 'electron', 'bootstrap-v153.cjs'), 'utf8')

// Single-owner contract for the per-install JWT secret:
//   bootstrap.cjs CREATES (atomically, verified, quits the app on failure, re-creates a
//   missing/short file on every launch) — main.cjs only READS. A silent regeneration in
//   main.cjs would mint a one-run ephemeral secret and invalidate every user session on
//   the next launch, which is the exact regression bootstrap.cjs exists to prevent.
describe('jwt secret ownership', () => {
  it('bootstrap owns creation: atomic temp-file write, length verification, quit on failure', () => {
    expect(bootstrap).toContain('.jwt-secret')
    expect(bootstrap).toMatch(/renameSync\(tmp, file\)/)
    expect(bootstrap).toContain('JWT secret verification failed')
    expect(bootstrap).toContain('could not persist its local sign-in secret')
  })

  it('bootstrap re-creates the file when missing or invalid, not only on first run', () => {
    expect(bootstrap).toMatch(/!fs\.existsSync\(file\)\s*\|\|\s*fs\.readFileSync\(file, 'utf8'\)\.trim\(\)\.length < 64/)
  })

  it('bootstrap registers the secret handler before it loads main.cjs, so creation precedes the backend start', () => {
    // Load chain: bootstrap-v153.cjs requires bootstrap.cjs, which registers its
    // app.whenReady secret handler and only then requires main.cjs — so bootstrap's
    // handler is always queued ahead of main.cjs's whenReady callback.
    expect(entry).toContain("require('./bootstrap.cjs')")
    const secretAt = bootstrap.indexOf('.jwt-secret')
    const mainAt = bootstrap.indexOf("require('./main.cjs')")
    expect(secretAt).toBeGreaterThan(-1)
    expect(mainAt).toBeGreaterThan(-1)
    expect(secretAt).toBeLessThan(mainAt)
  })

  it('main.cjs getJwtSecret is read-only — it never regenerates an ephemeral secret', () => {
    const start = main.indexOf('function getJwtSecret')
    expect(start).toBeGreaterThan(-1)
    const body = main.slice(start, main.indexOf('function startBackend'))
    expect(body).toContain('readFileSync')
    expect(body).not.toContain('randomBytes')
    expect(body).not.toContain('writeFileSync')
    expect(body).not.toContain('catch {}')
  })
})
