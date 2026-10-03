// Single API wrapper for the auth/SaaS backend. Every authenticated call goes
// through here — token attachment, JSON handling, and 401 handling live in ONE place.
import { diagnostic, createDiagnosticRequestId } from '../lib/diagnostics'
import { setActiveAccountScope, clearActiveAccountScope } from '../lib/accountScope'

const electronAuth = typeof window !== 'undefined' ? window.electronAPI?.auth : null
const API_BASE =
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_BASE) ||
  (typeof window !== 'undefined' && window.electronAPI?.getApiBase?.()) ||
  'http://localhost:4000'

export const usesDeviceLocalAccounts = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/i.test(API_BASE)

let memToken = null
export async function getToken() {
  if (electronAuth) { try { return await electronAuth.getToken() } catch { return null } }
  return memToken
}
export async function setToken(token) {
  if (electronAuth) {
    try { await electronAuth.setToken(token); return }
    catch (error) {
      diagnostic('auth', 'token_store_failed', { errorName: error?.name || 'Error' }, 'error')
      throw new ApiError('MockMate could not securely save your session. Restart the app and try again.', 0)
    }
  }
  memToken = token
}
export async function clearToken() {
  if (electronAuth) { try { await electronAuth.clearToken() } catch {} }
  else memToken = null
}

let onUnauthorized = () => {}
export function setUnauthorizedHandler(fn) { onUnauthorized = fn || (() => {}) }
export async function handleUnauthorized(source = 'api') {
  diagnostic('auth', 'session_unauthorized', { source }, 'warn')
  try { await clearToken() } catch {}
  clearActiveAccountScope()
  try { onUnauthorized() } catch {}
}

async function request(path, { method = 'GET', body, auth = false, timeoutMs = 15000 } = {}) {
  const requestId = createDiagnosticRequestId('auth')
  const startedAt = performance.now()
  const headers = { 'X-MockMate-Request-Id': requestId }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (auth) {
    const token = await getToken()
    if (token) headers.Authorization = `Bearer ${token}`
  }

  let res
  diagnostic('auth', 'request_started', { requestId, path, method, authenticated: auth, timeoutMs })
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null
  const timer = controller && timeoutMs > 0 ? setTimeout(() => controller.abort(), timeoutMs) : null
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method, headers, body: body !== undefined ? JSON.stringify(body) : undefined, signal: controller?.signal,
    })
  } catch (err) {
    diagnostic('auth', 'request_failed', { requestId, path, method, durationMs: Math.round(performance.now() - startedAt), reason: err?.name === 'AbortError' ? 'timeout' : 'network' }, 'error')
    throw new ApiError(
      err?.name === 'AbortError'
        ? 'MockMate took too long to respond. Please try again.'
        : usesDeviceLocalAccounts
          ? 'MockMate’s account service did not start. Restart the app and try again.'
          : 'Can’t reach MockMate. Check your connection and try again.',
      0,
    )
  } finally {
    if (timer) clearTimeout(timer)
  }

  if (res.status === 401 && auth) {
    await handleUnauthorized(path)
    throw new ApiError('Your session expired. Please sign in again.', 401)
  }

  let data = null
  try { data = await res.json() } catch {}
  if (!res.ok) {
    diagnostic('auth', 'request_rejected', { requestId, path, method, status: res.status, durationMs: Math.round(performance.now() - startedAt) }, 'warn')
    throw new ApiError(data?.error || 'Something went wrong. Please try again.', res.status)
  }
  diagnostic('auth', 'request_completed', { requestId, path, method, status: res.status, durationMs: Math.round(performance.now() - startedAt) })
  return data
}

export class ApiError extends Error {
  constructor(message, status) { super(message); this.name = 'ApiError'; this.status = status }
}

function rememberUser(user) { if (user?.id) setActiveAccountScope(user.id); return user }

export async function forgotPassword(email) { return request('/auth/forgot-password', { method: 'POST', body: { email } }) }
export async function signup({ name, email, password }) {
  const { token, user } = await request('/auth/signup', { method: 'POST', body: { name, email, password } })
  await setToken(token)
  return rememberUser(user)
}
export async function login({ email, password }) {
  const { token, user } = await request('/auth/login', { method: 'POST', body: { email, password } })
  await setToken(token)
  return rememberUser(user)
}
export async function fetchMe() {
  const payload = await request('/auth/me', { auth: true })
  rememberUser(payload?.user)
  return payload
}
export async function updateProfile(patch) { const { user } = await request('/me', { method: 'PATCH', body: patch, auth: true }); return rememberUser(user) }
export async function logout() {
  try { await request('/auth/logout', { method: 'POST', auth: true }) } catch {}
  await clearToken()
  clearActiveAccountScope()
}
export async function deleteAccount() {
  await request('/me', { method: 'DELETE', auth: true, timeoutMs: 30000 })
  await clearToken()
  clearActiveAccountScope()
  try { onUnauthorized() } catch {}
  return true
}
export async function refreshSession() {
  const { token } = await request('/auth/refresh', { method: 'POST', auth: true })
  if (token) await setToken(token)
  return token
}

function openUrl(url) {
  if (typeof window !== 'undefined' && window.electronAPI?.openExternal) window.electronAPI.openExternal(url)
  else if (typeof window !== 'undefined') window.open(url, '_blank', 'noopener')
}
export async function startCheckout() { const { url } = await request('/billing/checkout', { method: 'POST', auth: true }); if (url) openUrl(url); return url }
export async function openBillingPortal() { const { url } = await request('/billing/portal', { method: 'POST', auth: true }); if (url) openUrl(url); return url }
export async function reconcileBilling() { return request('/billing/reconcile', { method: 'POST', auth: true }) }
export function startGoogleAuth() { openUrl(`${API_BASE}/auth/google`) }
export async function consumeOAuthRedirectToken() {
  if (typeof window === 'undefined' || !window.location?.search) return null
  try {
    const params = new URLSearchParams(window.location.search)
    const token = params.get('token') || params.get('oauth_token')
    if (!token) return null
    await setToken(token)
    params.delete('token')
    params.delete('oauth_token')
    const query = params.toString()
    const cleanUrl = `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash || ''}`
    window.history?.replaceState?.({}, '', cleanUrl)
    return token
  } catch { return null }
}
