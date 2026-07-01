// Usage metering for the managed-AI proxy (Phase 2b). Runs AFTER requireAuth (needs req.userId).
//   checkCap  — pre-request gate: 402 if the user is over their monthly cap.
//   recordLlm — post-success hook: +1 AI response for the current period.
// Metering must never HARD-break a paid/working request on a store hiccup, so errors soft-pass
// on record and (conservatively) allow on a check failure.
import { store, currentPeriod } from '../store.js'
import { limitFor } from '../plans.js'

export async function checkCap(req, res, next) {
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
    console.error('[meter] checkCap failed (allowing):', e.message)
    next()   // never block a request because metering hiccuped
  }
}

// Fired by registerApiRoutes' onLlm hook after a successful LLM response.
export async function recordLlm(req) {
  try { await store().addUsage(req.userId, currentPeriod(), { llmCalls: 1 }) }
  catch (e) { console.error('[meter] recordLlm failed:', e.message) }
}
