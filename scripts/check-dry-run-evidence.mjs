#!/usr/bin/env node
/**
 * First 10 #10 — packaged Live dry-run evidence gate.
 *
 * Default: WARN if docs/evidence/v{version}.md is missing (does not fail CI).
 * MOCKMATE_REQUIRE_DRY_RUN=1: FAIL if missing or missing required PASS markers.
 */
import { readFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version
const evidence = join(root, 'docs', 'evidence', `v${version}.md`)
const requireGate = process.env.MOCKMATE_REQUIRE_DRY_RUN === '1'
const requiredIds = ['I01', 'I03', 'I04', 'I15', 'I16', 'I19']

if (!existsSync(evidence)) {
  const msg = `Missing Live dry-run evidence: docs/evidence/v${version}.md (copy from LIVE_DRY_RUN_TEMPLATE.md)`
  if (requireGate) { console.error('ERROR:', msg); process.exit(1) }
  console.warn('WARN:', msg)
  process.exit(0)
}

const text = readFileSync(evidence, 'utf8')
const missing = requiredIds.filter(id => {
  const re = new RegExp(`\\|\\s*${id}\\s*\\|\\s*PASS\\b`, 'i')
  return !re.test(text)
})
if (missing.length) {
  const msg = `${evidence} missing PASS for: ${missing.join(', ')}`
  if (requireGate) { console.error('ERROR:', msg); process.exit(1) }
  console.warn('WARN:', msg)
  process.exit(0)
}

console.log(`OK: dry-run evidence for v${version} includes PASS for ${requiredIds.join(', ')}`)
