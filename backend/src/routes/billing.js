// Stripe billing (Phase 2c). Turns the metered 402 into a real "Upgrade to Pro" purchase and
// flips user.plan free↔pro via webhooks. Stripe is LAZY-loaded and CONFIG-gated: with no
// STRIPE_SECRET_KEY the routes return 501 and the SDK is never imported (local boot stays clean).
import { Router } from 'express'
import { store } from '../store.js'
import { requireAuth } from '../middleware/auth.js'

const router = Router()

let _stripe = null
async function stripe() {
  if (!process.env.STRIPE_SECRET_KEY) return null
  if (!_stripe) { const Stripe = (await import('stripe')).default; _stripe = new Stripe(process.env.STRIPE_SECRET_KEY) }
  return _stripe
}
const notConfigured = res => res.status(501).json({ error: 'Billing is not enabled on this server yet.' })

// Which Stripe subscription statuses entitle the user to Pro. `past_due` stays Pro through the
// dunning/grace window (Stripe is still retrying the charge) — real cancellation arrives as
// `customer.subscription.deleted`. `incomplete`/`unpaid`/`canceled` → free.
const PRO_STATUSES = new Set(['active', 'trialing', 'past_due'])
const planForStatus = status => (PRO_STATUSES.has(status) ? 'pro' : 'free')

// Set a user's plan only when it actually changes — avoids redundant writes on Stripe's frequent
// subscription.updated events, and keeps the flip idempotent under retries/duplicate deliveries.
async function setPlan(user, plan, extra) {
  if (!user) return
  if (user.plan === plan && !extra) return
  await store().updateUser(user.id, { plan, ...extra })
}

// POST /billing/checkout → Stripe Checkout URL for the Pro subscription. Authed.
router.post('/checkout', requireAuth, async (req, res) => {
  const s = await stripe(); if (!s) return notConfigured(res)
  try {
    const user = await store().findUserById(req.userId)
    if (!user) return res.status(401).json({ error: 'Account not found' })
    let customerId = user.stripeCustomerId
    if (!customerId) {
      const c = await s.customers.create({ email: user.email, metadata: { userId: String(user.id) } })
      customerId = c.id
      await store().updateUser(user.id, { stripeCustomerId: customerId })
    }
    const session = await s.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      client_reference_id: String(user.id),
      line_items: [{ price: process.env.STRIPE_PRICE_ID, quantity: 1 }],
      allow_promotion_codes: true,
      success_url: (process.env.BILLING_SUCCESS_URL || 'https://mockmate.app/upgraded') + '?session_id={CHECKOUT_SESSION_ID}',
      cancel_url: process.env.BILLING_CANCEL_URL || 'https://mockmate.app/account',
    })
    res.json({ url: session.url })
  } catch (e) { console.error('[billing] checkout:', e.message); res.status(500).json({ error: 'Could not start checkout.' }) }
})

// POST /billing/portal → Stripe Customer Portal (manage/cancel). Authed.
router.post('/portal', requireAuth, async (req, res) => {
  const s = await stripe(); if (!s) return notConfigured(res)
  try {
    const user = await store().findUserById(req.userId)
    if (!user?.stripeCustomerId) return res.status(400).json({ error: 'No subscription yet.' })
    const session = await s.billingPortal.sessions.create({
      customer: user.stripeCustomerId,
      return_url: process.env.BILLING_CANCEL_URL || 'https://mockmate.app/account',
    })
    res.json({ url: session.url })
  } catch (e) { console.error('[billing] portal:', e.message); res.status(500).json({ error: 'Could not open billing portal.' }) }
})

// POST /billing/webhook — Stripe events (mounted with express.raw in server.js so the signature
// verifies against the RAW body). Flips plan on subscribe/cancel.
export async function stripeWebhook(req, res) {
  const s = await stripe(); if (!s) return res.status(501).end()
  let event
  try {
    event = s.webhooks.constructEvent(req.body, req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET)
  } catch (e) { console.error('[billing] webhook signature:', e.message); return res.status(400).send(`Webhook Error: ${e.message}`) }
  try {
    if (event.type === 'checkout.session.completed') {
      const sess = event.data.object
      // Resolve the user first (bad/foreign client_reference_id → CastError in Mongo mode otherwise).
      const u = sess.client_reference_id ? await store().findUserById(sess.client_reference_id).catch(() => null) : null
      if (u) await setPlan(u, 'pro', { stripeCustomerId: sess.customer, planExpiry: null })
      else console.warn('[billing] checkout.session.completed with no resolvable user:', sess.client_reference_id)
    } else if (event.type === 'customer.subscription.deleted') {
      await setPlan(await store().findUserByStripeCustomerId(event.data.object.customer), 'free')
    } else if (event.type === 'customer.subscription.updated') {
      const sub = event.data.object
      await setPlan(await store().findUserByStripeCustomerId(sub.customer), planForStatus(sub.status))
    }
    res.json({ received: true })
  } catch (e) { console.error('[billing] webhook handler:', e.message); res.status(500).end() }
}

export default router
