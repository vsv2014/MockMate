import { Router } from 'express'
import mongoose from 'mongoose'
import { Session } from '../models/Session.js'
import { Document } from '../models/Document.js'
import { requireAuth } from '../middleware/auth.js'
import { normalizeTranscript, validateSessionPayload } from '../sessionDraft.js'

const router = Router()
const MAX_SESSIONS_PER_USER = 500
const SUMMARY_FIELDS = 'mode title company role objective responseStyle selectedDocumentIds source score revision createdAt updatedAt'

async function validateOwnedDocumentIds(userId, ids) {
  if (!ids?.length) return true
  if (!ids.every(id => mongoose.isValidObjectId(id))) return false
  const count = await Document.countDocuments({ _id: { $in: ids }, user: userId })
  return count === ids.length
}

router.get('/', requireAuth, async (req, res) => {
  try {
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50))
    const before = req.query.before ? new Date(String(req.query.before)) : null
    const query = { user: req.userId }
    if (before && !Number.isNaN(before.getTime())) query.createdAt = { $lt: before }
    const sessions = await Session.find(query).select(SUMMARY_FIELDS).sort({ createdAt: -1 }).limit(limit)
    res.json({ sessions, nextBefore: sessions.length === limit ? sessions[sessions.length - 1].createdAt : null })
  } catch (error) {
    console.error('[sessions/list] failed:', error.message)
    res.status(503).json({ error: 'Could not load sessions. Please try again.' })
  }
})

router.get('/:id', requireAuth, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: 'Session not found.' })
    const session = await Session.findOne({ _id: req.params.id, user: req.userId })
    if (!session) return res.status(404).json({ error: 'Session not found.' })
    res.json({ session })
  } catch (error) {
    console.error('[sessions/get] failed:', error.message)
    res.status(503).json({ error: 'Could not load the session. Please try again.' })
  }
})

router.post('/', requireAuth, async (req, res) => {
  try {
    const count = await Session.countDocuments({ user: req.userId })
    if (count >= MAX_SESSIONS_PER_USER) {
      return res.status(409).json({ error: `Session history is limited to ${MAX_SESSIONS_PER_USER} hosted sessions. Delete old sessions before creating another.` })
    }
    const { value, error } = validateSessionPayload(req.body || {})
    if (error) return res.status(400).json({ error })
    if (!await validateOwnedDocumentIds(req.userId, value.selectedDocumentIds)) {
      return res.status(400).json({ error: 'One or more selected documents are invalid or no longer belong to this account.' })
    }
    const session = await Session.create({ user: req.userId, ...value })
    res.status(201).json({ session })
  } catch (error) {
    console.error('[sessions/create] failed:', error.message)
    res.status(500).json({ error: 'Could not create the session. Please try again.' })
  }
})

router.patch('/:id', requireAuth, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: 'Session not found.' })
    const body = req.body || {}
    const update = {}
    if ('transcript' in body) update.transcript = normalizeTranscript(body.transcript)
    if ('notes' in body) {
      if (typeof body.notes !== 'string') return res.status(400).json({ error: 'notes must be text.' })
      update.notes = body.notes.trim().slice(0, 8000)
    }
    if ('score' in body) {
      if (body.score !== null && (typeof body.score !== 'object' || Array.isArray(body.score))) return res.status(400).json({ error: 'score must be an object.' })
      if (body.score && JSON.stringify(body.score).length > 32_000) return res.status(400).json({ error: 'score is too large.' })
      update.score = body.score
    }
    if ('selectedDocumentIds' in body) {
      const ids = [...new Set((Array.isArray(body.selectedDocumentIds) ? body.selectedDocumentIds : []).map(String).map(v => v.trim()).filter(Boolean).slice(0, 50))]
      if (!await validateOwnedDocumentIds(req.userId, ids)) return res.status(400).json({ error: 'One or more selected documents are invalid.' })
      update.selectedDocumentIds = ids
    }

    const expectedRevision = Number.isInteger(body.expectedRevision) && body.expectedRevision >= 0 ? body.expectedRevision : null
    const filter = { _id: req.params.id, user: req.userId }
    if (expectedRevision !== null) filter.revision = expectedRevision
    const session = await Session.findOneAndUpdate(filter, { $set: update, $inc: { revision: 1 } }, { new: true, runValidators: true })
    if (!session) {
      if (expectedRevision !== null && await Session.exists({ _id: req.params.id, user: req.userId })) {
        return res.status(409).json({ error: 'This session changed on another device. Refresh before saving again.', code: 'revision_conflict' })
      }
      return res.status(404).json({ error: 'Session not found.' })
    }
    res.json({ session })
  } catch (error) {
    console.error('[sessions/update] failed:', error.message)
    res.status(500).json({ error: 'Could not update the session.' })
  }
})

router.delete('/:id', requireAuth, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: 'Session not found.' })
    const result = await Session.deleteOne({ _id: req.params.id, user: req.userId })
    if (!result.deletedCount) return res.status(404).json({ error: 'Session not found.' })
    res.json({ ok: true })
  } catch (error) {
    console.error('[sessions/delete] failed:', error.message)
    res.status(503).json({ error: 'Could not delete the session. Please try again.' })
  }
})

export default router
