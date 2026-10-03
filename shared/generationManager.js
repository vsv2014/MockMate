/**
 * Generation lifecycle for Live answers.
 * Only the authoritative current pending/generating generation may mutate UI/state.
 */
export const GENERATION_MANAGER_VERSION = 'generation_manager_v2'

function nid() { return `g_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}` }

export function createGenerationManager() {
  let current = null
  const history = []

  function remember(row) {
    const i = history.findIndex(h => h.generationId === row.generationId)
    if (i >= 0) history[i] = { ...history[i], ...row }
    else history.push(row)
    while (history.length > 40) history.shift()
  }
  function snapshot(g = current) {
    if (!g) return null
    return { generationId: g.generationId, questionId: g.questionId, status: g.status, createdAt: g.createdAt, reason: g.reason, error: g.error, signal: g.abort.signal }
  }
  function retire(prev, status) {
    if (!prev) return
    if (prev.status === 'pending' || prev.status === 'generating') {
      prev.status = status
      try { prev.abort.abort() } catch {}
    }
    remember({ generationId: prev.generationId, status: prev.status, questionId: prev.questionId })
  }

  function start(opts = {}) {
    if (current && (current.status === 'pending' || current.status === 'generating')) retire(current, opts.reason === 'topic_switch' ? 'stale' : 'cancelled')
    else if (current) remember({ generationId: current.generationId, status: current.status, questionId: current.questionId })

    const abort = new AbortController(); const generationId = nid()
    current = { generationId, questionId: opts.questionId || null, status: 'pending', createdAt: Date.now(), abort, reason: opts.reason || 'new_question', error: null }
    const self = current
    const canCommit = () => current?.generationId === generationId && (self.status === 'pending' || self.status === 'generating')
    return {
      generationId, questionId: self.questionId, signal: abort.signal, createdAt: self.createdAt,
      get status() { return self.status },
      isCurrent: canCommit,
      canCommit,
      markGenerating() {
        if (!canCommit()) return false
        self.status = 'generating'; return true
      },
      complete() {
        if (!canCommit()) { if (self.status === 'pending' || self.status === 'generating') self.status = 'stale'; remember({ generationId, status: self.status, questionId: self.questionId }); return false }
        self.status = 'completed'; remember({ generationId, status: 'completed', questionId: self.questionId }); return true
      },
      fail(error) {
        if (!canCommit()) { if (self.status === 'pending' || self.status === 'generating') self.status = 'stale'; remember({ generationId, status: self.status, questionId: self.questionId }); return false }
        self.status = 'failed'; self.error = error ? String(error) : 'failed'; try { abort.abort() } catch {}
        remember({ generationId, status: 'failed', questionId: self.questionId }); return true
      },
      cancel(reason = 'cancelled') {
        if (self.status === 'completed' || self.status === 'failed' || self.status === 'cancelled' || self.status === 'stale') return false
        self.status = reason === 'topic_switch' ? 'stale' : 'cancelled'; self.reason = reason; try { abort.abort() } catch {}
        remember({ generationId, status: self.status, questionId: self.questionId }); return true
      },
    }
  }

  function cancelCurrent(reason = 'cancelled') {
    if (!current) return null
    if (current.status === 'pending' || current.status === 'generating') {
      current.status = reason === 'topic_switch' ? 'stale' : 'cancelled'; current.reason = reason
      try { current.abort.abort() } catch {}
      remember({ generationId: current.generationId, status: current.status, questionId: current.questionId })
    }
    return snapshot()
  }
  function getCurrent() { return snapshot() }
  function isAuthoritative(generationId) {
    return !!(current && current.generationId === generationId && (current.status === 'pending' || current.status === 'generating'))
  }
  function markStaleIfNotCurrent(generationId) {
    if (!generationId || current?.generationId === generationId) return false
    remember({ generationId, status: 'stale', questionId: history.find(h => h.generationId === generationId)?.questionId || null })
    return true
  }
  function getHistory() { return history.slice() }

  return { version: GENERATION_MANAGER_VERSION, start, cancelCurrent, getCurrent, isAuthoritative, markStaleIfNotCurrent, getHistory }
}
