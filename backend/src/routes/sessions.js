import { Router } from 'express'
import { Session } from '../models/Session.js'
import { requireAuth } from '../middleware/auth.js'

const router = Router()

router.get('/', requireAuth, async (req, res) => {
  const sessions = await Session.find({ user: req.userId }).sort({ createdAt: -1 }).limit(50)
  res.json({ sessions })
})

router.post('/', requireAuth, async (req, res) => {
  const { mode, transcript, notes, score } = req.body || {}
  const session = await Session.create({ user: req.userId, mode, transcript, notes, score })
  res.status(201).json({ session })
})

router.delete('/:id', requireAuth, async (req, res) => {
  await Session.deleteOne({ _id: req.params.id, user: req.userId })
  res.json({ ok: true })
})

export default router
