/**
 * Live hint HTTP/SSE transport — shared by LiveCompanion.
 * Does not own GenerationManager / InterviewState / classification.
 */
import { apiFetch } from '../lib/apiClient.js'
import { getRetryAfterMs } from '../../shared/llm-errors.js'

export function splitSseBuffer(buf = '') {
  const events = []
  // A trailing CR may be the first half of a CRLF split across reads.
  // Preserve it only when it does not already complete an empty SSE line.
  // A complete CR-only frame (...\\r\\r) must dispatch immediately.
  const source = String(buf)
  let rest = source.replace(/\r\n|\r|\n/g, '\n')
  if (source.endsWith('\r') && !rest.endsWith('\n\n')) {
    rest = rest.slice(0, -1) + '\r'
  }
  let nn
  while ((nn = rest.indexOf('\n\n')) !== -1) {
    const raw = rest.slice(0, nn)
    rest = rest.slice(nn + 2)
    const ev = raw.match(/^event: (.*)$/m)?.[1]
    let data = null
    try { data = JSON.parse(raw.match(/^data: ([\s\S]*)$/m)?.[1] ?? 'null') } catch { data = null }
    events.push({ event: ev, data, raw })
  }
  return { events, rest }
}

function httpError(status, data, headers) {
  const error = new Error(data?.error || `MockMate request failed (${status}).`)
  error.status = status
  if (data?.code) error.code = data.code
  const retryAfterMs = getRetryAfterMs({ retryAfterMs: data?.retryAfterMs, headers })
  if (retryAfterMs > 0) error.retryAfterMs = retryAfterMs
  return error
}

async function responseError(res) {
  let data = null
  try { data = await res.clone().json() } catch {}
  return httpError(res.status, data, res.headers)
}

export function formatLiveError(error) {
  const message = typeof error === 'string'
    ? error
    : error?.message || error?.error || 'The Live request could not be completed.'
  const code = String(error?.code || '').toLowerCase()
  const retryAfterMs = Number(error?.retryAfterMs)
  if (!Number.isFinite(retryAfterMs) || retryAfterMs <= 0) return message
  const seconds = Math.max(1, Math.ceil(retryAfterMs / 1000))
  if (['rate_limit', 'provider_limits', 'provider_cooling', 'deepgram_rate_limit'].includes(code) || error?.status === 429) {
    return `${message} Earliest retry window: about ${seconds} seconds.`
  }
  return message
}

const STREAM_UNAVAILABLE = new Set([404, 405, 501])

export async function streamLiveHint({ body, signal, isCurrent = () => true, onEvent, onFallback }) {
  const res = await apiFetch('/api/hint-stream', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, signal, body: JSON.stringify(body),
  })
  if (!isCurrent() || signal?.aborted) return { mode: 'aborted' }

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
    // HTTP 200 with no readable body is a failed stream, not proof the
    // streaming route was missing. Starting /api/hint now can issue a second
    // paid LLM request after the first endpoint has already charged.
    if (!isCurrent() || signal?.aborted) return { mode: 'aborted' }
    await onEvent?.({ event: 'error', data: {
      error: 'The answer stream returned no content. Please retry.',
    } })
    return { mode: 'incomplete' }
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let sseBuf = ''
  let sawTerminalEvent = false
  const dispatch = async events => {
    for (const ev of events) {
      if (['done', 'skip', 'error'].includes(ev.event)) sawTerminalEvent = true
      if (!isCurrent() || signal?.aborted) { try { await reader.cancel() } catch {}; return 'aborted' }
      const result = await onEvent?.(ev)
      if (result === 'stop') { try { await reader.cancel() } catch {}; return 'stopped' }
    }
    return null
  }

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (!isCurrent() || signal?.aborted) { try { await reader.cancel() } catch {}; return { mode: 'aborted' } }
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
  if (!isCurrent() || signal?.aborted) return { mode: 'aborted' }
  if (!sawTerminalEvent) {
    // A successful HTTP status does not prove the LLM completed. Do not
    // silently mark partially streamed answers as complete or bill twice via
    // a speculative fallback call.
    const terminal = await dispatch([{ event: 'error', data: {
      error: 'The answer stream disconnected before completion. Please retry.',
    } }])
    return { mode: terminal || 'incomplete' }
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
