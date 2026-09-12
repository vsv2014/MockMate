import { Router } from 'express'
import multer from 'multer'
import mammoth from 'mammoth'
import { PDFParse } from 'pdf-parse'
import { requireAuth } from '../middleware/auth.js'
import { Document } from '../models/Document.js'

const router = Router()
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
})
const TYPES = new Set(['resume', 'jd', 'knowledge', 'supporting', 'training', 'document'])

export async function extractText(file) {
  if (file.mimetype === 'application/pdf' || file.originalname.toLowerCase().endsWith('.pdf')) {
    const parser = new PDFParse({ data: file.buffer })
    try { return (await parser.getText()).text }
    finally { await parser.destroy() }
  }
  if (file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    || file.originalname.toLowerCase().endsWith('.docx')) {
    return (await mammoth.extractRawText({ buffer: file.buffer })).value
  }
  if (file.mimetype.startsWith('text/') || /\.(txt|md)$/i.test(file.originalname)) {
    return file.buffer.toString('utf8')
  }
  const error = new Error('Choose a PDF, DOCX, TXT or Markdown document.')
  error.status = 415
  throw error
}

router.post('/', requireAuth, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Choose a document to upload.' })
  const count = await Document.countDocuments({ user: req.userId })
  if (count >= 20) return res.status(409).json({ error: 'You can keep up to 20 hosted documents. Remove one before adding another.' })

  try {
    const text = (await extractText(req.file)).replace(/\u0000/g, '').trim()
    if (!text) return res.status(422).json({ error: 'No readable text was found in this document.' })
    if (text.length > 300_000) return res.status(413).json({ error: 'The extracted document is too long (maximum 300,000 characters).' })
    const type = TYPES.has(req.body?.type) ? req.body.type : 'document'
    const name = String(req.body?.name || req.file.originalname).trim().slice(0, 180)
    const document = await Document.create({ user: req.userId, name, type, text, chars: text.length })
    res.status(201).json({ document: { id: String(document._id), name: document.name, type: document.type, chars: document.chars, createdAt: document.createdAt } })
  } catch (error) {
    console.error('[documents/upload] extraction failed:', error.message)
    res.status(error.status || 422).json({ error: error.status ? error.message : 'This document could not be read. It may be encrypted or damaged.' })
  }
})

export default router
