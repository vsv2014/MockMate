// Single source of truth for classifying LLM/network errors used by the provider core and clients.
export function isRateLimit(e) {
  const s = e?.status ?? e?.statusCode
  return s === 429 || /\b429\b|rate.?limit|quota|resource.?exhausted/i.test(e?.message || '')
}

export function isQuotaExhausted(e) {
  return /insufficient_quota|exceeded your current quota|billing|not active|payment/i.test(e?.message || '') || e?.code === 'insufficient_quota'
}

// The provider core has already done its bounded retry/failover before surfacing these MockMate
// user-facing messages. Treating them as transient again in Solo would retry the whole request and
// double the latency/provider spend. Raw upstream/network failures remain transient for the core.
export function isProviderExhaustedError(e) {
  const m = String(e?.message || '')
  return /MockMate AI is temporarily unavailable|MockMate AI is busy right now|Couldn't reach MockMate AI right now|All your AI provider keys are rate-limited|Your AI provider is out of credits/i.test(m)
}

export function isTransient(e) {
  if (isProviderExhaustedError(e)) return false
  const s = e?.status ?? e?.statusCode
  if (s === 408 || s === 425 || s === 500 || s === 502 || s === 503 || s === 504 || s === 529) return true
  return /\b50[0234]\b|\b529\b|overloaded|service unavailable|temporarily unavailable|timed? ?out|ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN|fetch failed|failed to fetch|socket hang up|network error/i.test(e?.message || '')
}
