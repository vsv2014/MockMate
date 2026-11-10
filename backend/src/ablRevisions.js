// Trusted local operator tooling for versioned ABL JSON. Not exposed as a
// remotely writable API: hosted callers can inspect effective policy metadata
// but cannot replace routing/budget/credential policy.
import fs from 'node:fs'
import path from 'node:path'
import { randomUUID, createHash } from 'node:crypto'
import { validateAblSpec } from './abl.js'

const SAFE_REV = /^rev-[0-9]{13}-[a-f0-9]{8}$/
const MAX_BYTES = 128 * 1024

function configTarget() {
  if (!process.env.MOCKMATE_ABL_PATH) throw new Error('Set MOCKMATE_ABL_PATH to a private, writable JSON config file')
  const target = path.resolve(process.env.MOCKMATE_ABL_PATH)
  if (!target.endsWith('.json')) throw new Error('ABL path must be a JSON file')
  const stat = fs.lstatSync(target)
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('ABL config must be a regular file, not a symlink')
  return target
}
function parseSpec(text) {
  if (Buffer.byteLength(text) > MAX_BYTES) throw new Error('ABL configuration exceeds 128 KiB')
  return validateAblSpec(JSON.parse(text))
}
function digest(value) { return createHash('sha256').update(value).digest('hex') }
function snapshots(target) { return path.join(path.dirname(target), '.abl-revisions') }
const localActiveSpec = () => parseSpec(fs.readFileSync(process.env.MOCKMATE_ABL_PATH
  ? configTarget() : new URL('../../arch/mockmate.abl.json', import.meta.url), 'utf8'));
const revDigest = spec => digest(JSON.stringify(spec)).slice(0, 16)
function changedPaths(before, after, prefix = '', output = []) {
  if (JSON.stringify(before) === JSON.stringify(after) || output.length >= 60) return output
  if (before && after && typeof before === 'object' && typeof after === 'object' &&
      !Array.isArray(before) && !Array.isArray(after)) {
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
      if (output.length >= 60) break
      changedPaths(before[key], after[key], prefix ? prefix + '.' + key : key, output)
    }
  } else output.push(prefix || 'root')
  return output
}

/** Validate and compare a proposal without ever writing it to disk. */
export function previewAblRevision(input) {
  const proposed = typeof input === 'string' ? parseSpec(input) :
    parseSpec(JSON.stringify(structuredClone(input)))
  const current = localActiveSpec()
  const changed = changedPaths(current, proposed)
  return {
    changed: changed.length > 0,
    currentDigest: revDigest(current), proposedDigest: revDigest(proposed),
    changedPaths: changed,
    requiresLiveRetest: changed.some(p => /^(routing|runtime|capabilities\\.speech|answerQuality)/.test(p)),
    requiresPrivacyReview: changed.some(p => /^(policies|capabilities\\.telemetry)/.test(p)),
    risk: changed.length === 0 ? 'none' : changed.some(p => /^(routing|runtime|capabilities\\.speech|answerQuality)/.test(p))
      ? 'live_behavior' : 'configuration',
    note: 'Validation and change preview only. No policy was published or applied.',
  }
}

export function listAblRevisions() {
  const target = configTarget()
  const dir = snapshots(target)
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter(n => SAFE_REV.test(n.replace(/\.json$/, '')) && n.endsWith('.json'))
    .sort().reverse().slice(0, 30).map(n => n.slice(0, -5)) : []
}

export function currentAblPolicyStatus() {
  const target = process.env.MOCKMATE_ABL_PATH ? configTarget() : null
  const text = target ? fs.readFileSync(target, 'utf8') : fs.readFileSync(new URL('../../arch/mockmate.abl.json', import.meta.url), 'utf8')
  const spec = parseSpec(text)
  return { ablVersion: spec.ablVersion, revisionDigest: digest(JSON.stringify(spec)).slice(0, 16),
    source: target ? 'operator_override' : 'bundled_default',
    availableRollbackRevisions: target ? listAblRevisions().length : 0 }
}

export function applyAblRevision(input, { expectedDigest = null } = {}) {
  const target = configTarget()
  const next = typeof input === 'string' ? parseSpec(input) : validateAblSpec(structuredClone(input))
  const nextString = JSON.stringify(next, null, 2) + '\n'
  if (Buffer.byteLength(nextString) > MAX_BYTES) throw new Error('ABL configuration exceeds 128 KiB')
  const currentText = fs.readFileSync(target, 'utf8')
  const current = parseSpec(currentText)
  if (expectedDigest !== null && expectedDigest !== revDigest(current))
    throw new Error('Active policy changed since review; preview again before approval')
  if (digest(JSON.stringify(current)) === digest(JSON.stringify(next)))
    return { changed: false, ...currentAblPolicyStatus() }
  const dir = snapshots(target)
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  const rev = 'rev-' + Date.now() + '-' + randomUUID().replace(/-/g, '').slice(0, 8)
  const archive = { id: rev, savedAt: new Date().toISOString(), sourceDigest: digest(JSON.stringify(current)),
    spec: current }
  // Snapshot BEFORE replacement so power loss never destroys the previous
  // valid configuration. Never silently overwrite an existing revision.
  fs.writeFileSync(path.join(dir, rev + '.json'), JSON.stringify(archive) + '\n',
    { flag: 'wx', mode: 0o600 })
  const temporary = target + '.next-' + randomUUID()
  try {
    fs.writeFileSync(temporary, nextString, { flag: 'wx', mode: 0o600 })
    fs.renameSync(temporary, target)
  } finally { try { fs.rmSync(temporary, { force: true }) } catch {} }
  return { changed: true, previousRevision: rev, ...currentAblPolicyStatus() }
}

export function rollbackAblRevision(revision, { expectedDigest = null } = {}) {
  const target = configTarget()
  if (!SAFE_REV.test(String(revision))) throw new Error('Invalid rollback revision ID')
  const file = path.join(snapshots(target), revision + '.json')
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'))
  if (saved.id !== revision) throw new Error('Revision identity mismatch')
  const targetSpec = parseSpec(JSON.stringify(saved.spec))
  if (digest(JSON.stringify(targetSpec)) !== saved.sourceDigest)
    throw new Error('Archived revision failed integrity verification')
  return applyAblRevision(targetSpec, { expectedDigest })
}
