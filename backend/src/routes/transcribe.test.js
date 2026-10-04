import { beforeEach, describe, expect, it, vi } from 'vitest'
import express from 'express'

const { storeMock, executeTranscriptionMock } = vi.hoisted(() => ({
  storeMock: {
    findUserById: vi.fn(),
    reserveSttUsage: vi.fn(),
    releaseSttUsage: vi.fn(),
  },
  executeTranscriptionMock: vi.fn(),
}))

vi.mock('../middleware/auth.js', () => ({
  requireAuth: (req, _res, next) => { req.userId = 'u1'; next() },
}))
vi.mock('../store.js', () => ({
  store: () => storeMock,
  currentPeriod: () => '2026-10',
}))
vi.mock('../plans.js', () => ({
  effectivePlan: () => 'free',
  limitFor: () => ({ sttSeconds: 1800 }),
}))
vi.mock('../arch.js', () => ({
  executeTranscription: (...args) => executeTranscriptionMock(...args),
}))

import router, { audioDurationSeconds } from './transcribe.js'

function mp4(seconds, timescale = 1000) {
  const duration = Math.round(seconds * timescale)
  const mvhd = Buffer.alloc(28)
  mvhd.writeUInt32BE(28, 0)
  mvhd.write('mvhd', 4, 'ascii')
  mvhd.writeUInt8(0, 8) // version 0 + three zero flag bytes
  mvhd.writeUInt32BE(timescale, 20)
  mvhd.writeUInt32BE(duration, 24)
  const moov = Buffer.alloc(8 + mvhd.length)
  moov.writeUInt32BE(moov.length, 0)
  moov.write('moov', 4, 'ascii')
  mvhd.copy(moov, 8)
  return moov
}

function wav(seconds, byteRate = 16000) {
  const dataSize = Math.round(seconds * byteRate)
  const out = Buffer.alloc(44 + dataSize)
  out.write('RIFF', 0, 'ascii')
  out.writeUInt32LE(out.length - 8, 4)
  out.write('WAVE', 8, 'ascii')
  out.write('fmt ', 12, 'ascii')
  out.writeUInt32LE(16, 16)
  out.writeUInt16LE(1, 20)
  out.writeUInt16LE(1, 22)
  out.writeUInt32LE(16000, 24)
  out.writeUInt32LE(byteRate, 28)
  out.writeUInt16LE(1, 32)
  out.writeUInt16LE(8, 34)
  out.write('data', 36, 'ascii')
  out.writeUInt32LE(dataSize, 40)
  return out
}

async function withServer(fn) {
  const app = express()
  app.use('/transcribe', router)
  const server = await new Promise((resolve, reject) => {
    const s = app.listen(0, '127.0.0.1')
    s.once('error', reject)
    s.on('listening', () => resolve(s))
  })
  try { return await fn(`http://127.0.0.1:${server.address().port}`) }
  finally { await new Promise(resolve => server.close(resolve)) }
}

async function postAudio(base, buffer, type = 'audio/mp4', name = 'clip.m4a') {
  const form = new FormData()
  form.append('language', 'en')
  form.append('audio', new Blob([buffer], { type }), name)
  return fetch(`${base}/transcribe`, { method: 'POST', body: form })
}

describe('managed upload transcription quota reservation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.MONGO_URI = 'mongodb://unit-test'
    storeMock.findUserById.mockResolvedValue({ id: 'u1', plan: 'free' })
    storeMock.releaseSttUsage.mockResolvedValue(true)
  })

  it('server-probes MP4/M4A and WAV duration without trusting the client', () => {
    expect(audioDurationSeconds({ buffer: mp4(60), mimetype: 'audio/mp4', originalname: 'a.m4a' })).toBe(60)
    expect(audioDurationSeconds({ buffer: wav(2), mimetype: 'audio/wav', originalname: 'a.wav' })).toBe(2)
  })

  it('rejects before provider work when the exact upload lease cannot be reserved', async () => {
    storeMock.reserveSttUsage.mockResolvedValue(false)
    await withServer(async base => {
      const res = await postAudio(base, mp4(60))
      expect(res.status).toBe(402)
      expect((await res.json()).code).toBe('stt_quota_exhausted')
    })
    // 60s media + 2s rounding margin, reserved atomically before transcription.
    expect(storeMock.reserveSttUsage).toHaveBeenCalledWith('u1', '2026-10', 1800, 62)
    expect(executeTranscriptionMock).not.toHaveBeenCalled()
  })

  it('keeps actual usage charged and returns unused safety reservation after success', async () => {
    storeMock.reserveSttUsage.mockResolvedValue(true)
    executeTranscriptionMock.mockResolvedValue({
      ok: true,
      degraded: false,
      provider: 'deepgram',
      result: { transcript: 'hello', duration: 60, typedInputRequired: false },
    })
    await withServer(async base => {
      const res = await postAudio(base, mp4(60))
      expect(res.status).toBe(200)
      expect((await res.json()).transcript).toBe('hello')
    })
    expect(storeMock.reserveSttUsage).toHaveBeenCalledWith('u1', '2026-10', 1800, 62)
    expect(storeMock.releaseSttUsage).toHaveBeenCalledWith('u1', '2026-10', 2)
  })

  it('releases the whole upload lease when transcription fails', async () => {
    storeMock.reserveSttUsage.mockResolvedValue(true)
    executeTranscriptionMock.mockRejectedValue(Object.assign(new Error('provider down'), { status: 503 }))
    await withServer(async base => {
      const res = await postAudio(base, mp4(30))
      expect(res.status).toBe(503)
    })
    expect(storeMock.releaseSttUsage).toHaveBeenCalledWith('u1', '2026-10', 32)
  })
})
