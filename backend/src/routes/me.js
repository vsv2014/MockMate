import { Router } from 'express'
import { User } from '../models/User.js'
import { requireAuth } from '../middleware/auth.js'

const router = Router()

router.get('/', requireAuth, async (req, res) => {
  const user = await User.findById(req.userId)
  if (!user) return res.status(404).json({ error: 'User not found' })
  res.json({ user: user.toSafeJSON() })
})

// PATCH /me — update profile fields only (never email/password here)
router.patch('/', requireAuth, async (req, res) => {
  const allowed = ['name', 'targetRole', 'language', 'resume', 'preferences']
  const update = {}
  for (const k of allowed) if (k in (req.body || {})) update[k] = req.body[k]
  const user = await User.findByIdAndUpdate(req.userId, update, { new: true })
  res.json({ user: user.toSafeJSON() })
})

export default router
