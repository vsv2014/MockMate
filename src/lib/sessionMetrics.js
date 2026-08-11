// Local Live-session metrics (Phase 6). No transcript / resume / answer text — timings,
// counters, and opaque error codes only. Persisted via Electron IPC → userData JSONL.
const SENSITIVE = /resume|transcript|answer|question|prompt|sample|fullAnswer|text|content|say/i

export function sanitizeMetric(obj = {}) {
  const out = {}
  for (const [k, v] of Object.entries(obj)) {
    if (SENSITIVE.test(k)) continue
    if (v == null) continue
    if (typeof v === 'string') out[k] = v.slice(0, 120)
    else if (typeof v === 'number' || typeof v === 'boolean') out[k] = v
    else if (Array.isArray(v)) out[k] = v.slice(0, 20).map(x => (typeof x === 'string' ? x.slice(0, 40) : x))
    else if (typeof v === 'object') out[k] = sanitizeMetric(v)
  }
  return out
}

export function createSessionMetrics(kind = 'live') {
  const sessionId = `${kind}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
  const startedAt = Date.now()
  const counters = {
    hints: 0,
    ttftMs: [],
    sttReconnects: 0,
    streamFallbacks: 0,
    incompleteStreams: 0,
    skips: 0,
    errors: 0,
  }
  let flushed = false

  function event(type, payload = {}) {
    const row = sanitizeMetric({
      ts: new Date().toISOString(),
      sessionId,
      kind,
      type,
      ...payload,
    })
    try { window.electronAPI?.appendSessionMetrics?.(row) } catch {}
    return row
  }

  function startHint() {
    return { t0: performance.now(), firstTokenAt: null }
  }

  function markFirstToken(hintState) {
    if (!hintState || hintState.firstTokenAt != null) return
    hintState.firstTokenAt = performance.now()
    const ms = Math.round(hintState.firstTokenAt - hintState.t0)
    counters.ttftMs.push(ms)
    counters.hints += 1
    event('ttft', { ms })
  }

  function markFallback() { counters.streamFallbacks += 1; event('stream_fallback') }
  function markIncomplete() { counters.incompleteStreams += 1; event('incomplete_stream') }
  function markSkip() { counters.skips += 1; event('skip') }
  function markError(code) { counters.errors += 1; event('error', { code: String(code || 'unknown').slice(0, 80) }) }
  function markSttReconnect() { counters.sttReconnects += 1; event('stt_reconnect') }

  function markQuestionCapture(payload = {}) {
    counters.questionCommits = (counters.questionCommits || 0) + 1
    if (payload.captureLatencyMs != null) {
      counters.timeToCommitMs = counters.timeToCommitMs || []
      counters.timeToCommitMs.push(Number(payload.captureLatencyMs))
    }
    event('question_committed', {
      captureLatencyMs: payload.captureLatencyMs,
      revisions: payload.revisions,
      reason: payload.reason,
    })
  }
  function markQuestionReject(reason) {
    counters.questionRejects = (counters.questionRejects || 0) + 1
    event('question_reject', { reason: String(reason || 'unknown').slice(0, 80) })
  }
  function markGenerationCancelled() {
    counters.cancelledGenerations = (counters.cancelledGenerations || 0) + 1
    event('generation_cancelled')
  }

  function summary() {
    const ttft = counters.ttftMs
    const sorted = [...ttft].sort((a, b) => a - b)
    const p95 = sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] : null
    const ttc = counters.timeToCommitMs || []
    return sanitizeMetric({
      sessionId,
      kind,
      durationMs: Date.now() - startedAt,
      hints: counters.hints,
      ttftCount: ttft.length,
      ttftAvgMs: ttft.length ? Math.round(ttft.reduce((a, b) => a + b, 0) / ttft.length) : null,
      ttftP95Ms: p95,
      sttReconnects: counters.sttReconnects,
      streamFallbacks: counters.streamFallbacks,
      incompleteStreams: counters.incompleteStreams,
      skips: counters.skips,
      errors: counters.errors,
      questionCommits: counters.questionCommits || 0,
      questionRejects: counters.questionRejects || 0,
      cancelledGenerations: counters.cancelledGenerations || 0,
      avgTimeToCommitMs: ttc.length ? Math.round(ttc.reduce((a, b) => a + b, 0) / ttc.length) : null,
    })
  }

  function end(extra = {}) {
    if (flushed) return summary()
    flushed = true
    const row = { ...summary(), ...sanitizeMetric(extra), type: 'session_end' }
    try { window.electronAPI?.appendSessionMetrics?.(row) } catch {}
    return row
  }

  event('session_start')
  return {
    sessionId, startHint, markFirstToken, markFallback, markIncomplete, markSkip, markError,
    markSttReconnect, markQuestionCapture, markQuestionReject, markGenerationCancelled,
    summary, end, event,
  }
}
