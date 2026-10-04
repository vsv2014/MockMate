// Round-5/6 review: managed streaming STT must enforce plan limits. These tests
// verify the /api/deepgram-token route against a REAL ephemeral HTTP server
// (round-6 fix: hand-fabricated Readable requests broke Node HTTP teardown in CI):
//   (a) runs the injected lease-reservation guard BEFORE minting a grant
//   (b) releases the reserved lease when minting fails (no burned allowance)
//   (c) never releases on success
import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'

const { deepgramTokenMock } = vi.hoisted(() => ({ deepgramTokenMock: vi.fn() }))
vi.mock('./core.js', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, deepgramToken: deepgramTokenMock }
})
import { registerApiRoutes } from './apiRoutes.js'

async function withServer(app, fn) {
  const server = await new Promise((resolve, reject) => {
    const s = app.listen(0, '127.0.0.1')
    s.once('error', reject)
    s.on('listening', () => resolve(s))
  })
  try {
    return await fn(`http://127.0.0.1:${server.address().port}`)
  } finally {
    await new Promise(resolve => server.close(resolve))
  }
}

function buildApp(opts) {
  const app = express()
  app.use(express.json())
  registerApiRoutes(app, opts)
  return app
}

describe('/api/deepgram-token STT lease enforcement (round-5/6)', () => {
  beforeEach(() => { deepgramTokenMock.mockReset() })

  it('runs the injected lease guard before issuing a grant (quota denial wins)', async () => {
    deepgramTokenMock.mockResolvedValue({ access_token: 'grant', expires_in: 300 })
    const app = buildApp({
      sttGuard: [(req, res) => res.status(402).json({ error: 'quota exhausted', code: 'stt_quota_exhausted' })],
      onSttRelease: () => { throw new Error('must not release when the guard denied') },
    })
    await withServer(app, async base => {
      const res = await fetch(`${base}/api/deepgram-token`, { method: 'POST' })
      expect(res.status).toBe(402)
      expect((await res.json()).code).toBe('stt_quota_exhausted')
    })
    expect(deepgramTokenMock).not.toHaveBeenCalled()
  })

  it('reserves the lease BEFORE minting the grant (order matters for atomicity)', async () => {
    const order = []
    const app = buildApp({
      sttGuard: [(req, _res, next) => { req.userId = 'u1'; req._sttLeaseSeconds = 300; order.push('reserve'); next() }],
      onSttRelease: () => { order.push('release') },
    })
    deepgramTokenMock.mockImplementation(async () => { order.push('mint'); return { access_token: 'grant', expires_in: 300 } })
    await withServer(app, async base => {
      const res = await fetch(`${base}/api/deepgram-token`, { method: 'POST' })
      expect(res.status).toBe(200)
      expect((await res.json()).access_token).toBe('grant')
    })
    expect(order).toEqual(['reserve', 'mint'])
  })

  it('releases the reserved lease when minting fails (outage must not burn allowance)', async () => {
    const releases = []
    const err = new Error('Deepgram grant failed (503)')
    err.status = 503
    deepgramTokenMock.mockRejectedValue(err)
    const app = buildApp({
      sttGuard: [(req, _res, next) => { req.userId = 'u1'; req._sttLeaseSeconds = 300; next() }],
      onSttRelease: req => { releases.push({ userId: req.userId, seconds: req._sttLeaseSeconds }) },
    })
    await withServer(app, async base => {
      const res = await fetch(`${base}/api/deepgram-token`, { method: 'POST' })
      expect(res.status).toBe(503)
    })
    expect(releases).toEqual([{ userId: 'u1', seconds: 300 }])
  })

  it('does not release on success (lease stays accounted)', async () => {
    deepgramTokenMock.mockResolvedValue({ access_token: 'grant', expires_in: 300 })
    const releases = []
    const app = buildApp({
      sttGuard: [(req, _res, next) => { req.userId = 'u1'; req._sttLeaseSeconds = 300; next() }],
      onSttRelease: () => { releases.push('released') },
    })
    await withServer(app, async base => {
      const res = await fetch(`${base}/api/deepgram-token`, { method: 'POST' })
      expect(res.status).toBe(200)
    })
    expect(releases).toEqual([])
  })
})
