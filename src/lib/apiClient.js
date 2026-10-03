// Client-side /api router:
//   • Managed mode → hosted/authed backend + JWT
//   • BYOK mode    → relative local /api on loopback
import { isManaged } from './aiMode'
import { getToken, handleUnauthorized } from '../auth/api'
import { diagnostic, createDiagnosticRequestId } from './diagnostics'

function managedBase() {
  return (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_BASE)
    || (typeof window !== 'undefined' && window.electronAPI?.getApiBase?.())
    || 'http://localhost:4000'
}

const STRICT_METADATA_PATHS = new Set(['/api/providers', '/api/models'])

export async function apiFetch(path, opts = {}) {
  const { timeoutMs, signal: outerSignal, diagnosticRequestId, ...rest } = opts
  const base = isManaged() ? managedBase() : ''
  const requestId = diagnosticRequestId || createDiagnosticRequestId('api')
  const startedAt = performance.now()
  const headers = { ...(rest.headers || {}), 'X-MockMate-Request-Id': requestId }
  if (base) {
    try { const t = await getToken(); if (t) headers.Authorization = `Bearer ${t}` } catch {}
  }

  let signal = outerSignal
  let timer
  let abortRelay = null
  if (timeoutMs > 0 && typeof AbortController !== 'undefined') {
    const ac = new AbortController()
    if (outerSignal) {
      if (outerSignal.aborted) ac.abort(outerSignal.reason)
      else {
        abortRelay = () => ac.abort(outerSignal.reason)
        outerSignal.addEventListener('abort', abortRelay, { once: true })
      }
    }
    timer = setTimeout(() => ac.abort(new DOMException('MockMate request timed out', 'AbortError')), timeoutMs)
    signal = ac.signal
  }

  diagnostic('api', 'request_started', { requestId, path, method: rest.method || 'GET', mode: base ? 'managed' : 'byok', timeoutMs: timeoutMs || 0 })
  try {
    const response = await fetch(`${base}${path}`, { ...rest, headers, signal })
    diagnostic('api', 'request_completed', {
      requestId, path, method: rest.method || 'GET', status: response.status,
      ok: response.ok, durationMs: Math.round(performance.now() - startedAt),
    }, response.ok ? 'info' : 'warn')
    if (base && response.status === 401) await handleUnauthorized(path)
    // Provider/model discovery drives the setup UI. Returning an HTTP error as if it were an empty
    // capability response makes outages/auth failures look like "no providers configured".
    if (STRICT_METADATA_PATHS.has(path) && !response.ok) {
      const e = new Error(`MockMate metadata request failed (${response.status})`)
      e.status = response.status
      throw e
    }
    return response
  } catch (err) {
    diagnostic('api', 'request_failed', {
      requestId, path, method: rest.method || 'GET', durationMs: Math.round(performance.now() - startedAt),
      errorName: err?.name, reason: err?.name === 'AbortError' ? 'aborted_or_timeout' : 'network_or_http_error',
    }, 'error')
    throw err
  } finally {
    if (timer) clearTimeout(timer)
    if (outerSignal && abortRelay) outerSignal.removeEventListener('abort', abortRelay)
  }
}
