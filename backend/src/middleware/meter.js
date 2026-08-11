// Usage metering for the managed-AI proxy (Phase 2b). Runs AFTER requireAuth (needs req.userId).
//   checkCap  — pre-request gate: 402 if the user is over their monthly cap.
//   recordLlm — post-success hook: +1 AI response for the current period.
// Hosted (MONGO_URI): checkCap FAIL-CLOSED on store errors (503) — never burn MockMate keys uncapped.
// Local file-store: caps skipped (no Upgrade path on the desktop fork).
import { store, currentPeriod } from '../store.js'
import { limitFor } from '../plans.js'

export async function checkCap(req, res, next) {
  // Local file-store deployment = a single-user desktop running on their OWN (or the bundled) keys.
  // Metering a hard cap there is a dead-end — there's no way to upgrade locally, so a capped user
  // hits a wall mid-interview with no exit. Only enforce the cap on the hosted multi-tenant backend
  // (Mongo), where MockMate actually pays for managed usage and Upgrade/BYOK are real options.
  if (!process.env.MONGO_URI) { req._plan = 'local'; return next() }
  try {
    const user = await store().findUserById(req.userId)
    if (!user) return res.status(401).json({ error: 'Account not found' })
    const usage = await store().getUsage(req.userId, currentPeriod())
    const limit = limitFor(user.plan)
    if ((usage.llmCalls || 0) >= limit.llmCalls) {
      return res.status(402).json({
        error: "You've reached your monthly MockMate AI limit. Upgrade to Pro for unlimited, or add your own API key in Settings.",
        code: 'limit_reached',
      })
    }
    req._plan = user.plan
    next()
  } catch (e) {
    console.error('[meter] checkCap failed (blocking):', e.message)
    return res.status(503).json({
      error: 'Usage metering is temporarily unavailable. Try again in a moment, or switch to your own API key in Settings.',
      code: 'metering_unavailable',
    })
  }
}

// Fired by registerApiRoutes' onLlm hook after a successful LLM response.
export async function recordLlm(req) {
  try { await store().addUsage(req.userId, currentPeriod(), { llmCalls: 1 }) }
  catch (e) { console.error('[meter] recordLlm failed:', e.message) }
}
