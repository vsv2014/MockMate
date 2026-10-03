// Fetch with a hard timeout while preserving caller cancellation.
export async function fetchWithTimeout(url, opts = {}, ms = 10000) {
  const { signal: outerSignal, ...rest } = opts
  const ac = new AbortController()
  const relay = () => ac.abort(outerSignal?.reason)
  if (outerSignal?.aborted) relay()
  else outerSignal?.addEventListener?.('abort', relay, { once: true })
  const t = setTimeout(() => ac.abort(new Error('Request timed out')), ms)
  t.unref?.()
  try {
    return await fetch(url, { ...rest, signal: ac.signal })
  } finally {
    clearTimeout(t)
    outerSignal?.removeEventListener?.('abort', relay)
  }
}
