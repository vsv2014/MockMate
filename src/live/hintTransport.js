/**
 * Live hint HTTP/SSE transport — shared by LiveCompanion.
 * Does not own GenerationManager / InterviewState / classification.
 */
import { apiFetch } from '../lib/apiClient.js'

/** Split an SSE buffer into complete events; returns { events, rest }. */
export function splitSseBuffer(buf = '') {
  const events = []
  let rest = String(buf)
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

/**
 * POST /api/hint-stream and yield SSE events via onEvent.
 * Falls back to /api/hint when stream is unavailable.
 *
 * @param {object} opts
 * @param {object} opts.body — hint request body
 * @param {AbortSignal} [opts.signal]
 * @param {() => boolean} [opts.isCurrent]
 * @param {(ev: { event: string, data: any }) => void | Promise<void>} opts.onEvent
 * @param {() => Promise<void>} [opts.onFallback] — called when stream cannot start
 */
export async function streamLiveHint({ body, signal, isCurrent = () => true, onEvent, onFallback }) {
  const res = await apiFetch('/api/hint-stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify(body),
  })
  if (!isCurrent()) return { mode: 'aborted' }
  if (!res.ok || !res.body) {
    if (onFallback) await onFallback()
    else {
      const fb = await apiFetch('/api/hint', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal,
        body: JSON.stringify(body),
      })
      const d = await fb.json()
      if (!isCurrent()) return { mode: 'aborted' }
      if (d.error) throw new Error(d.error)
      await onEvent?.({ event: 'fallback', data: d })
    }
    return { mode: 'fallback' }
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let sseBuf = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (!isCurrent()) { try { await reader.cancel() } catch {}; return { mode: 'aborted' } }
    sseBuf += decoder.decode(value, { stream: true })
    const { events, rest } = splitSseBuffer(sseBuf)
    sseBuf = rest
    for (const ev of events) {
      if (!isCurrent()) { try { await reader.cancel() } catch {}; return { mode: 'aborted' } }
      const result = await onEvent?.(ev)
      if (result === 'stop') {
        try { await reader.cancel() } catch {}
        return { mode: 'stopped' }
      }
    }
  }
  return { mode: 'stream' }
}

/** Non-streaming /api/hint helper used as Live safety net. */
export async function fetchLiveHintFallback({ body, signal, isCurrent = () => true }) {
  const res = await apiFetch('/api/hint', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify(body),
  })
  const d = await res.json()
  if (!isCurrent()) return null
  if (d.error) throw new Error(d.error)
  return d
}
