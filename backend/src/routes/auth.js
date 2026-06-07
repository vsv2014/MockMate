import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { User } from '../models/User.js'
import { signToken } from '../middleware/auth.js'

const router = Router()
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// POST /auth/signup { email, password, name? }
router.post('/signup', async (req, res) => {
  try {
    const { email, password, name } = req.body || {}
    if (!EMAIL_RE.test(email || '')) return res.status(400).json({ error: 'Valid email required' })
    if (!password || password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' })
    const exists = await User.findOne({ email: email.toLowerCase() })
    if (exists) return res.status(409).json({ error: 'An account with this email already exists' })
    const passwordHash = await bcrypt.hash(password, 12)
    const user = await User.create({ email: email.toLowerCase(), passwordHash, name: name || '', lastLogin: new Date() })
    res.status(201).json({ token: signToken(user._id), user: user.toSafeJSON() })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// POST /auth/login { email, password }
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body || {}
    const user = await User.findOne({ email: (email || '').toLowerCase() })
    if (!user || !user.passwordHash) return res.status(401).json({ error: 'Invalid email or password' })
    const ok = await bcrypt.compare(password || '', user.passwordHash)
    if (!ok) return res.status(401).json({ error: 'Invalid email or password' })
    user.lastLogin = new Date(); await user.save()
    res.json({ token: signToken(user._id), user: user.toSafeJSON() })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// --- Google OAuth (authorization-code flow; needs GOOGLE_* env to be active) ---
// GET /auth/google → redirect to Google consent
router.get('/google', (req, res) => {
  if (!process.env.GOOGLE_CLIENT_ID) return res.status(503).json({ error: 'Google OAuth not configured' })
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: process.env.GOOGLE_REDIRECT_URI,
    response_type: 'code',
    scope: 'openid email profile',
    access_type: 'offline',
    prompt: 'select_account'
  })
  res.redirect('https://accounts.google.com/o/oauth2/v2/auth?' + params)
})

// GET /auth/google/callback?code=... → exchange code, upsert user, hand token to desktop
router.get('/google/callback', async (req, res) => {
  try {
    const { code } = req.query
    if (!code) return res.status(400).send('Missing code')
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code, client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET,
        redirect_uri: process.env.GOOGLE_REDIRECT_URI, grant_type: 'authorization_code'
      })
    }).then(r => r.json())
    if (!tokenRes.id_token) return res.status(401).send('Google auth failed')
    const profile = JSON.parse(Buffer.from(tokenRes.id_token.split('.')[1], 'base64').toString())
    let user = await User.findOne({ $or: [{ googleId: profile.sub }, { email: profile.email }] })
    if (!user) user = await User.create({ email: profile.email, googleId: profile.sub, name: profile.name || '', lastLogin: new Date() })
    else { user.googleId = profile.sub; user.lastLogin = new Date(); await user.save() }
    const token = signToken(user._id)
    // Hand the token to the desktop app via its loopback listener
    res.redirect(`${process.env.DESKTOP_REDIRECT}?token=${token}`)
  } catch (e) { res.status(500).send('Google auth error: ' + e.message) }
})

export default router
