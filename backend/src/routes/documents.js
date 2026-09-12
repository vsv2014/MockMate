import { Router } from 'express'
import mongoose from 'mongoose'
import { Document } from '../models/Document.js'
import { requireAuth } from '../middleware/auth.js'
import { buildDocumentContext, validateDocumentPayload } from '../documentDraft.js'

const router = Router()
const MAX_DOCUMENTS = 20

const metadata = document => ({
  id: String(document._id),
  name: document.name,
  type: document.type,
  chars: document.chars || document.text?.length || 0,
  createdAt: document.createdAt,
})

router.get('/', requireAuth, async (req, res) => {
  const documents = await Document.find({ user: req.userId }).sort({ createdAt: -1 }).select('-text')
  res.json({ documents: documents.map(metadata) })
})

router.post('/', requireAuth, async (req, res) => {
  try {
    const { value, error } = validateDocumentPayload(req.body || {})
    if (error) return res.status(400).json({ error })
    if (await Document.countDocuments({ user: req.userId }) >= MAX_DOCUMENTS) {
      return res.status(409).json({ error: `You can keep up to ${MAX_DOCUMENTS} hosted documents. Remove one before adding another.` })
    }
    const document = await Document.create({ user: req.userId, ...value, chars: value.text.length })
    res.status(201).json({ document: metadata(document) })
  } catch {
    res.status(500).json({ error: 'Could not save the document. Please try again.' })
  }
})

router.post('/context', requireAuth, async (req, res) => {
  const ids = [...new Set((Array.isArray(req.body?.documentIds) ? req.body.documentIds : []).map(String))]
    .filter(mongoose.isValidObjectId).slice(0, 20)
  const question = typeof req.body?.question === 'string' ? req.body.question.slice(0, 4000) : ''
  if (!question.trim() || !ids.length) return res.json({ context: '' })
  const documents = await Document.find({ user: req.userId, _id: { $in: ids } }).select('name type text')
  res.json({ context: buildDocumentContext(question, documents) })
})

router.delete('/:id', requireAuth, async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.json({ ok: true })
  await Document.deleteOne({ _id: req.params.id, user: req.userId })
  res.json({ ok: true })
})

export default router
