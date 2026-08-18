/**
 * Vision call policy — cooldown, error classification, single-flight, budget.
 * Used by screen analysis only. Does not affect Solo or Live text routing.
 */
import { isRateLimit, isQuotaExhausted, isTransient } from '../../shared/llm-errors.js'

export const VISION_COOLDOWN_MS = 90_000
export const VISION_TRANSIENT_ATTEMPTS = 2 // per provider for 5xx/timeout only — never for 429

/** @type {Map<string, { last429At: number, cooldownUntil: number, failureCount: number }>} */
const cooldownByProvider = new Map()

/** @type {Map<string, { requestId: string, promise: Promise<any>, startedAt: number }>} */
const inflightByKey = new Map()

export function _resetVisionStateForTests() {
  cooldownByProvider.clear()
  inflightByKey.clear()
}

export function getVisionCooldown(providerId) {
  return cooldownByProvider.get(providerId) || null
}

export function markVision429(providerId, now = Date.now(), ms = VISION_COOLDOWN_MS) {
  if (!providerId) return
  const prev = cooldownByProvider.get(providerId) || { last429At: 0, cooldownUntil: 0, failureCount: 0 }
  const next = {
    last429At: now,
    cooldownUntil: now + ms,
    failureCount: (prev.failureCount || 0) + 1,
  }
  cooldownByProvider.set(providerId, next)
  return next
}

export function markVisionSuccess(providerId) {
  if (!providerId) return
  const prev = cooldownByProvider.get(providerId)
  if (prev) cooldownByProvider.set(providerId, { ...prev, failureCount: 0, cooldownUntil: 0 })
}

export function isVisionCooling(providerId, now = Date.now()) {
  const c = cooldownByProvider.get(providerId)
  return !!(c && c.cooldownUntil > now)
}

/** Ban sibling slots that share the same API key (not cross-vendor). */
export function markVision429Family(providerId, now = Date.now()) {
  markVision429(providerId, now)
  if (String(providerId).startsWith('gemini')) {
    markVision429('gemini', now)
    markVision429('gemini_flash_lite', now)
  }
  if (String(providerId).startsWith('openai')) {
    markVision429('openai', now)
    markVision429('openai_mini', now)
  }
}

/**
 * @returns {'rate'|'auth'|'bad_request'|'timeout'|'transient'|'empty'|'cancelled'|'quota'|'other'}
 */
export function classifyVisionError(e) {
  if (!e) return 'other'
  if (e.name === 'AbortError' || e.code === 'ABORT_ERR' || /aborted|cancelled/i.test(e.message || '')) return 'cancelled'
  const s = e.status ?? e.statusCode
  if (s === 401 || s === 403) return 'auth'
  if (s === 400 || s === 404 || s === 422) return 'bad_request'
  if (isQuotaExhausted(e)) return 'quota'
  if (isRateLimit(e) || s === 429) return 'rate'
  if (s === 408 || /timed? ?out|ETIMEDOUT/i.test(e.message || '')) return 'timeout'
  if (isTransient(e)) return 'transient'
  if (/no response|empty/i.test(e.message || '')) return 'empty'
  return 'other'
}

export function shouldRetryVisionAttempt(kind, attemptIndex) {
  // Never retry 429 on the same provider — failover instead.
  if (kind === 'rate' || kind === 'auth' || kind === 'bad_request' || kind === 'cancelled' || kind === 'quota') return false
  if (kind === 'timeout' || kind === 'transient' || kind === 'empty') return attemptIndex + 1 < VISION_TRANSIENT_ATTEMPTS
  return false
}

export function shouldFailoverVision(kind) {
  return kind === 'rate' || kind === 'timeout' || kind === 'transient' || kind === 'empty' || kind === 'other'
}

export function visionError(code, message, status) {
  const e = new Error(message)
  e.status = status
  e.code = code
  return e
}

export function makeVisionRateLimitedError(managed = false) {
  return visionError(
    'VISION_RATE_LIMITED',
    managed
      ? 'Screen analysis is busy right now. Please try again in a moment.'
      : 'Vision model is rate-limited. Add a second vision key (e.g. a free GEMINI_API_KEY) so screen analysis can fail over, or try again in a moment.',
    429,
  )
}

export function makeVisionUnavailableError(managed = false) {
  return visionError(
    'VISION_UNAVAILABLE',
    managed
      ? 'Screen analysis is temporarily unavailable. Please try again, or add your own OpenAI/Gemini key in Settings (⚙).'
      : 'Screen analysis needs a vision-capable model — add OpenAI/Gemini in ⚙ Settings, or configure GROQ_VISION_MODEL / VISION_API_KEY for a compatible vision model.',
    400,
  )
}

/**
 * Filter provider list by per-provider cooldown (independent vendors stay available).
 */
export function filterVisionProviders(providers, now = Date.now()) {
  const list = Array.isArray(providers) ? providers : []
  const ready = list.filter(p => p?.id && !isVisionCooling(p.id, now))
  // If every provider is cooling, return empty — caller emits VISION_RATE_LIMITED.
  return ready
}

/**
 * Single-flight: identical in-flight screen keys share one promise.
 * A newer requestId for the same fingerprint supersedes (caller should abort old work).
 */
export function runVisionSingleFlight(key, requestId, work) {
  const k = String(key || 'vision')
  const existing = inflightByKey.get(k)
  if (existing && existing.requestId === requestId) return existing.promise
  // Different request for same fingerprint: let the new one win; old promise continues
  // until aborted by the client/signal — we replace the map entry.
  const promise = Promise.resolve()
    .then(() => work())
    .finally(() => {
      const cur = inflightByKey.get(k)
      if (cur && cur.requestId === requestId) inflightByKey.delete(k)
    })
  inflightByKey.set(k, { requestId: requestId || k, promise, startedAt: Date.now() })
  return promise
}

export function estimateImageBytes(base64) {
  const s = String(base64 || '')
  if (!s) return 0
  // base64 length ≈ 4/3 of bytes; ignore data-URL prefix if present
  const raw = s.includes(',') ? s.slice(s.indexOf(',') + 1) : s
  return Math.floor((raw.length * 3) / 4)
}

/** Dev telemetry — never includes keys or raw image. */
export function visionTelemetry(partial = {}) {
  return {
    screenRequestId: partial.screenRequestId || null,
    provider: partial.provider || null,
    attempt: partial.attempt ?? null,
    imageBytes: partial.imageBytes ?? null,
    imageDimensions: partial.imageDimensions || null,
    status: partial.status || null,
    latencyMs: partial.latencyMs ?? null,
    is429: !!partial.is429,
    cooldown: partial.cooldown || null,
    failover: !!partial.failover,
    repairAttempt: !!partial.repairAttempt,
    repairType: partial.repairType || null, // 'text' | null — never 'image'
    cancelled: !!partial.cancelled,
  }
}
