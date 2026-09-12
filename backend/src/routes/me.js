import { Router } from 'express'
import { store, toSafeUser } from '../store.js'
import { requireAuth } from '../middleware/auth.js'

const router = Router()

// GET /me → { user }
router.get('/', requireAuth, async (req, res) => {
  const user = await store().findUserById(req.userId)
  if (!user) return res.status(404).json({ error: 'Account not found' })
  res.json({ user: toSafeUser(user) })
})

// PATCH /me — onboarding/profile fields only (never email/password/plan here).
router.patch('/', requireAuth, async (req, res) => {
  const allowed = ['name', 'currentRole', 'targetRole', 'yearsExp', 'language', 'resume', 'preferences']
  const update = {}
  for (const k of allowed) if (k in (req.body || {})) update[k] = req.body[k]
  const user = await store().updateUser(req.userId, update)
  if (!user) return res.status(404).json({ error: 'Account not found' })
  res.json({ user: toSafeUser(user) })
})

// DELETE /me — permanently removes the account and user-owned hosted data.
router.delete('/', requireAuth, async (req, res) => {
  try {
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
    res.status(500).json({ error: 'Could not delete the account. Please try again.' })
  }
})

export default router
