import jwt from 'jsonwebtoken'
import { store } from '../store.js'

// Auth gate. Signature/expiry/token-version failures are authentication failures.
// Store/database failures are service failures and MUST NOT be translated into 401,
// because clients intentionally clear credentials when they see 401.
export async function requireAuth(req, res, next) {
  const header = req.headers.authorization || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : null
  if (!token) return res.status(401).json({ error: 'Missing token' })

  let payload
  try { payload = jwt.verify(token, process.env.JWT_SECRET) }
  catch { return res.status(401).json({ error: 'Invalid or expired token' }) }

  let user
  try {
    user = await store().findUserById(payload.sub)
  } catch (error) {
    console.error('[auth] identity store unavailable:', error?.message || error)
    return res.status(503).json({ error: 'Account service is temporarily unavailable. Please try again.' })
  }

  if (!user || (user.tokenVersion || 0) !== (payload.tv || 0)) {
    return res.status(401).json({ error: 'Your session has expired. Please sign in again.' })
  }
  req.userId = payload.sub
  req.tokenPayload = payload
  next()
}

export function signToken(userId, tokenVersion = 0) {
  return jwt.sign({ sub: String(userId), tv: tokenVersion }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES || '7d' })
}
