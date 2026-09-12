import { Router } from 'express'
import { Session } from '../models/Session.js'
import { requireAuth } from '../middleware/auth.js'
import { normalizeTranscript, validateSessionPayload } from '../sessionDraft.js'

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

router.patch('/:id', requireAuth, async (req, res) => {
  try {
    const update = {}
    if ('transcript' in (req.body || {})) update.transcript = normalizeTranscript(req.body.transcript)
    if (typeof req.body?.notes === 'string') update.notes = req.body.notes.trim().slice(0, 8000)
    if (req.body?.score && typeof req.body.score === 'object') update.score = req.body.score
    const session = await Session.findOneAndUpdate({ _id: req.params.id, user: req.userId }, update, { new: true })
    if (!session) return res.status(404).json({ error: 'Session not found.' })
    res.json({ session })
  } catch {
    res.status(400).json({ error: 'Could not update the session.' })
  }
})

router.delete('/:id', requireAuth, async (req, res) => {
  await Session.deleteOne({ _id: req.params.id, user: req.userId })
  res.json({ ok: true })
})

export default router
