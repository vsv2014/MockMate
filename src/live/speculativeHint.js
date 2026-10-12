/**
 * Early ("speculative") Live answer start.
 *
 * While question capture waits out its silence window for a question that already
 * looks complete, LiveCompanion prepares the exact request it would send after the
 * question commits and starts it here. Nothing is shown to the user. When the
 * question commits, the in-flight request is handed over only if its key and its
 * serialized body are identical to the committed request; anything else aborts it
 * and the normal request is sent. A mismatch can therefore cost time, never answer
 * the wrong question.
 *
 * Aborting the fetch closes the SSE connection, which makes the server abort the
 * provider request (no failover, no provider cooldown). Unclaimed requests expire.
 */
import { apiFetch } from '../lib/apiClient.js'

export const SPECULATIVE_HINT_MAX_AGE_MS = 8_000

export function createSpeculativeHint({
  fetchImpl = apiFetch,
  now = () => Date.now(),
  setTimeoutFn = (fn, ms) => setTimeout(fn, ms),
  clearTimeoutFn = id => clearTimeout(id),
  maxAgeMs = SPECULATIVE_HINT_MAX_AGE_MS,
  onEvent = () => {},
} = {}) {
  let ticketSeq = 0
  let preparing = null   // { ticket, key } while the request body is being built
  let inflight = null    // { key, bodyJson, controller, response, startedAt, expiry }

  const emit = (outcome, fields = {}) => { try { onEvent({ outcome, ...fields }) } catch {} }

  function drop(reason) {
    const wasPreparing = !!preparing
    preparing = null
    if (!inflight) {
      if (wasPreparing) emit('cancelled', { reason, phase: 'preparing' })
      return wasPreparing
    }
    const entry = inflight
    inflight = null
    clearTimeoutFn(entry.expiry)
    try { entry.controller.abort() } catch {}
    emit('cancelled', { reason, phase: 'started', ageMs: now() - entry.startedAt })
    return true
  }

  /** Start preparing a request for `key`. Supersedes earlier work; returns a ticket for start(). */
  function prepare(key) {
    drop('replaced')
    ticketSeq += 1
    preparing = { ticket: ticketSeq, key }
    return ticketSeq
  }

  /** Send the request prepared under `ticket`, unless it was cancelled or superseded meanwhile. */
  function start(ticket, { key, bodyJson, path = '/api/hint-stream' }) {
    if (!preparing || preparing.ticket !== ticket || preparing.key !== key) return false
    preparing = null
    const controller = new AbortController()
    const response = Promise.resolve().then(() => fetchImpl(path, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: bodyJson, signal: controller.signal,
    }))
    response.catch(() => {})   // an aborted, unclaimed request must not surface as an unhandled rejection
    const entry = { key, bodyJson, controller, response, startedAt: now(), expiry: null }
    entry.expiry = setTimeoutFn(() => { if (inflight === entry) drop('expired') }, maxAgeMs)
    inflight = entry
    emit('started')
    return true
  }

  /** Hand over the in-flight request if it was prepared for exactly this request. */
  function claim({ key, bodyJson }) {
    if (preparing) drop(preparing.key === key ? 'not_ready' : 'question_changed')
    if (!inflight) return null
    if (inflight.key !== key) { drop('question_changed'); return null }
    if (inflight.bodyJson !== bodyJson) { drop('context_changed'); return null }
    const entry = inflight
    inflight = null
    clearTimeoutFn(entry.expiry)
    const leadMs = now() - entry.startedAt
    emit('claimed', { leadMs })
    return { response: entry.response, abort: () => { try { entry.controller.abort() } catch {} }, leadMs }
  }

  /** Give up on one preparation only; a newer preparation or started request is untouched. */
  function abandon(ticket, reason = 'abandoned') {
    if (!preparing || preparing.ticket !== ticket) return false
    preparing = null
    emit('cancelled', { reason, phase: 'preparing' })
    return true
  }

  /** Cancel when captured speech no longer matches the question being prepared. */
  function cancelUnlessKey(key, reason = 'question_changed') {
    const current = inflight?.key ?? preparing?.key
    if (current == null || current === key) return false
    return drop(reason)
  }

  return {
    prepare,
    start,
    claim,
    abandon,
    cancelUnlessKey,
    cancel: (reason = 'cancelled') => drop(reason),
    activeKey: () => inflight?.key ?? preparing?.key ?? null,
  }
}
