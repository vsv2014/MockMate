import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const DEFAULT_ABL_PATH = fileURLToPath(new URL('../../arch/mockmate.abl.json', import.meta.url))
const SECRET_KEY_RE = /(api.?key|secret|password|credential|authorization|bearer|token)$/i
let cached = null
let cachedPath = null
let cachedMtime = 0

function assert(condition, message) {
  if (!condition) throw new Error(`Invalid MockMate ABL: ${message}`)
}

function rejectSecrets(value, trail = 'root') {
  if (!value || typeof value !== 'object') return
  for (const [key, child] of Object.entries(value)) {
    assert(!SECRET_KEY_RE.test(key), `credentials/secrets are forbidden (${trail}.${key})`)
    if (child && typeof child === 'object') rejectSecrets(child, `${trail}.${key}`)
  }
}

export function validateAblSpec(spec) {
  assert(spec && typeof spec === 'object' && !Array.isArray(spec), 'root must be an object')
  assert(/^\d+\.\d+$/.test(String(spec.ablVersion || '')), 'ablVersion must be major.minor')
  assert(typeof spec.application === 'string' && spec.application.trim(), 'application is required')
  assert(spec.policies?.credentials === 'never_in_abl', 'policies.credentials must be never_in_abl')

  const lanes = spec.capabilities?.reasoning?.lanes
  assert(Array.isArray(lanes) && lanes.length > 0, 'reasoning lanes are required')
  assert(new Set(lanes).size === lanes.length, 'reasoning lanes must be unique')

  const routing = spec.routing?.reasoning
  assert(routing && typeof routing === 'object', 'routing.reasoning is required')
  for (const [operation, lane] of Object.entries(routing)) {
    assert(lanes.includes(lane), `routing.reasoning.${operation} references unknown lane ${lane}`)
  }

  for (const kind of ['live', 'batch']) {
    const stt = spec.capabilities?.speech?.stt?.[kind]
    assert(stt && Array.isArray(stt.preferredModes), `speech.stt.${kind}.preferredModes is required`)
    assert(typeof stt.fallback === 'string' && stt.fallback, `speech.stt.${kind}.fallback is required`)
  }
  assert(spec.capabilities?.speech?.turnDetection, 'speech.turnDetection is required')
  assert(Array.isArray(spec.performance?.reportPercentiles), 'performance.reportPercentiles is required')
  rejectSecrets(spec)
  return spec
}

export function loadAblSpec({ force = false } = {}) {
  const ablPath = path.resolve(process.env.MOCKMATE_ABL_PATH || DEFAULT_ABL_PATH)
  const stat = fs.statSync(ablPath)
  if (!force && cached && cachedPath === ablPath && cachedMtime === stat.mtimeMs) return cached
  const parsed = JSON.parse(fs.readFileSync(ablPath, 'utf8'))
  cached = Object.freeze(validateAblSpec(parsed))
  cachedPath = ablPath
  cachedMtime = stat.mtimeMs
  return cached
}

export function compileAblRuntime() {
  const spec = loadAblSpec()
  return {
    ablVersion: spec.ablVersion,
    application: spec.application,
    persona: spec.persona,
    designGoals: [...(spec.designGoals || [])],
    reasoning: {
      lanes: [...spec.capabilities.reasoning.lanes],
      routing: { ...spec.routing.reasoning },
      executionAdapter: spec.policies.reasoningExecution,
      noDoubleRetry: spec.policies.noDoubleRetry === true,
    },
    speech: {
      stt: {
        live: { ...spec.capabilities.speech.stt.live },
        batch: { ...spec.capabilities.speech.stt.batch },
      },
      tts: { ...spec.capabilities.speech.tts },
      turnDetection: { ...spec.capabilities.speech.turnDetection },
      hotPath: spec.capabilities.speech.hotPath,
    },
    runtime: JSON.parse(JSON.stringify(spec.runtime || {})),
    telemetry: [...(spec.capabilities.telemetry?.metrics || [])],
    productIntelligence: JSON.parse(JSON.stringify(spec.capabilities.telemetry?.productIntelligence || {
      mode: 'structured_redacted',
      optInReplayDefault: false,
      flows: ['live_interview', 'solo_practice', 'screen_solve'],
    })),
    performance: JSON.parse(JSON.stringify(spec.performance || {})),
  }
}

export function _resetAblCacheForTests() {
  cached = null
  cachedPath = null
  cachedMtime = 0
}
