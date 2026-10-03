// Single source of truth for classifying LLM/network errors.
// Provider retry/failover is owned by the server/core runtime. Browser clients must not
// recursively retry the whole MockMate request after core already exhausted its policy.

export function isRateLimit(e) {
  const s = e?.status ?? e?.statusCode
  return s === 429 || /\b429\b|rate.?limit|quota|resource.?exhausted/i.test(e?.message || '')
}

export function isQuotaExhausted(e) {
  return /insufficient_quota|exceeded your current quota|billing|not active|payment/i.test(e?.message || '') || e?.code === 'insufficient_quota'
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
