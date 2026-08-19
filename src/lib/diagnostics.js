// Renderer-side non-blocking diagnostics. Payloads contain metadata only; Electron performs a
// second redaction pass before disk. Flushes are best-effort and must never affect product flows.
const queue = []
let timer = null
let common = {}

const BLOCKED = /api.?key|authorization|password|secret|token|cookie|resume|transcript|prompt|full.?answer|screenshot|image.?base64|audio.?data/i

export function setDiagnosticContext(fields = {}) { common = { ...common, ...fields } }

export function diagnostic(component, event, fields = {}, level = 'info') {
  try {
    const safe = {}
    for (const [k, v] of Object.entries(fields || {})) {
      if (/tokens?$/i.test(k) && typeof v === 'number') { safe[k] = v; continue }
      if (BLOCKED.test(k) || v == null) continue
      if (typeof v === 'string') safe[k] = v.slice(0, 500)
      else if (typeof v === 'number' || typeof v === 'boolean') safe[k] = v
      else if (Array.isArray(v)) safe[k] = v.slice(0, 30)
      else if (typeof v === 'object') safe[k] = v
    }
    queue.push({ ts: new Date().toISOString(), level, component, event, ...common, ...safe })
    if (queue.length > 1000) queue.splice(0, queue.length - 1000)
    if (!timer) timer = setTimeout(flushDiagnostics, 250)
  } catch {}
}

export function flushDiagnostics() {
  timer = null
  if (!queue.length) return
  const rows = queue.splice(0, 100)
  try { window.electronAPI?.appendDiagnostics?.(rows)?.catch?.(() => {}) } catch {}
  if (queue.length && !timer) timer = setTimeout(flushDiagnostics, 250)
}

export function createDiagnosticRequestId(prefix = 'req') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}
