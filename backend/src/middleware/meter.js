// Usage metering for the managed-AI proxy. Runs after requireAuth.
import { store, currentPeriod } from '../store.js'
import { effectivePlan, limitFor, measureInputChars, estimateLlmUnits } from '../plans.js'

// Re-exported for existing consumers/tests; the definitions live in plans.js
// (single source of truth — blast-radius review fix).
export { measureInputChars, estimateLlmUnits }

/** Lease size reserved per streaming grant — matches the Deepgram grant TTL. */
// NOTE: the old read-only checkSttQuota gate was removed in b6494a9: /transcribe
// now reserves the server-probed media duration atomically before provider spend
// (the read-only check allowed "1s remaining → upload a long clip" overruns).
export const STT_GRANT_LEASE_SECONDS = 300

/**
 * STT lease reservation (round-6 review): replaces the read-only remaining-check
 * for the streaming-grant path. The lease is reserved ATOMICALLY (one conditional
 * update in Mongo; see store.reserveSttUsage) BEFORE the route mints the Deepgram
 * grant, so concurrent requests cannot all pass the same remaining-check and
 * overrun the allowance, and no grant can ever be returned unmetered. If minting
 * fails the route releases the lease via opts.onSttRelease. Skipped for local
 * device-local accounts (parity with checkCap); fail-closed like checkCap.
 */
export async function reserveSttLease(req, res, next) {
  if (!process.env.MONGO_URI) { req._sttLeaseSeconds = 0; return next() }
  try {
    const user = await store().findUserById(req.userId)
    if (!user) return res.status(401).json({ error: 'Your session expired. Please sign in again.', code: 'unauthorized' })
    const plan = effectivePlan(user)
    const period = currentPeriod()
    const limit = limitFor(plan).sttSeconds
    const reserved = await store().reserveSttUsage(req.userId, period, limit, STT_GRANT_LEASE_SECONDS)
    if (!reserved) {
      return res.status(402).json({
        error: 'You’ve used this month’s voice-transcription allowance. It resets next billing period, or upgrade for more.',
        code: 'stt_quota_exhausted',
        period,
      })
    }
    req._sttLeaseSeconds = STT_GRANT_LEASE_SECONDS
    next()
  } catch (e) {
    console.error('[meter] reserveSttLease failed (blocking):', e.message)
    return res.status(503).json({ error: 'Usage metering is temporarily unavailable. Try again in a moment.', code: 'metering_unavailable' })
  }
}

export async function checkCap(req, res, next) {
  if (!process.env.MONGO_URI) { req._plan = 'local'; return next() }
  try {
    const user = await store().findUserById(req.userId)
    if (!user) return res.status(401).json({ error: 'Account not found' })
    const plan = effectivePlan(user)
    const limit = limitFor(plan)
    const maxInputChars = limit?.maxInputChars || (plan === 'free' ? 80_000 : 320_000)
    const inputChars = measureInputChars(req.body)
    if (inputChars > maxInputChars) {
      return res.status(413).json({
        error: 'This request is too large for your current plan limit. Trim the attached text or upgrade your plan.',
        code: 'input_too_large',
      })
    }
    const units = estimateLlmUnits(req.body, req.path)
    const period = currentPeriod()
    const reserved = units > 1
      ? await store().reserveLlmUsage(req.userId, period, limit.llmCalls, units)
      : await store().reserveLlmUsage(req.userId, period, limit.llmCalls)
    if (!reserved) {
      return res.status(402).json({
        error: "You've reached your monthly MockMate AI limit. Upgrade to Pro for more usage, or add your own API key in Settings.",
        code: 'limit_reached',
      })
    }
    req._plan = plan
    req._llmReserved = true
    req._llmUnits = units
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
  const units = Math.max(1, Number(req._llmUnits) || 1)
  try { await store().addUsage(req.userId, req._llmPeriod || currentPeriod(), { llmCalls: units }) }
  catch (e) { console.error('[meter] recordLlm failed:', e.message) }
}

export async function releaseLlm(req) {
  if (!req._llmReserved) return
  req._llmReserved = false
  const units = Math.max(1, Number(req._llmUnits) || 1)
  try {
    if (units > 1) await store().releaseLlmUsage(req.userId, req._llmPeriod || currentPeriod(), units)
    else await store().releaseLlmUsage(req.userId, req._llmPeriod || currentPeriod())
  }
  catch (e) { console.error('[meter] releaseLlm failed:', e.message) }
}

export function enforceManagedModelPolicy(req, _res, next) {
  if (!process.env.MONGO_URI) return next()
  const allowedStrategy = req._plan === 'max' ? 'quality' : req._plan === 'pro' ? 'balanced' : 'fast'
  req.body = {
    ...(req.body || {}),
    provider: '',
    maxProviderAttempts: 2,
    profile: { ...(req.body?.profile || {}), modelStrategy: allowedStrategy },
  }
  next()
}
