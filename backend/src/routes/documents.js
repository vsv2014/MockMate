import { Router } from 'express'
import mongoose from 'mongoose'
import { Document, createDocumentWithCap } from '../models/Document.js'
import { requireAuth } from '../middleware/auth.js'
import { buildDocumentContext, validateDocumentPayload } from '../documentDraft.js'

const router = Router()

const metadata = document => ({
  id: String(document._id),
  name: document.name,
  type: document.type,
  chars: document.chars || document.text?.length || 0,
  createdAt: document.createdAt,
})

router.get('/', requireAuth, async (req, res) => {
  try {
    const documents = await Document.find({ user: req.userId }).sort({ createdAt: -1 }).select('-text')
    res.json({ documents: documents.map(metadata) })
  } catch (error) {
    console.error('[documents/list] failed:', error.message)
    res.status(503).json({ error: 'Could not load documents. Please try again.' })
  }
})

router.post('/', requireAuth, async (req, res) => {
  try {
    const { value, error } = validateDocumentPayload(req.body || {})
    if (error) return res.status(400).json({ error })
    const document = await createDocumentWithCap({ user: req.userId, ...value, chars: value.text.length })
    res.status(201).json({ document: metadata(document) })
  } catch (error) {
    if (error?.status === 409) return res.status(409).json({ error: error.message, code: error.code })
    console.error('[documents/create] failed:', error.message)
    res.status(500).json({ error: 'Could not save the document. Please try again.' })
  }
})

router.post('/context', requireAuth, async (req, res) => {
  try {
    const rawIds = [...new Set((Array.isArray(req.body?.documentIds) ? req.body.documentIds : []).map(String).map(id => id.trim()).filter(Boolean))].slice(0, 20)
    const question = typeof req.body?.question === 'string' ? req.body.question.slice(0, 4000) : ''
    if (!question.trim() || !rawIds.length) return res.json({ context: '' })
    if (!rawIds.every(mongoose.isValidObjectId)) return res.status(400).json({ error: 'One or more selected documents are invalid.' })
    const documents = await Document.find({ user: req.userId, _id: { $in: rawIds } }).select('name type text')
    if (documents.length !== rawIds.length) {
      return res.status(409).json({ error: 'One or more selected documents are no longer available. Refresh your document selection.', code: 'document_selection_stale' })
    }
    res.json({ context: buildDocumentContext(question, documents) })
  } catch (error) {
    console.error('[documents/context] failed:', error.message)
    res.status(503).json({ error: 'Could not load selected document context. Please try again.' })
  }
})

router.delete('/:id', requireAuth, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: 'Document not found.' })
    const result = await Document.deleteOne({ _id: req.params.id, user: req.userId })
    if (!result.deletedCount) return res.status(404).json({ error: 'Document not found.' })
    res.json({ ok: true })
  } catch (error) {
    console.error('[documents/delete] failed:', error.message)
    res.status(503).json({ error: 'Could not delete the document. Please try again.' })
  }
})

export default router
