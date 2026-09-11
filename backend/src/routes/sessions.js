import { Router } from 'express'
import { Session } from '../models/Session.js'
import { requireAuth } from '../middleware/auth.js'
import { validateSessionPayload } from '../sessionDraft.js'

const router = Router()

router.get('/', requireAuth, async (req, res) => {
  const sessions = await Session.find({ user: req.userId }).sort({ createdAt: -1 }).limit(50)
  res.json({ sessions })
})

router.post('/', requireAuth, async (req, res) => {
  try {
    const { value, error } = validateSessionPayload(req.body || {})
    if (error) return res.status(400).json({ error })
    const session = await Session.create({ user: req.userId, ...value })
    res.status(201).json({ session })
  } catch {
    res.status(500).json({ error: 'Could not create the session. Please try again.' })
  }
})

router.delete('/:id', requireAuth, async (req, res) => {
  await Session.deleteOne({ _id: req.params.id, user: req.userId })
  res.json({ ok: true })
})

export default router
