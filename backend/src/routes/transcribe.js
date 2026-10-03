import { Router } from 'express'
import multer from 'multer'
import { requireAuth } from '../middleware/auth.js'
import { store, currentPeriod } from '../store.js'
import { executeTranscription } from '../arch.js'

const router = Router()
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024, files: 1 } })

async function transcribeWithDeepgram(file, language, signal) {
  const url = new URL('https://api.deepgram.com/v1/listen')
  url.searchParams.set('model', 'nova-3')
  url.searchParams.set('smart_format', 'true')
  url.searchParams.set('language', language)
  const timeout = AbortSignal.timeout(28_000)
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout
  const response = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Token ${process.env.DEEPGRAM_API_KEY}`, 'Content-Type': file.mimetype || 'audio/mp4' },
    body: file.buffer,
    signal: combined,
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(data?.err_msg || `Deepgram returned ${response.status}`)
    error.status = response.status
    throw error
  }
  return {
    transcript: data?.results?.channels?.[0]?.alternatives?.[0]?.transcript?.trim() || '',
    duration: Math.max(0, Math.ceil(Number(data?.metadata?.duration) || 0)),
  }
}

router.post('/', requireAuth, upload.single('audio'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Record some audio first.' })
  const language = String(req.body?.language || 'en').slice(0, 16)
  const requestAbort = new AbortController()
  req.once('aborted', () => requestAbort.abort(new Error('client_disconnected')))
  res.once('close', () => { if (!res.writableEnded) requestAbort.abort(new Error('client_disconnected')) })

  try {
    const outcome = await executeTranscription({
      signal: requestAbort.signal,
      execute: (provider, _attempt, signal) => {
        if (provider !== 'deepgram') {
          const error = new Error(`Unsupported transcription provider: ${provider}`)
          error.status = 500
          throw error
        }
        return transcribeWithDeepgram(req.file, language, signal)
      },
      fallback: async () => ({ transcript: '', duration: 0, typedInputRequired: true }),
    })

    if (outcome.aborted || requestAbort.signal.aborted) return
    if (!outcome.ok) return res.status(503).json({ error: 'Voice transcription is unavailable. Type the question instead.', fallback: 'typed-input' })
    const { transcript, duration, typedInputRequired } = outcome.result
    if (duration) await store().addUsage(req.userId, currentPeriod(), { sttSeconds: duration })
    if (typedInputRequired) return res.status(200).json({ transcript: '', duration: 0, degraded: true, fallback: 'typed-input' })
    res.json({ transcript, duration, degraded: outcome.degraded, provider: outcome.provider })
  } catch (error) {
    if (requestAbort.signal.aborted || error?.name === 'AbortError') return
    console.error('[transcribe] failed:', error?.message || error)
    res.status(503).json({ error: 'Voice transcription is unavailable. Type the question instead.', fallback: 'typed-input' })
  }
})

export default router
