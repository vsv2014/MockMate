import { Router } from 'express'
import multer from 'multer'
import { requireAuth } from '../middleware/auth.js'
import { effectivePlan, limitFor } from '../plans.js'
import { store, currentPeriod } from '../store.js'
import { executeTranscription } from '../arch.js'

const router = Router()
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024, files: 1 } })
const DURATION_SAFETY_SECONDS = 2

function routeError(message, status, code) {
  const error = new Error(message)
  error.status = status
  if (code) error.code = code
  return error
}

function readMp4BoxSize(buffer, offset) {
  if (offset + 8 > buffer.length) return null
  let size = buffer.readUInt32BE(offset)
  const type = buffer.toString('ascii', offset + 4, offset + 8)
  let header = 8
  if (size === 1) {
    if (offset + 16 > buffer.length) return null
    const big = buffer.readBigUInt64BE(offset + 8)
    if (big > BigInt(Number.MAX_SAFE_INTEGER)) return null
    size = Number(big)
    header = 16
  } else if (size === 0) {
    size = buffer.length - offset
  }
  if (size < header || offset + size > buffer.length) return null
  return { size, type, header }
}

function mp4DurationSeconds(buffer) {
  // mvhd is a direct child of moov. Parse container lengths instead of scanning
  // arbitrary bytes so malformed uploads cannot spoof a duration marker.
  let offset = 0
  while (offset + 8 <= buffer.length) {
    const box = readMp4BoxSize(buffer, offset)
    if (!box) break
    if (box.type === 'moov') {
      let child = offset + box.header
      const end = offset + box.size
      while (child + 8 <= end) {
        const inner = readMp4BoxSize(buffer, child)
        if (!inner || child + inner.size > end) break
        if (inner.type === 'mvhd') {
          const p = child + inner.header
          if (p + 4 > end) return 0
          const version = buffer[p]
          if (version === 0) {
            if (p + 20 > end) return 0
            const timescale = buffer.readUInt32BE(p + 12)
            const duration = buffer.readUInt32BE(p + 16)
            return timescale ? duration / timescale : 0
          }
          if (version === 1) {
            if (p + 32 > end) return 0
            const timescale = buffer.readUInt32BE(p + 20)
            const duration = buffer.readBigUInt64BE(p + 24)
            return timescale ? Number(duration) / timescale : 0
          }
          return 0
        }
        child += inner.size
      }
    }
    offset += box.size
  }
  return 0
}

function wavDurationSeconds(buffer) {
  if (buffer.length < 44 || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') return 0
  let offset = 12
  let byteRate = 0
  let dataSize = 0
  while (offset + 8 <= buffer.length) {
    const type = buffer.toString('ascii', offset, offset + 4)
    const size = buffer.readUInt32LE(offset + 4)
    const body = offset + 8
    if (body + size > buffer.length) break
    if (type === 'fmt ' && size >= 16) byteRate = buffer.readUInt32LE(body + 8)
    if (type === 'data') { dataSize = size; break }
    offset = body + size + (size % 2)
  }
  return byteRate > 0 && dataSize >= 0 ? dataSize / byteRate : 0
}

/**
 * Server-authoritative duration probe used before managed-provider spend. Mobile
 * records MP4/M4A today; WAV is supported for parity/testing. Unknown containers
 * are rejected in managed mode instead of trusting a client-supplied duration.
 */
export function audioDurationSeconds(file) {
  const buffer = file?.buffer
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw routeError('The audio file is empty.', 400, 'invalid_audio')
  const mime = String(file?.mimetype || '').toLowerCase()
  const name = String(file?.originalname || '').toLowerCase()
  let duration = 0
  if (mime.includes('mp4') || mime.includes('m4a') || /\.(m4a|mp4|aac)$/.test(name)) duration = mp4DurationSeconds(buffer)
  else if (mime.includes('wav') || name.endsWith('.wav')) duration = wavDurationSeconds(buffer)
  else throw routeError('This audio format cannot be quota-verified. Use M4A/MP4 or WAV.', 415, 'unsupported_audio')
  if (!Number.isFinite(duration) || duration <= 0) throw routeError('Could not determine the audio duration. Record the clip again and retry.', 400, 'invalid_audio_duration')
  return duration
}

async function reserveUploadLease(req) {
  if (!process.env.MONGO_URI) return { seconds: 0, period: null }
  const user = await store().findUserById(req.userId)
  if (!user) throw routeError('Your session expired. Please sign in again.', 401, 'unauthorized')
  const period = currentPeriod()
  const limit = limitFor(effectivePlan(user)).sttSeconds
  const mediaSeconds = Math.max(1, Math.ceil(audioDurationSeconds(req.file)))
  // Small safety margin absorbs container-vs-provider rounding differences. The
  // unused portion is released after a successful transcription.
  const seconds = mediaSeconds + DURATION_SAFETY_SECONDS
  const reserved = await store().reserveSttUsage(req.userId, period, limit, seconds)
  if (!reserved) {
    throw routeError('You don’t have enough voice-transcription allowance remaining for this recording. Shorten it, wait for your next billing period, or upgrade.', 402, 'stt_quota_exhausted')
  }
  return { seconds, period }
}

async function releaseLease(req, lease, seconds = lease?.seconds || 0) {
  const delta = Math.max(0, Math.floor(Number(seconds) || 0))
  if (!lease?.period || !delta) return
  await store().releaseSttUsage(req.userId, lease.period, delta)
}

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

// Managed uploads reserve the server-probed media duration ATOMICALLY before
// Deepgram is called. Provider failure/abort releases the reservation; success
// settles the small safety margin back to the user. This prevents the old
// "1 second remaining → process a long clip" quota overrun and concurrent races.
router.post('/', requireAuth, upload.single('audio'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Record some audio first.' })
  const language = String(req.body?.language || 'en').slice(0, 16)
  const requestAbort = new AbortController()
  req.once('aborted', () => requestAbort.abort(new Error('client_disconnected')))
  res.once('close', () => { if (!res.writableEnded) requestAbort.abort(new Error('client_disconnected')) })
  let lease = null
  let settled = false

  try {
    lease = await reserveUploadLease(req)
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

    if (outcome.aborted || requestAbort.signal.aborted) {
      await releaseLease(req, lease).catch(() => {})
      settled = true
      return
    }
    if (!outcome.ok) {
      await releaseLease(req, lease).catch(() => {})
      settled = true
      return res.status(503).json({ error: 'Voice transcription is unavailable. Type the question instead.', fallback: 'typed-input' })
    }

    const { transcript, duration, typedInputRequired } = outcome.result
    if (typedInputRequired) {
      await releaseLease(req, lease).catch(() => {})
      settled = true
      return res.status(200).json({ transcript: '', duration: 0, degraded: true, fallback: 'typed-input' })
    }

    if (lease?.seconds) {
      const actual = Math.max(1, Math.ceil(Number(duration) || 0))
      if (actual > lease.seconds) {
        // This should only happen if provider metadata materially disagrees with
        // the container duration. Reserve the difference before returning the
        // paid result; fail closed if there is no room. (If the user vanished
        // mid-request, limit falls to 0 → 402, and the original reservation stays
        // charged: never exceed the cap.)
        const extra = actual - lease.seconds
        const user = await store().findUserById(req.userId)
        const limit = user ? limitFor(effectivePlan(user)).sttSeconds : 0
        const toppedUp = user && await store().reserveSttUsage(req.userId, lease.period, limit, extra)
        if (!toppedUp) {
          settled = true // keep the original reservation charged; never exceed the cap
          return res.status(402).json({ error: 'This recording exceeds your remaining voice-transcription allowance.', code: 'stt_quota_exhausted' })
        }
        lease.seconds += extra
      }
      const unused = Math.max(0, lease.seconds - actual)
      if (unused) await releaseLease(req, lease, unused)
    }
    settled = true
    res.json({ transcript, duration, degraded: outcome.degraded, provider: outcome.provider })
  } catch (error) {
    if (!settled && lease?.seconds) await releaseLease(req, lease).catch(() => {})
    if (requestAbort.signal.aborted || error?.name === 'AbortError') return
    console.error('[transcribe] failed:', error?.message || error)
    const status = Number(error?.status) || 503
    res.status(status).json({
      error: error?.message || 'Voice transcription is unavailable. Type the question instead.',
      ...(error?.code ? { code: error.code } : {}),
      ...(status >= 500 ? { fallback: 'typed-input' } : {}),
    })
  }
})

export default router
