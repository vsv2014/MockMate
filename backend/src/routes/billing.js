import { Router } from 'express'
import { store } from '../store.js'
import { requireAuth } from '../middleware/auth.js'
import { effectivePlan } from '../plans.js'

const router = Router()
let _stripe = null
async function stripe() {
  if (!process.env.STRIPE_SECRET_KEY) return null
  if (!_stripe) { const Stripe = (await import('stripe')).default; _stripe = new Stripe(process.env.STRIPE_SECRET_KEY) }
  return _stripe
}
const notConfigured = res => res.status(501).json({ error: 'Billing is not enabled on this server yet.' })
const PRO_STATUSES = new Set(['active', 'trialing', 'past_due'])
const entitled = sub => PRO_STATUSES.has(String(sub?.status || ''))

async function setPlan(user, plan, extra = {}) {
  if (!user) return null
  if (user.plan === plan && !Object.keys(extra).length) return user
  return store().updateUser(user.id, { plan, ...extra })
}

async function subscriptionsForCustomer(s, customerId) {
  if (!customerId) return []
  const page = await s.subscriptions.list({ customer: customerId, status: 'all', limit: 100 })
  return page.data || []
}

async function reconcileCustomerPlan(s, customerId) {
  if (!customerId) return null
  const user = await store().findUserByStripeCustomerId(customerId)
  if (!user) return null
  const subs = await subscriptionsForCustomer(s, customerId)
  const active = subs.filter(entitled)
  return setPlan(user, active.length ? 'pro' : 'free', { planExpiry: null })
}

export async function cancelUserSubscriptions(user) {
  if (!user?.stripeCustomerId) return { cancelled: 0 }
  const s = await stripe()
  if (!s) throw new Error('Billing is not configured; cannot safely delete a billed account.')
  const subs = await subscriptionsForCustomer(s, user.stripeCustomerId)
  let cancelled = 0
  for (const sub of subs) {
    if (['canceled', 'incomplete_expired'].includes(sub.status)) continue
    await s.subscriptions.cancel(sub.id)
    cancelled += 1
  }
  return { cancelled }
}

router.post('/checkout', requireAuth, async (req, res) => {
  const s = await stripe(); if (!s) return notConfigured(res)
  if (!process.env.STRIPE_PRICE_ID) return res.status(503).json({ error: 'Billing price is not configured.' })
  try {
    let user = await store().findUserById(req.userId)
    if (!user) return res.status(401).json({ error: 'Account not found' })
    if (['pro', 'max'].includes(effectivePlan(user))) {
      return res.status(409).json({ error: 'Your account already has an active paid plan. Use Manage subscription instead.' })
    }

    let customerId = user.stripeCustomerId
    if (customerId) {
      const active = (await subscriptionsForCustomer(s, customerId)).filter(entitled)
      if (active.length) {
        await setPlan(user, 'pro', { planExpiry: null })
        return res.status(409).json({ error: 'An active subscription already exists. Use Manage subscription instead.' })
      }
    }

    if (!customerId) {
      const customer = await s.customers.create({ email: user.email, metadata: { userId: String(user.id) } })
      customerId = customer.id
      try {
        user = await store().updateUser(user.id, { stripeCustomerId: customerId })
      } catch (error) {
        try { await s.customers.del(customerId) } catch {}
        throw error
      }
    }

    const session = await s.checkout.sessions.create({
      mode: 'subscription', customer: customerId, client_reference_id: String(user.id),
      line_items: [{ price: process.env.STRIPE_PRICE_ID, quantity: 1 }], allow_promotion_codes: true,
      success_url: (process.env.BILLING_SUCCESS_URL || 'https://mockmate.app/upgraded') + '?session_id={CHECKOUT_SESSION_ID}',
      cancel_url: process.env.BILLING_CANCEL_URL || 'https://mockmate.app/account',
    })
    res.json({ url: session.url })
  } catch (e) {
    console.error('[billing] checkout:', e.message)
    res.status(500).json({ error: 'Could not start checkout.' })
  }
})

router.post('/portal', requireAuth, async (req, res) => {
  const s = await stripe(); if (!s) return notConfigured(res)
  try {
    const user = await store().findUserById(req.userId)
    if (!user?.stripeCustomerId) return res.status(400).json({ error: 'No subscription yet.' })
    await reconcileCustomerPlan(s, user.stripeCustomerId).catch(() => null)
    const session = await s.billingPortal.sessions.create({
      customer: user.stripeCustomerId,
      return_url: process.env.BILLING_CANCEL_URL || 'https://mockmate.app/account',
    })
    res.json({ url: session.url })
  } catch (e) {
    console.error('[billing] portal:', e.message)
    res.status(500).json({ error: 'Could not open billing portal.' })
  }
})

router.post('/reconcile', requireAuth, async (req, res) => {
  const s = await stripe(); if (!s) return notConfigured(res)
  try {
    const user = await store().findUserById(req.userId)
    if (!user) return res.status(401).json({ error: 'Account not found' })
    if (!user.stripeCustomerId) return res.json({ reconciled: true, plan: effectivePlan(user) })
    const updated = await reconcileCustomerPlan(s, user.stripeCustomerId)
    res.json({ reconciled: true, plan: effectivePlan(updated || user) })
  } catch (e) {
    console.error('[billing] reconcile:', e.message)
    res.status(500).json({ error: 'Could not reconcile billing status.' })
  }
})

export async function stripeWebhook(req, res) {
  const s = await stripe(); if (!s) return res.status(501).end()
  if (!process.env.STRIPE_WEBHOOK_SECRET) return res.status(503).send('Stripe webhook secret is not configured')

  let event
  try {
    event = s.webhooks.constructEvent(req.body, req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET)
  } catch (e) {
    console.error('[billing] webhook signature:', e.message)
    return res.status(400).send('Webhook signature invalid')
  }

  try {
    if (event.type === 'checkout.session.completed') {
      const sess = event.data.object
      const user = sess.client_reference_id ? await store().findUserById(sess.client_reference_id).catch(() => null) : null
      if (!user) {
        console.warn('[billing] checkout completed with no resolvable user:', sess.client_reference_id)
      } else {
        if (sess.customer && user.stripeCustomerId !== sess.customer) {
          await store().updateUser(user.id, { stripeCustomerId: sess.customer })
        }
        // A Checkout completion alone is not an entitlement. Verify the actual subscription.
        if (sess.subscription) {
          const sub = await s.subscriptions.retrieve(sess.subscription)
          await setPlan(user, entitled(sub) ? 'pro' : 'free', { stripeCustomerId: sess.customer, planExpiry: null })
        }
      }
    } else if (event.type === 'customer.subscription.deleted' || event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.created') {
      // Reconcile all current subscriptions for the customer. This is robust to webhook
      // reordering, duplicate delivery and customers that somehow own >1 subscription.
      await reconcileCustomerPlan(s, event.data.object.customer)
    }
    res.json({ received: true })
  } catch (e) {
    console.error('[billing] webhook handler:', e.message)
    res.status(500).end()
  }
}

export default router
