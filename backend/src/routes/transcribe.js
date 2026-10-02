import { Router } from 'express'
import multer from 'multer'
import { requireAuth } from '../middleware/auth.js'
import { store, currentPeriod } from '../store.js'
import { executeTranscription } from '../arch.js'

const router = Router()
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024, files: 1 } })

async function transcribeWithDeepgram(file, language) {
  const url = new URL('https://api.deepgram.com/v1/listen')
  url.searchParams.set('model', 'nova-3')
  url.searchParams.set('smart_format', 'true')
  url.searchParams.set('language', language)
  const response = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Token ${process.env.DEEPGRAM_API_KEY}`, 'Content-Type': file.mimetype || 'audio/mp4' },
    body: file.buffer,
    signal: AbortSignal.timeout(28_000),
  })
  const data = await response.json()
  if (!response.ok) throw new Error(data?.err_msg || `Deepgram returned ${response.status}`)
  return {
    transcript: data?.results?.channels?.[0]?.alternatives?.[0]?.transcript?.trim() || '',
    duration: Math.max(0, Math.ceil(Number(data?.metadata?.duration) || 0)),
  }
}

router.post('/', requireAuth, upload.single('audio'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Record some audio first.' })
  const language = String(req.body?.language || 'en').slice(0, 16)
  const outcome = await executeTranscription({
    execute: provider => {
      if (provider !== 'deepgram') throw new Error(`Unsupported transcription provider: ${provider}`)
      return transcribeWithDeepgram(req.file, language)
    },
    fallback: async () => ({ transcript: '', duration: 0, typedInputRequired: true }),
  })

  if (!outcome.ok) return res.status(503).json({ error: 'Voice transcription is unavailable. Type the question instead.', fallback: 'typed-input' })
  const { transcript, duration, typedInputRequired } = outcome.result
  if (duration) await store().addUsage(req.userId, currentPeriod(), { sttSeconds: duration })
  if (typedInputRequired) {
    return res.status(200).json({ transcript: '', duration: 0, degraded: true, fallback: 'typed-input' })
  }
  res.json({ transcript, duration, degraded: outcome.degraded, provider: outcome.provider })
})

export default router
