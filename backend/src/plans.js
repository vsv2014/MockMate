// Managed-AI plan caps (Phase 2b). Metered per calendar month (see store.currentPeriod()).
//   llmCalls   — AI responses (interview turns, hints, evaluations, jobs, resume tools)
//   sttSeconds — live voice transcription seconds
// Free is deliberately tight (MockMate pays for managed usage). Pro is effectively unlimited
// under a fair-use ceiling. BYOK users bypass all of this (their own key, their own bill).
export const PLAN_LIMITS = {
  free: { llmCalls: 40, sttSeconds: 30 * 60 },
  pro:  { llmCalls: 100000, sttSeconds: 500 * 60 * 60 },   // fair-use ceiling, not a hard product limit
}

export function limitFor(plan) {
  return PLAN_LIMITS[plan] || PLAN_LIMITS.free
}
