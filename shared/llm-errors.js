// Single source of truth for classifying LLM/network errors.
// Provider retry/failover is owned by the server/core runtime. Browser clients must not
// recursively retry the whole MockMate request after core already exhausted its policy.

const MAX_RETRY_AFTER_MS = 24 * 60 * 60 * 1000

export function isQuotaExhausted(e) {
  const code = String(e?.code || '').toLowerCase().replace(/[\s-]+/g, '_')
  if (['insufficient_quota', 'quota_exceeded', 'billing_hard_limit_reached'].includes(code)) return true

  const message = String(e?.message || '')
  return /insufficient[_\s-]*quota|exceeded your current quota|(?:quota|credits?)[\s\S]{0,48}(?:exceeded|exhausted|insufficient|used up)|(?:exceeded|exhausted|used up)[\s\S]{0,48}(?:quota|credits?)|out of credits|no remaining credits|payment required|billing account[\s\S]{0,32}(?:inactive|disabled|suspended)|(?:account|project)[\s\S]{0,32}(?:not active|payment required)/i.test(message)
}

export function isRateLimit(e) {
  // Some providers use HTTP 429 for exhausted paid usage. Report that as a quota/billing
  // condition, not a transient request-rate limit.
  if (isQuotaExhausted(e)) return false
  const s = e?.status ?? e?.statusCode
  if (s === 429) return true
  return /\b429\b|rate.?limit|too many requests|requests per minute|tokens per minute|resource[_\s-]+exhausted/i.test(e?.message || '')
}

export function isTransient(e) {
  // Client components such as Solo historically used this helper to retry the entire HTTP
  // operation, duplicating the provider/core retry chain. Keep transient retry ownership in
  // Node; clients receive one final success/failure and preserve their session state.
  if (typeof window !== 'undefined') return false
  const s = e?.status ?? e?.statusCode
  if (s === 408 || s === 425 || s === 500 || s === 502 || s === 503 || s === 504 || s === 529) return true
  return /\b50[0234]\b|\b529\b|overloaded|service unavailable|temporarily unavailable|timed? ?out|ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN|fetch failed|failed to fetch|socket hang up|network error/i.test(e?.message || '')
}

function headerValue(headers, name) {
  if (!headers) return null
  try {
    if (typeof headers.get === 'function') return headers.get(name)
    const key = Object.keys(headers).find(candidate => candidate.toLowerCase() === name.toLowerCase())
    return key ? headers[key] : null
  } catch { return null }
}

function parseDurationMs(value) {
  const text = String(value || '').trim()
  if (!text) return 0
  if (/^\d+(?:\.\d+)?$/.test(text)) return Number(text) * 1000

  // Common reset headers use values like "1s" or "6m0s". Accept compact sequences
  // of ms/s/m/h values without interpreting arbitrary provider prose as a duration.
  const compact = text.replace(/\s+/g, '')
  const parts = [...compact.matchAll(/(\d+(?:\.\d+)?)(ms|s|m|h)/gi)]
  if (!parts.length || parts.map(part => part[0]).join('') !== compact) return 0
  const scales = { ms: 1, s: 1000, m: 60_000, h: 3_600_000 }
  return parts.reduce((total, part) => total + Number(part[1]) * scales[part[2].toLowerCase()], 0)
}

/**
 * Read common provider retry/reset metadata. Returns milliseconds, or 0 when the provider did
 * not give a usable duration. The one-day cap protects against malformed/custom endpoint headers.
 */
export function getRetryAfterMs(error, now = Date.now()) {
  const headers = error?.headers || error?.response?.headers || error?.response?.response?.headers
  const candidates = []
  const explicit = Number(error?.retryAfterMs)
  if (Number.isFinite(explicit) && explicit > 0) candidates.push(explicit)

  const retryAfterMs = headerValue(headers, 'retry-after-ms')
  const retryAfter = headerValue(headers, 'retry-after')
  const requestReset = headerValue(headers, 'x-ratelimit-reset-requests')
  const tokenReset = headerValue(headers, 'x-ratelimit-reset-tokens')
  const genericReset = headerValue(headers, 'x-ratelimit-reset')
  if (retryAfterMs != null && Number.isFinite(Number(retryAfterMs))) candidates.push(Number(retryAfterMs))
  if (retryAfter != null) {
    const seconds = parseDurationMs(retryAfter)
    if (seconds > 0) candidates.push(seconds)
    else {
      const timestamp = Date.parse(String(retryAfter))
      if (Number.isFinite(timestamp) && timestamp > now) candidates.push(timestamp - now)
    }
  }
  for (const reset of [requestReset, tokenReset, genericReset]) {
    const duration = parseDurationMs(reset)
    if (duration > 0) candidates.push(duration)
  }

  if (!candidates.length) return 0
  return Math.max(1, Math.min(MAX_RETRY_AFTER_MS, Math.max(...candidates)))
}
