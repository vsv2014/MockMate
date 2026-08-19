// Client-side /api router (Phase 2b B5). One drop-in replacement for fetch('/api/…'):
//   • Managed mode  → the hosted/authed backend (getApiBase → MOCKMATE_API_BASE, else :4000),
//                     with the user's JWT attached → metered per user (Mongo when hosted).
//   • BYOK mode     → relative /api (the local private server on :3002). No auth, keys stay local.
// Same signature as fetch(path, opts) and returns a Response, so call sites don't change shape.
import { isManaged } from './aiMode'
import { getToken } from '../auth/api'
import { diagnostic, createDiagnosticRequestId } from './diagnostics'

function managedBase() {
  return (typeof window !== 'undefined' && window.electronAPI?.getApiBase?.())
    || (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_BASE)
    || 'http://localhost:4000'
}

export async function apiFetch(path, opts = {}) {
  const { timeoutMs, signal: outerSignal, diagnosticRequestId, ...rest } = opts
  const base = isManaged() ? managedBase() : ''
  const requestId = diagnosticRequestId || createDiagnosticRequestId('api')
  const startedAt = performance.now()
  const headers = { ...(rest.headers || {}) }
  if (base) {   // managed → attach the JWT so the backend can auth + meter this user
    try { const t = await getToken(); if (t) headers.Authorization = `Bearer ${t}` } catch {}
  }

  let signal = outerSignal
  let timer
  if (timeoutMs > 0 && typeof AbortController !== 'undefined') {
    const ac = new AbortController()
    if (outerSignal) {
      if (outerSignal.aborted) ac.abort()
      else outerSignal.addEventListener('abort', () => ac.abort(), { once: true })
    }
    timer = setTimeout(() => ac.abort(), timeoutMs)
    signal = ac.signal
  }

  diagnostic('api', 'request_started', { requestId, path, method: rest.method || 'GET', mode: base ? 'managed' : 'byok', timeoutMs: timeoutMs || 0 })
  try {
    const response = await fetch(`${base}${path}`, { ...rest, headers, signal })
    diagnostic('api', 'request_completed', {
      requestId, path, method: rest.method || 'GET', status: response.status,
      ok: response.ok, durationMs: Math.round(performance.now() - startedAt),
    }, response.ok ? 'info' : 'warn')
    return response
  } catch (err) {
    diagnostic('api', 'request_failed', {
      requestId, path, method: rest.method || 'GET', durationMs: Math.round(performance.now() - startedAt),
      errorName: err?.name, reason: err?.name === 'AbortError' ? 'aborted_or_timeout' : 'network_error',
    }, 'error')
    throw err
  } finally {
    if (timer) clearTimeout(timer)
  }
}
