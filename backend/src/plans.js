// Managed-AI plan caps. BYOK bypasses these because the user pays the provider directly.
export const PLAN_LIMITS = {
  free: { llmCalls: 40, sttSeconds: 30 * 60, maxInputChars: 80_000 },
  pro: { llmCalls: 100000, sttSeconds: 500 * 60 * 60, maxInputChars: 320_000 },
  max: { llmCalls: 100000, sttSeconds: 500 * 60 * 60, maxInputChars: 320_000 },
}

const MULTI_CALL_PATHS = new Set(['/api/report', '/api/evaluate', '/api/tailor-resume', '/api/match-jobs'])
const CHARS_PER_UNIT = 12_000

export function effectivePlan(user, now = Date.now()) {
  if (!user) return 'free'
  const expiry = user.planExpiry ? new Date(user.planExpiry).getTime() : null
  if (Number.isFinite(expiry) && expiry <= now) return 'free'
  return PLAN_LIMITS[user.plan] ? user.plan : 'free'
}

export function limitFor(plan) {
  return PLAN_LIMITS[plan] || PLAN_LIMITS.free
}

export function measureInputChars(body) {
  if (!body || typeof body !== 'object') return 0
  try { return JSON.stringify(body).length } catch { return 0 }
}

export function estimateLlmUnits(body = {}, path = '') {
  const chars = measureInputChars(body)
  const sizeUnits = Math.max(1, Math.ceil(chars / CHARS_PER_UNIT))
  const multiStageBonus = MULTI_CALL_PATHS.has(String(path || '')) ? 1 : 0
  return Math.min(5, sizeUnits + multiStageBonus)
}
