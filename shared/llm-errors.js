// Single source of truth for classifying LLM/network errors — used by BOTH the backend
// (api/_lib/core.js retry/failover) AND the client (Solo retry). Pure: takes an error-like
// object { status, statusCode, message, code }. Keeping one copy stops the server and client
// from retrying on different rules (they had drifted: the client missed 408/425/500/ECONN…).

export function isRateLimit(e) {
  const s = e?.status ?? e?.statusCode
  return s === 429 || /\b429\b|rate.?limit|quota|resource.?exhausted/i.test(e?.message || '')
}

// Out of CREDITS (not a transient rate-limit) — waiting won't help; tell the user plainly.
export function isQuotaExhausted(e) {
  return /insufficient_quota|exceeded your current quota|billing|not active|payment/i.test(e?.message || '') || e?.code === 'insufficient_quota'
}

// Transient upstream/network hiccup — provider overloaded / gateway / connection. Worth
// retrying (and failing over) rather than breaking the session. Covers the "503 (no body)"
// that kills long interviews, plus browser ("failed to fetch") + node (ECONNRESET…) forms.
export function isTransient(e) {
  const s = e?.status ?? e?.statusCode
  if (s === 408 || s === 425 || s === 500 || s === 502 || s === 503 || s === 504 || s === 529) return true
  return /\b50[0234]\b|\b529\b|overloaded|service unavailable|temporarily unavailable|timed? ?out|ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN|fetch failed|failed to fetch|socket hang up|network error/i.test(e?.message || '')
}
