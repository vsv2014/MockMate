// Fetch with a hard timeout — a slow/hung upstream must never hang a request.
// Was duplicated as `fetchT` in search.js, jobs.js, and inline in core.js (deepgram).
export async function fetchWithTimeout(url, opts = {}, ms = 10000) {
  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(), ms)
  try { return await fetch(url, { ...opts, signal: ac.signal }) }
  finally { clearTimeout(t) }
}
