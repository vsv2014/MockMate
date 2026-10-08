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
      if (outerSignal.aborted) ac.abort()
      else {
        abortRelay = () => ac.abort()
        outerSignal.addEventListener('abort', abortRelay, { once: true })
      }
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
    if (base && response.status === 401) await handleUnauthorized(path)
    return response
  } catch (err) {
    diagnostic('api', 'request_failed', {
      requestId, path, method: rest.method || 'GET', durationMs: Math.round(performance.now() - startedAt),
      errorName: err?.name, reason: err?.name === 'AbortError' ? 'aborted_or_timeout' : 'network_error',
    }, 'error')
    throw err
  } finally {
    if (timer) clearTimeout(timer)
    if (outerSignal && abortRelay) outerSignal.removeEventListener('abort', abortRelay)
  }
}

/** Managed STT uses the authenticated backend WebSocket, never a provider key. */
export function managedSttGatewayUrl(upstreamListenUrl) {
  if (!isManaged()) throw new Error('Managed STT gateway is only available in managed mode')
  const base = managedBase()
  const endpoint = new URL(base.replace(/\/$/, '') + '/api/stt-stream')
  if (endpoint.protocol === 'https:') endpoint.protocol = 'wss:'
  else if (endpoint.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(endpoint.hostname)) {
    endpoint.protocol = 'ws:'
  } else {
    throw new Error('Managed audio must connect over a secure WebSocket')
  }
  endpoint.search = new URL(upstreamListenUrl).search
  return endpoint.toString()
}
