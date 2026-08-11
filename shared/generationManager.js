/**
 * Generation lifecycle for Live answers (M1).
 * Only the authoritative current generation may commit UI/state updates.
 */

export const GENERATION_MANAGER_VERSION = 'generation_manager_v1'

/** @typedef {'pending'|'generating'|'completed'|'cancelled'|'failed'|'stale'} GenerationStatus */

function nid() {
  return `g_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

/**
 * @returns {{
 *   start: Function,
 *   cancelCurrent: Function,
 *   getCurrent: Function,
 *   isAuthoritative: Function,
 *   markStaleIfNotCurrent: Function,
 * }}
 */
export function createGenerationManager() {
  /** @type {null | {
   *   generationId: string,
   *   questionId: string|null,
   *   status: GenerationStatus,
   *   createdAt: number,
   *   abort: AbortController,
   *   reason: string|null,
   *   error: string|null,
   * }} */
  let current = null
  const history = [] // bounded completed/cancelled ids for tests/debug

  function snapshot(g = current) {
    if (!g) return null
    return {
      generationId: g.generationId,
      questionId: g.questionId,
      status: g.status,
      createdAt: g.createdAt,
      reason: g.reason,
      error: g.error,
      signal: g.abort.signal,
    }
  }

  function retire(prev, status) {
    if (!prev) return
    if (prev.status === 'pending' || prev.status === 'generating') {
      prev.status = status
      try { prev.abort.abort() } catch { /* */ }
    } else if (status === 'stale' && prev.status === 'completed') {
      // already finished — leave as completed
    }
    history.push({ generationId: prev.generationId, status: prev.status, questionId: prev.questionId })
    if (history.length > 40) history.shift()
  }

  /**
   * Start a new generation. Cancels/supersedes the previous one.
   * @param {{ questionId?: string, reason?: string }} [opts]
   */
  function start(opts = {}) {
    if (current && (current.status === 'pending' || current.status === 'generating')) {
      retire(current, opts.reason === 'topic_switch' ? 'stale' : 'cancelled')
    } else if (current) {
      // Previous finished — keep history only
      history.push({ generationId: current.generationId, status: current.status, questionId: current.questionId })
      if (history.length > 40) history.shift()
    }

    const abort = new AbortController()
    const generationId = nid()
    current = {
      generationId,
      questionId: opts.questionId || null,
      status: 'pending',
      createdAt: Date.now(),
      abort,
      reason: opts.reason || 'new_question',
      error: null,
    }

    const self = current
    return {
      generationId,
      questionId: self.questionId,
      signal: abort.signal,
      createdAt: self.createdAt,
      get status() { return self.status },
      isCurrent: () => current?.generationId === generationId && (self.status === 'pending' || self.status === 'generating'),
      /** True if this gen may still mutate UI (pending/generating only). */
      canCommit: () => current?.generationId === generationId && (self.status === 'pending' || self.status === 'generating'),
      markGenerating() {
        if (current?.generationId !== generationId) return false
        if (self.status !== 'pending' && self.status !== 'generating') return false
        self.status = 'generating'
        return true
      },
      complete() {
        if (self.status === 'failed' || self.status === 'cancelled' || self.status === 'stale') return false
        if (current?.generationId !== generationId) {
          if (self.status === 'pending' || self.status === 'generating') self.status = 'stale'
          return false
        }
        if (self.status !== 'pending' && self.status !== 'generating' && self.status !== 'completed') return false
        self.status = 'completed'
        return true
      },
      fail(error) {
        if (self.status === 'completed' || self.status === 'cancelled' || self.status === 'stale') return false
        if (current?.generationId !== generationId) {
          if (self.status === 'pending' || self.status === 'generating') self.status = 'stale'
          return false
        }
        self.status = 'failed'
        self.error = error ? String(error) : 'failed'
        try { abort.abort() } catch { /* */ }
        return true
      },
      cancel(reason = 'cancelled') {
        if (self.status === 'completed' || self.status === 'failed') return false
        self.status = 'cancelled'
        self.reason = reason
        try { abort.abort() } catch { /* */ }
        return true
      },
    }
  }

  function cancelCurrent(reason = 'cancelled_cancelled') {
    if (!current) return null
    if (current.status === 'pending' || current.status === 'generating') {
      current.status = reason === 'topic_switch' ? 'stale' : 'cancelled'
      current.reason = reason
      try { current.abort.abort() } catch { /* */ }
    }
    return snapshot()
  }

  function getCurrent() {
    return snapshot()
  }

  function isAuthoritative(generationId) {
    return !!(current && current.generationId === generationId
      && (current.status === 'pending' || current.status === 'generating' || current.status === 'completed'))
  }

  /** For late SSE: if this id is not current, mark stale and deny commit. */
  function markStaleIfNotCurrent(generationId) {
    if (current?.generationId === generationId) return false
    return true // caller must treat as stale
  }

  function getHistory() {
    return history.slice()
  }

  return {
    version: GENERATION_MANAGER_VERSION,
    start,
    cancelCurrent,
    getCurrent,
    isAuthoritative,
    markStaleIfNotCurrent,
    getHistory,
  }
}
