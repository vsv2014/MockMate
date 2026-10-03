// Round-5 review P1: managed streaming STT must enforce plan limits. These tests
// verify the /api/deepgram-token route (a) runs the injected STT quota guard and
// (b) reserves the grant lifetime against the user's allowance (lease accounting).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import { Readable } from 'stream'

const { deepgramTokenMock } = vi.hoisted(() => ({ deepgramTokenMock: vi.fn() }))
vi.mock('./core.js', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, deepgramToken: deepgramTokenMock }
})
import { registerApiRoutes } from './apiRoutes.js'

function post(app, path, { body = {}, ip = '127.0.0.1' } = {}) {
  return new Promise(resolve => {
    const payload = JSON.stringify(body)
    const req = new Readable({ read() {} })
    req.push(payload)
    req.push(null)
    Object.assign(req, {
      method: 'POST', url: path, httpVersion: '1.1',
      headers: { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(payload)) },
      ip, socket: { remoteAddress: ip },
    })
    const res = {
      statusCode: 200, body: null,
      setHeader() {}, getHeader() {}, removeHeader() {},
      status(c) { this.statusCode = c; return this },
      json(b) { this.body = b; resolve(this) },
      send(b) { this.body = b; resolve(this) },
      end(b) { if (b !== undefined) this.body = b; resolve(this) },
      write(b) { this.body = (this.body || '') + String(b) },
      on() {}, once() {}, emit() { return false },
    }
    app.handle(req, res, () => resolve({ statusCode: 404, body: null }))
    setTimeout(() => resolve({ statusCode: 504, body: null, timedOut: true }), 3000)
  })
}

function buildApp(opts) {
  const app = express()
  app.use(express.json())
  registerApiRoutes(app, opts)
  return app
}

describe('/api/deepgram-token STT quota enforcement (round-5 P1)', () => {
  beforeEach(() => { deepgramTokenMock.mockReset() })

  it('runs the injected sttGuard before issuing a grant (quota denial wins)', async () => {
    deepgramTokenMock.mockResolvedValue({ access_token: 'grant', expires_in: 300 })
    const app = buildApp({
      sttGuard: [(req, res) => res.status(402).json({ error: 'quota exhausted', code: 'stt_quota_exhausted' })],
      onSttGrant: () => { throw new Error('must not reserve when guard denies') },
    })
    const res = await post(app, '/api/deepgram-token')
    expect(res.statusCode).toBe(402)
    expect(res.body?.code).toBe('stt_quota_exhausted')
    expect(deepgramTokenMock).not.toHaveBeenCalled()
  })

  it('reserves the grant lifetime against the STT allowance at grant time (lease)', async () => {
    deepgramTokenMock.mockResolvedValue({ access_token: 'grant', expires_in: 300 })
    const grants = []
    const app = buildApp({
      sttGuard: [(req, _res, next) => { req.userId = 'u1'; next() }],
      onSttGrant: (req, seconds) => { grants.push({ userId: req.userId, seconds }) },
    })
    const res = await post(app, '/api/deepgram-token')
    expect(res.statusCode).toBe(200)
    expect(res.body?.access_token).toBe('grant')
    expect(grants).toEqual([{ userId: 'u1', seconds: 300 }])
  })

  it('caps the reservation at 300s even if a longer expiry is reported', async () => {
    deepgramTokenMock.mockResolvedValue({ access_token: 'grant', expires_in: 3600 })
    const grants = []
    const app = buildApp({
      sttGuard: [(req, _res, next) => { req.userId = 'u1'; next() }],
      onSttGrant: (_req, seconds) => { grants.push(seconds) },
    })
    const res = await post(app, '/api/deepgram-token')
    expect(res.statusCode).toBe(200)
    expect(grants).toEqual([300])
  })

  it('does not bill the local raw-key fallback (never returned when hosted)', async () => {
    deepgramTokenMock.mockResolvedValue({ access_token: 'raw-key', expires_in: 3600, fallback: 'api_key', localOnly: true })
    const grants = []
    const app = buildApp({
      sttGuard: [(req, _res, next) => { req.userId = 'u1'; next() }],
      onSttGrant: (_req, seconds) => { grants.push(seconds) },
    })
    const res = await post(app, '/api/deepgram-token')
    expect(res.statusCode).toBe(200)
    expect(grants).toEqual([])
  })
})
