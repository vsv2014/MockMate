import { Router } from 'express'
import { store, toSafeUser } from '../store.js'
import { requireAuth } from '../middleware/auth.js'
import { cancelUserSubscriptions } from './billing.js'

const router = Router()
const text = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : null

router.get('/', requireAuth, async (req, res) => {
  try {
    const user = await store().findUserById(req.userId)
    if (!user) return res.status(404).json({ error: 'Account not found' })
    res.json({ user: toSafeUser(user) })
  } catch (error) {
    console.error('[me/get] failed:', error.message)
    res.status(503).json({ error: 'Could not load your profile. Please try again.' })
  }
})

router.patch('/', requireAuth, async (req, res) => {
  try {
    const body = req.body || {}
    const update = {}
    const limits = { name: 160, currentRole: 200, targetRole: 200, yearsExp: 40, language: 80, resume: 300_000 }
    for (const [key, max] of Object.entries(limits)) {
      if (!(key in body)) continue
      if (typeof body[key] !== 'string') return res.status(400).json({ error: `${key} must be text.` })
      update[key] = text(body[key], max)
    }
    if ('preferences' in body) {
      if (!body.preferences || typeof body.preferences !== 'object' || Array.isArray(body.preferences)) {
        return res.status(400).json({ error: 'preferences must be an object.' })
      }
      const encoded = JSON.stringify(body.preferences)
      if (encoded.length > 32_000) return res.status(400).json({ error: 'preferences are too large.' })
      update.preferences = body.preferences
    }
    const user = await store().updateUser(req.userId, update)
    if (!user) return res.status(404).json({ error: 'Account not found' })
    res.json({ user: toSafeUser(user) })
  } catch (error) {
    console.error('[me/patch] failed:', error.message)
    res.status(500).json({ error: 'Could not update your profile. Please try again.' })
  }
})

router.delete('/', requireAuth, async (req, res) => {
  try {
    const user = await store().findUserById(req.userId)
    if (!user) return res.status(404).json({ error: 'Account not found' })

    // Billing must be stopped before identity/data are removed. If Stripe cannot be
    // reached we fail the deletion rather than orphan a still-billable subscription.
    await cancelUserSubscriptions(user)

    if (process.env.MONGO_URI) {
      const [{ Session }, { Document }] = await Promise.all([
        import('../models/Session.js'),
        import('../models/Document.js'),
      ])
      await Promise.all([
        Session.deleteMany({ user: req.userId }),
        Document.deleteMany({ user: req.userId }),
      ])
    }
    const deleted = await store().deleteUser(req.userId)
    if (!deleted) return res.status(404).json({ error: 'Account not found' })
    res.json({ ok: true })
  } catch (error) {
    console.error('[me/delete] failed:', error.message)
    res.status(500).json({ error: 'Could not delete the account safely. Please try again.' })
  }
})

export default router
