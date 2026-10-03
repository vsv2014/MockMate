// Managed-AI plan caps. BYOK bypasses these because the user pays the provider directly.
export const PLAN_LIMITS = {
  free: { llmCalls: 40, sttSeconds: 30 * 60 },
  pro: { llmCalls: 100000, sttSeconds: 500 * 60 * 60 },
  max: { llmCalls: 100000, sttSeconds: 500 * 60 * 60 },
}

export function effectivePlan(user, now = Date.now()) {
  if (!user) return 'free'
  const expiry = user.planExpiry ? new Date(user.planExpiry).getTime() : null
  if (Number.isFinite(expiry) && expiry <= now) return 'free'
  return PLAN_LIMITS[user.plan] ? user.plan : 'free'
}

export function limitFor(plan) {
  return PLAN_LIMITS[plan] || PLAN_LIMITS.free
}
