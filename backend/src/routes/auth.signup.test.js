// Round-5 review P1: the signup RESPONSE CONTRACT is an explicit union:
//   verification enabled  → 201 { verificationRequired: true, user }  (NO token)
//   verification disabled → 201 { token, user }
// Clients branch on this; a token on the verification branch (or none on the
// direct branch) recreates the broken-auth regression.
// Round-6 fix: exercises a REAL ephemeral HTTP server instead of fabricated
// request objects (which broke Node HTTP teardown in CI).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import express from 'express'

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

async function withServer(fn) {
  const app = express()
  app.use(express.json())
  app.use('/auth', authRoutes)
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

const postSignup = (base, body) => fetch(`${base}/auth/signup`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
})

describe('POST /auth/signup — verification ENABLED', () => {
  beforeEach(() => {
    users.clear()
    sendVerificationEmail.mockClear()
    process.env.JWT_SECRET = 'test-secret'.repeat(4)
    process.env.REQUIRE_EMAIL_VERIFICATION = '1'
    process.env.VERIFY_URL_BASE = 'https://app.example.com/verify.html'
  })

  it('returns verificationRequired and NO token, and sends the verification email', async () => {
    await withServer(async base => {
      const res = await postSignup(base, { email: 'verify@me.com', password: 'password123', name: 'V' })
      expect(res.status).toBe(201)
      const body = await res.json()
      expect(body.verificationRequired).toBe(true)
      expect(body.token).toBeUndefined()
      expect(body.user?.email).toBe('verify@me.com')
    })
    expect(sendVerificationEmail).toHaveBeenCalledTimes(1)
    const stored = [...users.values()][0]
    expect(stored.emailVerified).toBe(false)
    expect(stored.verifyTokenHash).toBeTruthy()
  })
})

describe('POST /auth/signup — verification disabled', () => {
  beforeEach(() => {
    users.clear()
    sendVerificationEmail.mockClear()
    process.env.JWT_SECRET = 'test-secret'.repeat(4)
    delete process.env.REQUIRE_EMAIL_VERIFICATION
  })

  it('returns a token immediately for an authenticated session', async () => {
    await withServer(async base => {
      const res = await postSignup(base, { email: 'direct@me.com', password: 'password123', name: 'D' })
      expect(res.status).toBe(201)
      const body = await res.json()
      expect(body.verificationRequired).toBeUndefined()
      expect(typeof body.token).toBe('string')
      expect(body.token.length).toBeGreaterThan(10)
    })
  })
})
