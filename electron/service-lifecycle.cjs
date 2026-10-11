function normalizeError(value, fallback = 'unknown service error') {
  return value instanceof Error ? value : new Error(String(value || fallback))
}

/**
 * Supervise the required local UI/AI service. Readiness is explicit, timeout/failure is fatal,
 * and an unexpected exit after readiness closes the desktop app instead of leaving a dead window
 * behind its single-instance lock.
 */
function attachRequiredServiceLifecycle(child, {
  timeoutMs = 15_000,
  timeoutMessage = 'The required local service did not become ready in time.',
  exitBeforeReadyMessage = code => `Service exited before ready (${code ?? 'unknown'}).`,
  exitAfterReadyMessage = code => `Service exited unexpectedly (${code ?? 'unknown'}).`,
  serverErrorMessage = message => message?.message || message?.code || 'service startup failed',
  onReady = () => {},
  onDiagnostic,
  onFatal = () => {},
} = {}) {
  let ready = false
  let failed = false
  let disposed = false

  const fatal = value => {
    if (failed || disposed) return
    failed = true
    clearTimeout(timer)
    const error = normalizeError(value)
    try { child.kill() } catch {}
    try { onFatal(error) } catch {}
  }

  const onMessage = message => {
    if (failed || disposed) return
    if (message?.type === 'ready') {
      if (ready) return
      ready = true
      clearTimeout(timer)
      try { onReady(message) } catch (error) { fatal(error) }
    } else if (message?.type === 'diagnostic' && message.row) {
      try { onDiagnostic?.(message.row) } catch {}
    } else if (message?.type === 'server-error') {
      let detail
      try { detail = serverErrorMessage(message) } catch { detail = message?.message || message?.code }
      fatal(new Error(String(detail || 'service startup failed')))
    }
  }

  const onError = error => fatal(error)
  const onExit = code => {
    clearTimeout(timer)
    if (child._mockMateIntentionalStop) {
      disposed = true
      return
    }
    let detail
    try { detail = ready ? exitAfterReadyMessage(code) : exitBeforeReadyMessage(code) }
    catch { detail = `Service exited unexpectedly (${code ?? 'unknown'}).` }
    fatal(new Error(String(detail)))
  }

  const timer = setTimeout(() => fatal(new Error(timeoutMessage)), Math.max(1, timeoutMs))
  child.on('message', onMessage)
  child.on('error', onError)
  child.on('exit', onExit)

  return {
    fail: fatal,
    isReady: () => ready,
    hasFailed: () => failed,
    dispose: () => {
      disposed = true
      clearTimeout(timer)
      child.removeListener?.('message', onMessage)
      child.removeListener?.('error', onError)
      child.removeListener?.('exit', onExit)
    },
  }
}

/**
 * Wait for the optional local account service. Every unsuccessful startup path kills the child;
 * intentional shutdown resolves as stopped so a pending startup cannot outlive app shutdown.
 */
function waitForOptionalServiceReady(child, {
  timeoutMs = 10_000,
  timeoutMessage = 'Optional service did not become ready in time.',
  serverErrorMessage = message => message?.message || message?.code || 'service startup failed',
} = {}) {
  return new Promise((resolve, reject) => {
    let settled = false
    let timer

    const cleanup = () => {
      clearTimeout(timer)
      child.removeListener?.('message', onMessage)
      child.removeListener?.('error', onError)
      child.removeListener?.('exit', onExit)
    }
    const finish = (fn, value) => {
      if (settled) return
      settled = true
      cleanup()
      fn(value)
    }
    const fail = value => {
      if (settled) return
      const error = normalizeError(value)
      // Settle before kill: a test double or platform may emit exit synchronously.
      settled = true
      cleanup()
      try { child.kill() } catch {}
      reject(error)
    }
    const onMessage = message => {
      if (message?.type === 'ready') finish(resolve, message)
      else if (message?.type === 'server-error') {
        let detail
        try { detail = serverErrorMessage(message) } catch { detail = message?.message || message?.code }
        fail(new Error(String(detail || 'service startup failed')))
      }
    }
    const onError = error => fail(error)
    const onExit = code => {
      if (settled) return
      if (child._mockMateIntentionalStop) finish(resolve, { type: 'stopped' })
      else fail(new Error(`Service exited before ready (${code ?? 'unknown'}).`))
    }

    timer = setTimeout(() => fail(new Error(timeoutMessage)), Math.max(1, timeoutMs))
    child.on('message', onMessage)
    child.on('error', onError)
    child.on('exit', onExit)
  })
}

/** Pure retry/fatal policy for the main-frame renderer load guard. */
function classifyRendererLoadFailure(previousAttempts, errorCode, isMainFrame = true) {
  const attempts = Math.max(0, Number(previousAttempts) || 0)
  if (errorCode === -3 || isMainFrame === false) return { action: 'ignore', attempts }
  const nextAttempts = attempts + 1
  if (nextAttempts > 5) return { action: 'fatal', attempts: nextAttempts }
  return { action: 'retry', attempts: nextAttempts, delayMs: Math.min(4000, 500 * nextAttempts) }
}

module.exports = {
  attachRequiredServiceLifecycle,
  waitForOptionalServiceReady,
  classifyRendererLoadFailure,
}
