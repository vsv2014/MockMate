// Single API wrapper for the auth/SaaS backend. Every authenticated call goes
// through here — token attachment, JSON handling, and 401 handling live in ONE
// place, not scattered across components.
//
// Token storage: Electron safeStorage (encrypted, in userData) via the preload
// bridge — NEVER localStorage. In plain-browser dev (no Electron) it falls back
// to an in-memory value, which is fine because the product only ships in Electron.

const electronAuth = typeof window !== 'undefined' ? window.electronAPI?.auth : null

// Base URL is env-configurable so we can point at a hosted backend later with no
// code change. Order: Electron-provided → Vite env → local fork default.
const API_BASE =
  (typeof window !== 'undefined' && window.electronAPI?.getApiBase?.()) ||
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_BASE) ||
  'http://localhost:4000'

// ── Token storage ─────────────────────────────────────────────────────────────
let memToken = null   // browser-dev fallback only
export async function getToken() {
  if (electronAuth) { try { return await electronAuth.getToken() } catch { return null } }
  return memToken
}
export async function setToken(token) {
  if (electronAuth) { try { await electronAuth.setToken(token) } catch {} }
  else memToken = token
}
export async function clearToken() {
  if (electronAuth) { try { await electronAuth.clearToken() } catch {} }
  else memToken = null
}

// ── Global 401 handler ──────────────────────────────────────────────────────
// AuthGate registers a callback; any 401 from an authed call clears the token and
// fires it (→ redirect to Login) so expired sessions bounce out silently.
let onUnauthorized = () => {}
export function setUnauthorizedHandler(fn) { onUnauthorized = fn || (() => {}) }

// ── Core request ────────────────────────────────────────────────────────────
async function request(path, { method = 'GET', body, auth = false } = {}) {
  const headers = {}
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (auth) {
    const token = await getToken()
    if (token) headers['Authorization'] = `Bearer ${token}`
  }

  let res
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method, headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  } catch {
    // Network / backend-down. Distinct, actionable message — not a bare throw.
    throw new ApiError('Can’t reach MockMate. Check your connection and try again.', 0)
  }

  if (res.status === 401 && auth) {
    await clearToken()
    onUnauthorized()
    throw new ApiError('Your session expired. Please sign in again.', 401)
  }

  let data = null
  try { data = await res.json() } catch { /* empty/no-json body */ }

  if (!res.ok) {
    throw new ApiError(data?.error || 'Something went wrong. Please try again.', res.status)
  }
  return data
}

export class ApiError extends Error {
  constructor(message, status) { super(message); this.name = 'ApiError'; this.status = status }
}

// ── Auth endpoints ────────────────────────────────────────────────────────────
// Always resolves (backend returns 200 regardless, to avoid email enumeration).
export async function forgotPassword(email) {
  try { await request('/auth/forgot-password', { method: 'POST', body: { email } }) } catch { /* never reveal */ }
}
export async function signup({ name, email, password }) {
  const { token, user } = await request('/auth/signup', { method: 'POST', body: { name, email, password } })
  await setToken(token)
  return user
}
export async function login({ email, password }) {
  const { token, user } = await request('/auth/login', { method: 'POST', body: { email, password } })
  await setToken(token)
  return user
}
export async function fetchMe() {
  return request('/auth/me', { auth: true })   // → { user, plan, usage }
}
export async function updateProfile(patch) {
  const { user } = await request('/me', { method: 'PATCH', body: patch, auth: true })
  return user
}
export async function logout() {
  try { await request('/auth/logout', { method: 'POST', auth: true }) } catch { /* best-effort */ }
  await clearToken()
}
