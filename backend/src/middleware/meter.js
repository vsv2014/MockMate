// Usage metering for the managed-AI proxy. Runs after requireAuth.
import { store, currentPeriod } from '../store.js'
import { effectivePlan, limitFor } from '../plans.js'

export async function checkCap(req, res, next) {
  if (!process.env.MONGO_URI) { req._plan = 'local'; return next() }
  try {
    const user = await store().findUserById(req.userId)
    if (!user) return res.status(401).json({ error: 'Account not found' })
    const plan = effectivePlan(user)
    const limit = limitFor(plan)
    const period = currentPeriod()
    const reserved = await store().reserveLlmUsage(req.userId, period, limit.llmCalls)
    if (!reserved) {
      return res.status(402).json({
        error: "You've reached your monthly MockMate AI limit. Upgrade to Pro for more usage, or add your own API key in Settings.",
        code: 'limit_reached',
      })
    }
    req._plan = plan
    req._llmReserved = true
    req._llmPeriod = period
    next()
  } catch (e) {
    console.error('[meter] checkCap failed (blocking):', e.message)
    return res.status(503).json({
      error: 'Usage metering is temporarily unavailable. Try again in a moment, or switch to your own API key in Settings.',
      code: 'metering_unavailable',
    })
  }
}

export async function recordLlm(req) {
  if (req._llmReserved) { req._llmReserved = false; return }
  try { await store().addUsage(req.userId, req._llmPeriod || currentPeriod(), { llmCalls: 1 }) }
  catch (e) { console.error('[meter] recordLlm failed:', e.message) }
}

export async function releaseLlm(req) {
  if (!req._llmReserved) return
  req._llmReserved = false
  try { await store().releaseLlmUsage(req.userId, req._llmPeriod || currentPeriod()) }
  catch (e) { console.error('[meter] releaseLlm failed:', e.message) }
}

export function enforceManagedModelPolicy(req, _res, next) {
  if (!process.env.MONGO_URI) return next()
  const allowedStrategy = req._plan === 'max' ? 'quality' : req._plan === 'pro' ? 'balanced' : 'fast'
  req.body = { ...(req.body || {}), provider: '', profile: { ...(req.body?.profile || {}), modelStrategy: allowedStrategy } }
  next()
}
