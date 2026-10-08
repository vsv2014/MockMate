/**
 * Live hint HTTP/SSE transport — shared by LiveCompanion.
 * Does not own GenerationManager / InterviewState / classification.
 */
import { apiFetch } from '../lib/apiClient.js'

export function splitSseBuffer(buf = '') {
  const events = []
  // Preserve a trailing CR: the next network chunk may begin with LF.
  const source = String(buf)
  const trailingCR = source.endsWith('\r')
  let rest = source.replace(/\r\n|\r|\n/g, '\n')
  if (trailingCR) rest = rest.slice(0, -1)
  let nn
  while ((nn = rest.indexOf('\n\n')) !== -1) {
    const raw = rest.slice(0, nn)
    rest = rest.slice(nn + 2)
    const ev = raw.match(/^event: (.*)$/m)?.[1]
    let data = null
    try { data = JSON.parse(raw.match(/^data: ([\s\S]*)$/m)?.[1] ?? 'null') } catch { data = null }
    events.push({ event: ev, data, raw })
  }
  return { events, rest: rest + (trailingCR ? '\r' : '') }
}

function httpError(status, data) {
  const error = new Error(data?.error || `MockMate request failed (${status}).`)
  error.status = status
  return error
}

async function responseError(res) {
  let data = null
  try { data = await res.clone().json() } catch {}
  return httpError(res.status, data)
}

const STREAM_UNAVAILABLE = new Set([404, 405, 501])

export async function streamLiveHint({ body, signal, isCurrent = () => true, onEvent, onFallback }) {
  const res = await apiFetch('/api/hint-stream', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, signal, body: JSON.stringify(body),
  })
  if (!isCurrent()) return { mode: 'aborted' }

  // Only fall back when the streaming transport genuinely is unavailable. Auth,
  // quota, validation, rate-limit and server errors must not cause a second LLM call.
  if (!res.ok) {
    if (!STREAM_UNAVAILABLE.has(res.status)) throw await responseError(res)
    if (onFallback) await onFallback()
    else {
      const fb = await apiFetch('/api/hint', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal, body: JSON.stringify(body),
      })
      if (!fb.ok) throw await responseError(fb)
      const d = await fb.json()
      if (!isCurrent()) return { mode: 'aborted' }
      await onEvent?.({ event: 'fallback', data: d })
    }
    return { mode: 'fallback' }
  }

  if (!res.body) {
    if (onFallback) await onFallback()
    return { mode: 'fallback' }
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let sseBuf = ''
  const dispatch = async events => {
    for (const ev of events) {
      if (!isCurrent()) { try { await reader.cancel() } catch {}; return 'aborted' }
      const result = await onEvent?.(ev)
      if (result === 'stop') { try { await reader.cancel() } catch {}; return 'stopped' }
    }
    return null
  }

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (!isCurrent()) { try { await reader.cancel() } catch {}; return { mode: 'aborted' } }
    sseBuf += decoder.decode(value, { stream: true })
    const split = splitSseBuffer(sseBuf)
    sseBuf = split.rest
    const terminal = await dispatch(split.events)
    if (terminal) return { mode: terminal }
  }

  // Flush TextDecoder's UTF-8 tail and accept one final SSE event even if the
  // upstream closed without the conventional blank-line delimiter.
  sseBuf += decoder.decode()
  if (sseBuf.trim()) {
    const split = splitSseBuffer(`${sseBuf}\n\n`)
    const terminal = await dispatch(split.events)
    if (terminal) return { mode: terminal }
  }
  return { mode: 'stream' }
}

export async function fetchLiveHintFallback({ body, signal, isCurrent = () => true }) {
  const res = await apiFetch('/api/hint', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, signal, body: JSON.stringify(body),
  })
  if (!res.ok) throw await responseError(res)
  const d = await res.json()
  if (!isCurrent()) return null
  return d
}
