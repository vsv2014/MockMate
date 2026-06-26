import jwt from 'jsonwebtoken'
import { store } from '../store.js'

// Auth gate. Beyond verifying the JWT signature/expiry, we check a per-user `tokenVersion`
// (the `tv` claim) against the stored value — a password reset bumps it, which instantly
// invalidates every token issued before the reset (stateless JWTs otherwise live for 30 days).
export async function requireAuth(req, res, next) {
  const header = req.headers.authorization || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : null
  if (!token) return res.status(401).json({ error: 'Missing token' })
  let payload
  try { payload = jwt.verify(token, process.env.JWT_SECRET) }
  catch { return res.status(401).json({ error: 'Invalid or expired token' }) }
  try {
    const user = await store().findUserById(payload.sub)
    if (!user || (user.tokenVersion || 0) !== (payload.tv || 0)) {
      return res.status(401).json({ error: 'Your session has expired. Please sign in again.' })
    }
    req.userId = payload.sub
    next()
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' })
  }
}

export function signToken(userId, tokenVersion = 0) {
  return jwt.sign({ sub: String(userId), tv: tokenVersion }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES || '30d' })
}
