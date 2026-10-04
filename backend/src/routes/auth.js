import { Router } from 'express'
import bcrypt from 'bcryptjs'
import crypto from 'crypto'
import rateLimit from 'express-rate-limit'
import { store, toSafeUser, currentPeriod } from '../store.js'
import { effectivePlan, limitFor } from '../plans.js'
import { signToken, requireAuth } from '../middleware/auth.js'
import { sendResetEmail, sendVerificationEmail } from '../mailer.js'

const router = Router()
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const RESET_TTL_MS = 30 * 60 * 1000
const VERIFY_TTL_MS = 24 * 60 * 60 * 1000
const GOOGLE_STATE_TTL_MS = 10 * 60 * 1000
const PASSWORD_MAX_BYTES = 72
const sha256 = s => crypto.createHash('sha256').update(String(s)).digest('hex')
const requireEmailVerification = () => ['1', 'true', 'yes', 'on'].includes(String(process.env.REQUIRE_EMAIL_VERIFICATION || '').trim().toLowerCase())
const passwordError = password => {
  if (!password || password.length < 8) return 'Password must be at least 8 characters'
  if (Buffer.byteLength(String(password), 'utf8') > PASSWORD_MAX_BYTES) return 'Password is too long. Use 72 UTF-8 bytes or fewer.'
  return null
}

function limiter(limit, message) {
  return rateLimit({ windowMs: 15 * 60 * 1000, limit, standardHeaders: true, legacyHeaders: false, message: { error: message } })
}
const signupLimiter = limiter(10, 'Too many signup attempts. Please wait a few minutes and try again.')
const loginLimiter = limiter(30, 'Too many sign-in attempts. Please wait a few minutes and try again.')
const recoveryLimiter = limiter(8, 'Too many password recovery attempts. Please wait before trying again.')

router.post('/signup', signupLimiter, async (req, res) => {
  try {
    const { email, password, name } = req.body || {}
    if (!EMAIL_RE.test(email || '')) return res.status(400).json({ error: 'Please enter a valid email address' })
    const pError = passwordError(password)
    if (pError) return res.status(400).json({ error: pError })
    const exists = await store().findUserByEmail(email)
    if (exists) return res.status(409).json({ error: 'An account with this email already exists' })
    const passwordHash = await bcrypt.hash(password, 12)
    const verifyRequired = requireEmailVerification()
    const rawVerify = crypto.randomBytes(32).toString('hex')
    const user = await store().createUser({
      email,
      passwordHash,
      name: name || '',
      emailVerified: !verifyRequired,
      verifyTokenHash: verifyRequired ? sha256(rawVerify) : null,
      verifyTokenExp: verifyRequired ? Date.now() + VERIFY_TTL_MS : null,
      lastLogin: new Date().toISOString(),
    })
    if (verifyRequired) {
      const base = process.env.VERIFY_URL_BASE || process.env.RESET_URL_BASE || 'http://localhost:5174/verify.html'
      await sendVerificationEmail(user.email, `${base}?verify_token=${rawVerify}`).catch(() => {})
      return res.status(201).json({ verificationRequired: true, user: toSafeUser(user) })
    }
    res.status(201).json({ token: signToken(user.id, user.tokenVersion || 0), user: toSafeUser(user) })
  } catch (error) {
    if (error?.status === 409 || error?.code === 11000 || error?.code === 'USER_EXISTS') return res.status(409).json({ error: 'An account with this email already exists' })
    res.status(500).json({ error: 'Could not create your account. Please try again.' })
  }
})

router.post('/login', loginLimiter, async (req, res) => {
  try {
    const { email, password } = req.body || {}
    const user = await store().findUserByEmail(email)
    if (!user || !user.passwordHash) return res.status(401).json({ error: 'Incorrect email or password' })
    const ok = await bcrypt.compare(password || '', user.passwordHash)
    if (!ok) return res.status(401).json({ error: 'Incorrect email or password' })
    if (requireEmailVerification() && !user.emailVerified && !user.googleId) {
      return res.status(403).json({ error: 'Please verify your email address before signing in.', code: 'email_unverified' })
    }
    const updated = await store().updateUser(user.id, { lastLogin: new Date().toISOString() })
    res.json({ token: signToken(user.id, user.tokenVersion || 0), user: toSafeUser(updated || user) })
  } catch { res.status(500).json({ error: 'Something went wrong. Please try again.' }) }
})

router.post('/verify-email', recoveryLimiter, async (req, res) => {
  try {
    const { token } = req.body || {}
    if (!token) return res.status(400).json({ error: 'This verification link is invalid or has expired.' })
    const user = await store().findUserByVerifyToken?.(sha256(token))
    if (!user || !user.verifyTokenExp || user.verifyTokenExp < Date.now()) {
      return res.status(400).json({ error: 'This verification link is invalid or has expired.' })
    }
    const updated = await store().updateUser(user.id, {
      emailVerified: true,
      verifyTokenHash: null,
      verifyTokenExp: null,
      lastLogin: new Date().toISOString(),
    })
    res.json({ ok: true, token: signToken(user.id, user.tokenVersion || 0), user: toSafeUser(updated || user) })
  } catch { res.status(500).json({ error: 'Could not verify your email. Please try again.' }) }
})

router.post('/resend-verification', recoveryLimiter, async (req, res) => {
  try {
    const { email } = req.body || {}
    const user = email ? await store().findUserByEmail(email) : null
    if (user && !user.emailVerified) {
      const rawVerify = crypto.randomBytes(32).toString('hex')
      await store().updateUser(user.id, { verifyTokenHash: sha256(rawVerify), verifyTokenExp: Date.now() + VERIFY_TTL_MS })
      const base = process.env.VERIFY_URL_BASE || process.env.RESET_URL_BASE || 'http://localhost:5174/verify.html'
      await sendVerificationEmail(user.email, `${base}?verify_token=${rawVerify}`).catch(() => {})
    }
    res.json({ ok: true })
  } catch { res.json({ ok: true }) }
})

router.get('/me', requireAuth, async (req, res) => {
  try {
    const user = await store().findUserById(req.userId)
    if (!user) return res.status(404).json({ error: 'Account not found' })
    const plan = effectivePlan(user)
    const usage = await store().getUsage(user.id, currentPeriod())
    const limit = limitFor(plan)
    const safeUser = { ...toSafeUser(user), plan }
    res.json({ user: safeUser, plan, usage: { period: usage.period, llmCalls: usage.llmCalls || 0, sttSeconds: usage.sttSeconds || 0 }, limits: { llmCalls: limit.llmCalls, sttSeconds: limit.sttSeconds } })
  } catch { res.status(500).json({ error: 'Could not load your account.' }) }
})

// Device sign-out is client-token disposal, not global token revocation. Password reset still
// increments tokenVersion and therefore intentionally signs out all existing devices.
router.post('/logout', requireAuth, async (_req, res) => res.json({ ok: true }))

router.post('/refresh', requireAuth, async (req, res) => {
  try {
    const user = await store().findUserById(req.userId)
    if (!user) return res.status(401).json({ error: 'Your session has expired. Please sign in again.' })
    res.json({ token: signToken(user.id, user.tokenVersion || 0) })
  } catch { res.status(500).json({ error: 'Could not refresh session.' }) }
})

router.post('/forgot-password', recoveryLimiter, async (req, res) => {
  try {
    const { email } = req.body || {}
    const user = email ? await store().findUserByEmail(email) : null
    if (user && user.passwordHash) {
      const raw = crypto.randomBytes(32).toString('hex')
      const previous = { resetTokenHash: user.resetTokenHash || null, resetTokenExp: user.resetTokenExp || null }
      await store().updateUser(user.id, { resetTokenHash: sha256(raw), resetTokenExp: Date.now() + RESET_TTL_MS })
      const base = process.env.RESET_URL_BASE || 'http://localhost:5174/reset.html'
      const link = `${base}?token=${raw}`
      const delivery = await sendResetEmail(user.email, link)
      if (delivery?.delivered === 'unavailable') await store().updateUser(user.id, previous)
    }
    res.json({ ok: true })
  } catch { res.json({ ok: true }) }
})

router.post('/reset-password', recoveryLimiter, async (req, res) => {
  try {
    const { token, password } = req.body || {}
    if (!token) return res.status(400).json({ error: 'This reset link is invalid or has expired. Request a new one.' })
    const pError = passwordError(password)
    if (pError) return res.status(400).json({ error: pError })
    const user = await store().findUserByResetToken(sha256(token))
    if (!user || !user.resetTokenExp || user.resetTokenExp < Date.now()) return res.status(400).json({ error: 'This reset link is invalid or has expired. Request a new one.' })
    const passwordHash = await bcrypt.hash(password, 12)
    const tokenVersion = (user.tokenVersion || 0) + 1
    const updated = await store().updateUser(user.id, { passwordHash, tokenVersion, resetTokenHash: null, resetTokenExp: null, lastLogin: new Date().toISOString() })
    res.json({ ok: true, token: signToken(user.id, tokenVersion), user: toSafeUser(updated) })
  } catch { res.status(500).json({ error: 'Could not reset your password. Please try again.' }) }
})

function googleConfigReady() {
  return ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REDIRECT_URI', 'DESKTOP_REDIRECT'].every(key => String(process.env[key] || '').trim())
}
function parseCookie(req, name) {
  const raw = String(req.headers.cookie || '')
  for (const part of raw.split(';')) {
    const [key, ...rest] = part.trim().split('=')
    if (key === name) return decodeURIComponent(rest.join('='))
  }
  return null
}
function sameValue(a, b) {
  const aa = Buffer.from(String(a || '')); const bb = Buffer.from(String(b || ''))
  return aa.length === bb.length && aa.length > 0 && crypto.timingSafeEqual(aa, bb)
}

router.get('/google', (req, res) => {
  if (!googleConfigReady()) return res.status(503).json({ error: 'Google sign-in is not configured' })
  const state = crypto.randomBytes(24).toString('base64url')
  res.cookie('mm_google_oauth_state', state, { httpOnly: true, sameSite: 'lax', secure: req.secure || ['1', 'true'].includes(String(process.env.MOCKMATE_HOSTED || '').toLowerCase()), maxAge: GOOGLE_STATE_TTL_MS, path: '/auth/google/callback' })
  const params = new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID, redirect_uri: process.env.GOOGLE_REDIRECT_URI, response_type: 'code', scope: 'openid email profile', access_type: 'offline', prompt: 'select_account', state })
  res.redirect('https://accounts.google.com/o/oauth2/v2/auth?' + params)
})

router.get('/google/callback', async (req, res) => {
  try {
    if (!googleConfigReady()) return res.status(503).send('Google sign-in is not configured')
    const { code, state } = req.query
    const expectedState = parseCookie(req, 'mm_google_oauth_state')
    res.clearCookie('mm_google_oauth_state', { path: '/auth/google/callback' })
    if (!code || !sameValue(state, expectedState)) return res.status(400).send('Invalid Google sign-in state')

    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code, client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET, redirect_uri: process.env.GOOGLE_REDIRECT_URI, grant_type: 'authorization_code' }),
      signal: AbortSignal.timeout(10_000),
    })
    const tokenRes = await tokenResponse.json().catch(() => ({}))
    if (!tokenResponse.ok || !tokenRes.id_token) return res.status(401).send('Google sign-in failed')

    const infoRes = await fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(tokenRes.id_token), { signal: AbortSignal.timeout(10_000) })
    if (!infoRes.ok) return res.status(401).send('Google token verification failed')
    const profile = await infoRes.json()
    if (profile.aud !== process.env.GOOGLE_CLIENT_ID) return res.status(401).send('Google token audience mismatch')
    if (profile.email_verified !== 'true' && profile.email_verified !== true) return res.status(401).send('Google email is not verified')
    if (!profile.email || !profile.sub) return res.status(401).send('Google profile incomplete')

    let user = await store().findUserByGoogleId(profile.sub)
    if (!user) {
      const existing = await store().findUserByEmail(profile.email)
      if (existing?.passwordHash && !existing.googleId) return res.status(409).send('An account already exists for this email. Sign in with your password first.')
      user = existing
    }
    if (!user) user = await store().createUser({ email: profile.email, googleId: profile.sub, name: profile.name || '', lastLogin: new Date().toISOString() })
    else user = await store().updateUser(user.id, { googleId: profile.sub, lastLogin: new Date().toISOString() })
    res.redirect(`${process.env.DESKTOP_REDIRECT}?token=${encodeURIComponent(signToken(user.id, user.tokenVersion || 0))}`)
  } catch (e) {
    console.error('[auth/google] callback failed:', e?.message || e)
    res.status(500).send('Google sign-in error')
  }
})

export default router
