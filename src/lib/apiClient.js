// Client-side /api router (Phase 2b B5). One drop-in replacement for fetch('/api/…'):
//   • Managed mode  → the hosted/authed backend (getApiBase → MOCKMATE_API_BASE, else :4000),
//                     with the user's JWT attached → metered per user (Mongo when hosted).
//   • BYOK mode     → relative /api (the local private server on :3002). No auth, keys stay local.
// Same signature as fetch(path, opts) and returns a Response, so call sites don't change shape.
import { isManaged } from './aiMode'
import { getToken } from '../auth/api'

function managedBase() {
  return (typeof window !== 'undefined' && window.electronAPI?.getApiBase?.())
    || (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_BASE)
    || 'http://localhost:4000'
}

export async function apiFetch(path, opts = {}) {
  const { timeoutMs, signal: outerSignal, ...rest } = opts
  const base = isManaged() ? managedBase() : ''
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

  try {
    return await fetch(`${base}${path}`, { ...rest, headers, signal })
  } finally {
    if (timer) clearTimeout(timer)
  }
}
