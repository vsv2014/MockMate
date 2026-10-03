// Round-5 review P1: the signup RESPONSE CONTRACT is an explicit union:
//   verification enabled  → 201 { verificationRequired: true, user }  (NO token)
//   verification disabled → 201 { token, user }
// Clients branch on this; a token on the verification branch (or none on the
// direct branch) recreates the broken-auth regression.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'
import { Readable } from 'stream'

const users = new Map()
const storeMock = {
  findUserByEmail: async email => [...users.values()].find(u => u.email === email) || null,
  createUser: async data => {
    const user = { id: `u${users.size + 1}`, tokenVersion: 0, ...data }
    users.set(user.id, user)
    return user
  },
  updateUser: async (id, patch) => { Object.assign(users.get(id), patch); return users.get(id) },
}
vi.mock('../store.js', () => ({
  store: () => storeMock,
  toSafeUser: u => ({ id: u.id, email: u.email, name: u.name || '' }),
  currentPeriod: () => '2026-10',
}))
const sendVerificationEmail = vi.fn(async () => ({ delivered: 'email' }))
vi.mock('../mailer.js', () => ({
  sendResetEmail: vi.fn(async () => ({ delivered: 'email' })),
  sendVerificationEmail: (...args) => sendVerificationEmail(...args),
}))
import authRoutes from './auth.js'

function post(app, path, body) {
  return new Promise(resolve => {
    const payload = JSON.stringify(body)
    const req = new Readable({ read() {} })
    req.push(payload)
    req.push(null)
    Object.assign(req, {
      method: 'POST', url: path, httpVersion: '1.1',
      headers: { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(payload)) },
      ip: '127.0.0.1', socket: { remoteAddress: '127.0.0.1' },
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
    setTimeout(() => resolve({ statusCode: 504, body: null, timedOut: true }), 4000)
  })
}

function buildApp() {
  const app = express()
  app.use(express.json())
  app.use('/auth', authRoutes)
  return app
}

describe('POST /auth/signup — verification ENABLED', () => {
  beforeEach(() => {
    users.clear()
    sendVerificationEmail.mockClear()
    process.env.JWT_SECRET = 'test-secret'.repeat(4)
    process.env.REQUIRE_EMAIL_VERIFICATION = '1'
    process.env.VERIFY_URL_BASE = 'https://app.example.com/verify.html'
  })

  it('returns verificationRequired and NO token, and sends the verification email', async () => {
    const res = await post(buildApp(), '/auth/signup', { email: 'verify@me.com', password: 'password123', name: 'V' })
    expect(res.statusCode).toBe(201)
    expect(res.body?.verificationRequired).toBe(true)
    expect(res.body?.token).toBeUndefined()
    expect(res.body?.user?.email).toBe('verify@me.com')
    expect(sendVerificationEmail).toHaveBeenCalledTimes(1)
    const stored = [...users.values()][0]
    expect(stored.emailVerified).toBe(false)
    expect(stored.verifyTokenHash).toBeTruthy()
  })
})

describe('POST /auth/signup — verification disabled', () => {
  beforeEach(() => {
    users.clear()
    process.env.JWT_SECRET = 'test-secret'.repeat(4)
    delete process.env.REQUIRE_EMAIL_VERIFICATION
  })

  it('returns a token immediately for an authenticated session', async () => {
    const res = await post(buildApp(), '/auth/signup', { email: 'direct@me.com', password: 'password123', name: 'D' })
    expect(res.statusCode).toBe(201)
    expect(res.body?.verificationRequired).toBeUndefined()
    expect(typeof res.body?.token).toBe('string')
    expect(res.body?.token.length).toBeGreaterThan(10)
  })
})
