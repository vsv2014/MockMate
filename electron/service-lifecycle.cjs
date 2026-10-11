function attachRequiredServiceLifecycle(child, options) {
  const {
    timeoutMs,
    timeoutMessage,
    exitBeforeReadyMessage,
    exitAfterReadyMessage,
    serverErrorMessage,
    onReady,
    onFatal,
    onDiagnostic,
  } = options

  let ready = false
  let failed = false

  const fail = error => {
    if (failed || child._mockMateIntentionalStop) return
    failed = true
    clearTimeout(timer)
    try { child.kill() } catch {}
    onFatal(error instanceof Error ? error : new Error(String(error || 'unknown service error')), { ready })
  }

  const timer = setTimeout(() => fail(new Error(timeoutMessage)), timeoutMs)

  child.on('error', fail)
  child.on('message', message => {
    if (message?.type === 'ready') {
      if (ready || failed) return
      ready = true
      clearTimeout(timer)
      onReady()
    } else if (message?.type === 'diagnostic' && message.row) {
      onDiagnostic?.(message.row)
    } else if (message?.type === 'server-error') {
      fail(new Error(serverErrorMessage(message)))
    }
  })
  child.on('exit', code => {
    if (child._mockMateIntentionalStop) return
    const describe = ready ? exitAfterReadyMessage : exitBeforeReadyMessage
    fail(new Error(describe(code)))
  })

  return { fail, isReady: () => ready, hasFailed: () => failed }
}

function waitForOptionalServiceReady(child, options) {
  const { timeoutMs, timeoutMessage, serverErrorMessage } = options

  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (fn, value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      fn(value)
    }
    const fail = error => {
      if (settled) return
      try { child.kill() } catch {}
      finish(reject, error instanceof Error ? error : new Error(String(error || 'unknown service error')))
    }
    const timer = setTimeout(() => fail(new Error(timeoutMessage)), timeoutMs)

    child.on('message', message => {
      if (message?.type === 'ready') finish(resolve, message)
      else if (message?.type === 'server-error') fail(new Error(serverErrorMessage(message)))
    })
    child.on('error', fail)
    child.on('exit', code => {
      if (!settled) fail(new Error(`Service exited before ready (${code ?? 'unknown'}).`))
    })
  })
}

module.exports = { attachRequiredServiceLifecycle, waitForOptionalServiceReady }
