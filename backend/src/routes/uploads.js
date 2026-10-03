import { Router } from 'express'
import multer from 'multer'
import mammoth from 'mammoth'
import { PDFParse } from 'pdf-parse'
import { requireAuth } from '../middleware/auth.js'
import { createDocumentWithCap } from '../models/Document.js'

const router = Router()
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024
const MAX_DOCX_UNCOMPRESSED_BYTES = 50 * 1024 * 1024
const ALLOWED_FILE = file => file.mimetype === 'application/pdf'
  || file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  || file.mimetype?.startsWith('text/')
  || /\.(pdf|docx|txt|md)$/i.test(file.originalname || '')

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
  fileFilter(_req, file, cb) {
    if (ALLOWED_FILE(file)) return cb(null, true)
    const error = new Error('Choose a PDF, DOCX, TXT or Markdown document.')
    error.status = 415
    cb(error)
  },
})
const TYPES = new Set(['resume', 'jd', 'knowledge', 'supporting', 'training', 'document'])

// DOCX is a ZIP container. Sum the uncompressed sizes declared in central-directory
// headers before giving it to Mammoth so tiny zip bombs cannot expand without bound.
export function zipDeclaredUncompressedBytes(buffer) {
  let total = 0
  for (let i = 0; i + 46 <= buffer.length;) {
    if (buffer.readUInt32LE(i) === 0x02014b50) {
      total += buffer.readUInt32LE(i + 24)
      const nameLen = buffer.readUInt16LE(i + 28)
      const extraLen = buffer.readUInt16LE(i + 30)
      const commentLen = buffer.readUInt16LE(i + 32)
      i += 46 + nameLen + extraLen + commentLen
      if (total > MAX_DOCX_UNCOMPRESSED_BYTES) return total
    } else i += 1
  }
  return total
}

export async function extractText(file) {
  if (file.mimetype === 'application/pdf' || file.originalname.toLowerCase().endsWith('.pdf')) {
    const parser = new PDFParse({ data: file.buffer })
    try { return (await parser.getText()).text }
    finally { await parser.destroy() }
  }
  if (file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    || file.originalname.toLowerCase().endsWith('.docx')) {
    if (zipDeclaredUncompressedBytes(file.buffer) > MAX_DOCX_UNCOMPRESSED_BYTES) {
      const error = new Error('This DOCX expands beyond the safe processing limit. Remove embedded media or split the document.')
      error.status = 413
      throw error
    }
    return (await mammoth.extractRawText({ buffer: file.buffer })).value
  }
  if (file.mimetype.startsWith('text/') || /\.(txt|md)$/i.test(file.originalname)) return file.buffer.toString('utf8')
  const error = new Error('Choose a PDF, DOCX, TXT or Markdown document.')
  error.status = 415
  throw error
}

function receiveUpload(req, res, next) {
  upload.single('file')(req, res, error => {
    if (!error) return next()
    if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: `Document uploads are limited to ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB.` })
    }
    res.status(error.status || 400).json({ error: error.message || 'Could not accept this upload.' })
  })
}

router.post('/', requireAuth, receiveUpload, async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Choose a document to upload.' })

  let text
  try {
    text = (await extractText(req.file)).replace(/\u0000/g, '').trim()
  } catch (error) {
    console.error('[documents/upload] extraction failed:', error.message)
    return res.status(error.status || 422).json({ error: error.status ? error.message : 'This document could not be read. It may be encrypted or damaged.' })
  }

  if (!text) return res.status(422).json({ error: 'No readable text was found in this document.' })
  if (text.length > 300_000) return res.status(413).json({ error: 'The extracted document is too long (maximum 300,000 characters).' })
  const type = TYPES.has(req.body?.type) ? req.body.type : 'document'
  const name = String(req.body?.name || req.file.originalname).trim().slice(0, 180)

  try {
    const document = await createDocumentWithCap({ user: req.userId, name, type, text, chars: text.length })
    res.status(201).json({ document: { id: String(document._id), name: document.name, type: document.type, chars: document.chars, createdAt: document.createdAt } })
  } catch (error) {
    if (error?.status === 409) return res.status(409).json({ error: error.message, code: error.code })
    console.error('[documents/upload] storage failed:', error.message)
    res.status(503).json({ error: 'The document was read, but MockMate could not save it. Please try again.' })
  }
})

export default router
