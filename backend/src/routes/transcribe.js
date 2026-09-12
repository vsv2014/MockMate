import { Router } from 'express'
import multer from 'multer'
import { requireAuth } from '../middleware/auth.js'
import { store, currentPeriod } from '../store.js'

const router = Router()
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024, files: 1 } })

router.post('/', requireAuth, upload.single('audio'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Record some audio first.' })
  if (!process.env.DEEPGRAM_API_KEY) return res.status(503).json({ error: 'Voice transcription is not configured.' })
  try {
    const language = String(req.body?.language || 'en').slice(0, 16)
    const url = new URL('https://api.deepgram.com/v1/listen')
    url.searchParams.set('model', 'nova-3')
    url.searchParams.set('smart_format', 'true')
    url.searchParams.set('language', language)
    const response = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Token ${process.env.DEEPGRAM_API_KEY}`, 'Content-Type': req.file.mimetype || 'audio/mp4' },
      body: req.file.buffer,
      signal: AbortSignal.timeout(30_000),
    })
    const data = await response.json()
    if (!response.ok) throw new Error(data?.err_msg || `Deepgram returned ${response.status}`)
    const transcript = data?.results?.channels?.[0]?.alternatives?.[0]?.transcript?.trim() || ''
    const duration = Math.max(0, Math.ceil(Number(data?.metadata?.duration) || 0))
    if (duration) await store().addUsage(req.userId, currentPeriod(), { sttSeconds: duration })
    res.json({ transcript, duration })
  } catch (error) {
    console.error('[transcribe] failed:', error.message)
    res.status(502).json({ error: 'Transcription failed. You can still type the question.' })
  }
})

export default router
