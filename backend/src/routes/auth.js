import { Router } from 'express'
import bcrypt from 'bcryptjs'
import crypto from 'crypto'
import rateLimit from 'express-rate-limit'
import { store, toSafeUser, currentPeriod } from '../store.js'
import { limitFor } from '../plans.js'
import { signToken, requireAuth } from '../middleware/auth.js'
import { sendResetEmail } from '../mailer.js'

const router = Router()
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const RESET_TTL_MS = 30 * 60 * 1000   // reset links expire after 30 minutes
const sha256 = s => crypto.createHash('sha256').update(String(s)).digest('hex')

// Throttle the credential-sensitive endpoints to stop online brute-force / enumeration.
// Per-IP; behind a proxy set `app.set('trust proxy', 1)` so the real client IP is used.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,                 // generous for a real user; ruinous for a guessing script
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please wait a few minutes and try again.' },
})

// POST /auth/signup { name, email, password } → { token, user }
router.post('/signup', authLimiter, async (req, res) => {
  try {
    const { email, password, name } = req.body || {}
    if (!EMAIL_RE.test(email || '')) return res.status(400).json({ error: 'Please enter a valid email address' })
    if (!password || password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' })
    const exists = await store().findUserByEmail(email)
    if (exists) return res.status(409).json({ error: 'An account with this email already exists' })
    const passwordHash = await bcrypt.hash(password, 12)
    const user = await store().createUser({ email, passwordHash, name: name || '', lastLogin: new Date().toISOString() })
    res.status(201).json({ token: signToken(user.id, user.tokenVersion || 0), user: toSafeUser(user) })
  } catch (e) { res.status(500).json({ error: 'Could not create your account. Please try again.' }) }
})

// POST /auth/login { email, password } → { token, user }
// Security: never reveal which of email/password was wrong.
router.post('/login', authLimiter, async (req, res) => {
  try {
    const { email, password } = req.body || {}
    const user = await store().findUserByEmail(email)
    if (!user || !user.passwordHash) return res.status(401).json({ error: 'Incorrect email or password' })
    const ok = await bcrypt.compare(password || '', user.passwordHash)
    if (!ok) return res.status(401).json({ error: 'Incorrect email or password' })
    await store().updateUser(user.id, { lastLogin: new Date().toISOString() })
    res.json({ token: signToken(user.id, user.tokenVersion || 0), user: toSafeUser(user) })
  } catch (e) { res.status(500).json({ error: 'Something went wrong. Please try again.' }) }
})

// GET /auth/me (JWT) → { user, plan, usage, limits }
// `limits` is the ENFORCED cap for this plan (from plans.js) so the UI never keeps its own copy.
router.get('/me', requireAuth, async (req, res) => {
  try {
    const user = await store().findUserById(req.userId)
    if (!user) return res.status(404).json({ error: 'Account not found' })
    const plan = user.plan || 'free'
    const usage = await store().getUsage(user.id, currentPeriod())
    const limit = limitFor(plan)
    res.json({
      user: toSafeUser(user),
      plan,
      usage: { period: usage.period, llmCalls: usage.llmCalls || 0, sttSeconds: usage.sttSeconds || 0 },
      limits: { llmCalls: limit.llmCalls, sttSeconds: limit.sttSeconds },
    })
  } catch (e) { res.status(500).json({ error: 'Could not load your account.' }) }
})

// POST /auth/logout (JWT) → { ok }
// JWTs are stateless, so logout is a client-side token clear; the server just acks.
// (A future denylist can hook in here without changing the client.)
router.post('/logout', requireAuth, (req, res) => res.json({ ok: true }))

// POST /auth/forgot-password { email } → { ok }
// Always 200 — never reveal whether an account exists (no email enumeration). We store only
// a HASH of the reset token (+ 30-min expiry); the raw token goes out in the email/link.
router.post('/forgot-password', authLimiter, async (req, res) => {
  try {
    const { email } = req.body || {}
    const user = email ? await store().findUserByEmail(email) : null
    // Only password accounts get a reset (Google-only accounts have no password to reset).
    if (user && user.passwordHash) {
      const raw = crypto.randomBytes(32).toString('hex')
      await store().updateUser(user.id, { resetTokenHash: sha256(raw), resetTokenExp: Date.now() + RESET_TTL_MS })
      const base = process.env.RESET_URL_BASE || 'http://localhost:5174/reset.html'
      const link = `${base}?token=${raw}`
      await sendResetEmail(user.email, link)
    }
    res.json({ ok: true })
  } catch (e) {
    res.json({ ok: true })   // even on internal error, don't leak whether the email exists
  }
})

// POST /auth/reset-password { token, password } → { ok, token } (auto-login on success)
// Token is single-use: cleared on success. Expired/invalid tokens get a generic message.
router.post('/reset-password', authLimiter, async (req, res) => {
  try {
    const { token, password } = req.body || {}
    if (!token) return res.status(400).json({ error: 'This reset link is invalid or has expired. Request a new one.' })
    if (!password || password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' })
    const user = await store().findUserByResetToken(sha256(token))
    if (!user || !user.resetTokenExp || user.resetTokenExp < Date.now()) {
      return res.status(400).json({ error: 'This reset link is invalid or has expired. Request a new one.' })
    }
    const passwordHash = await bcrypt.hash(password, 12)
    // Bump tokenVersion so EVERY previously-issued JWT (e.g. an attacker's) stops working.
    const tokenVersion = (user.tokenVersion || 0) + 1
    await store().updateUser(user.id, { passwordHash, tokenVersion, resetTokenHash: null, resetTokenExp: null, lastLogin: new Date().toISOString() })
    res.json({ ok: true, token: signToken(user.id, tokenVersion), user: toSafeUser({ ...user, passwordHash }) })
  } catch (e) {
    res.status(500).json({ error: 'Could not reset your password. Please try again.' })
  }
})

// --- Google OAuth (authorization-code flow; needs GOOGLE_* env to be active) ---
router.get('/google', (req, res) => {
  if (!process.env.GOOGLE_CLIENT_ID) return res.status(503).json({ error: 'Google sign-in is not configured' })
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: process.env.GOOGLE_REDIRECT_URI,
    response_type: 'code',
    scope: 'openid email profile',
    access_type: 'offline',
    prompt: 'select_account',
  })
  res.redirect('https://accounts.google.com/o/oauth2/v2/auth?' + params)
})

router.get('/google/callback', async (req, res) => {
  try {
    const { code } = req.query
    if (!code) return res.status(400).send('Missing code')
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code, client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri: process.env.GOOGLE_REDIRECT_URI, grant_type: 'authorization_code',
      }),
    }).then(r => r.json())
    if (!tokenRes.id_token) return res.status(401).send('Google sign-in failed')
    const profile = JSON.parse(Buffer.from(tokenRes.id_token.split('.')[1], 'base64').toString())
    let user = await store().findUserByGoogleId(profile.sub) || await store().findUserByEmail(profile.email)
    if (!user) user = await store().createUser({ email: profile.email, googleId: profile.sub, name: profile.name || '', lastLogin: new Date().toISOString() })
    else await store().updateUser(user.id, { googleId: profile.sub, lastLogin: new Date().toISOString() })
    res.redirect(`${process.env.DESKTOP_REDIRECT}?token=${signToken(user.id, user.tokenVersion || 0)}`)
  } catch (e) { res.status(500).send('Google sign-in error') }
})

export default router
