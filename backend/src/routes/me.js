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

export default router
