// Local-only, metadata-only execution explorer + provider consumption ledger.
// No raw prompts, answers, credentials, file names, audio, or customer data.
const fs = require('fs')
const path = require('path')

const MAX_LEDGER_BYTES = 8 * 1024 * 1024
const SAFE_ID = /^[a-zA-Z0-9_-]{1,100}$/
const SAFE_NAME = /^[a-zA-Z0-9_./:-]{1,100}$/
const USAGE_EVENTS = new Set(['attempt_started', 'attempt_succeeded', 'attempt_failed',
  'attempt_timed_out', 'attempt_cancelled', 'request_usage'])
const REQUEST_EVENTS = new Set(['request_started', 'request_completed', 'request_failed'])
const numberOrNull = n => Number.isFinite(n) && n >= 0 ? n : null
const textSafe = (v, max = 100) => typeof v === 'string' && SAFE_NAME.test(v)
  ? v.slice(0, max) : null

function ledgerRow(row) {
  if (row?.component !== 'llm' || !USAGE_EVENTS.has(row.event)) return null
  if (!SAFE_ID.test(String(row.attemptId || ''))) return null
  const entry = {
    ts: typeof row.ts === 'string' ? row.ts : new Date().toISOString(),
    event: row.event, attemptId: row.attemptId,
    requestId: SAFE_ID.test(String(row.requestId || '')) ? row.requestId : null,
    accountScope: /^[a-zA-Z0-9._-]{1,160}$/.test(String(row.accountScope || '')) ? row.accountScope : null,
    operation: textSafe(row.operation), provider: textSafe(row.provider), model: textSafe(row.model),
    attemptIndex: numberOrNull(row.attemptIndex), requestIndex: numberOrNull(row.requestIndex),
    durationMs: numberOrNull(row.durationMs), status: numberOrNull(row.status),
    inputTokens: numberOrNull(row.inputTokens), outputTokens: numberOrNull(row.outputTokens),
  }
  return entry
}

function readJsonl(filename, maxLines = 5000) {
  try {
    const content = fs.readFileSync(filename, 'utf8')
    const lines = content.split('\n').filter(Boolean).slice(-maxLines)
    const parsed = []
    for (const line of lines) {
      try { const row = JSON.parse(line); if (row && typeof row === 'object') parsed.push(row) } catch {}
    }
    return parsed
  } catch { return [] }
}

class UsageLedger {
  constructor(directory) {
    this.file = path.join(directory, 'logs', 'usage-ledger.jsonl')
    this.pending = []
    this.flushing = null
    this.writeError = null
    this.timer = setInterval(() => { void this.flush() }, 750)
    this.timer.unref?.()
  }

  record(row) {
    const safe = ledgerRow(row)
    if (!safe) return false
    this.pending.push(JSON.stringify(safe))
    if (this.pending.length >= 50) void this.flush()
    return true
  }

  async flush() {
    if (this.flushing) return this.flushing
    if (!this.pending.length) return
    const batch = this.pending.splice(0, 100)
    this.flushing = (async () => {
      try {
        await fs.promises.mkdir(path.dirname(this.file), { recursive: true })
        const size = (await fs.promises.stat(this.file).catch(() => ({ size: 0 }))).size
        const bytes = Buffer.byteLength(batch.join('\n') + '\n')
        if (size + bytes > MAX_LEDGER_BYTES) {
          await fs.promises.rm(this.file + '.1', { force: true }).catch(() => {})
          await fs.promises.rename(this.file, this.file + '.1').catch(() => {})
        }
        await fs.promises.appendFile(this.file, batch.join('\n') + '\n', { mode: 0o600 })
        this.writeError = null
      } catch {
        this.writeError = 'storage_unavailable'
        this.pending.unshift(...batch)
        this.pending.splice(5000)
      } finally { this.flushing = null }
    })()
    return this.flushing
  }

  async entries() {
    await this.flush()
    if (this.flushing) await this.flushing
    return [...readJsonl(this.file + '.1'), ...readJsonl(this.file)]
  }

  async clear() {
    if (this.flushing) await this.flushing
    this.pending = []
    await fs.promises.rm(this.file, { force: true }).catch(() => {})
    await fs.promises.rm(this.file + '.1', { force: true }).catch(() => {})
  }

  async close() {
    clearInterval(this.timer)
    await this.flush()
    if (this.flushing) await this.flushing
  }
}

function summarizeUsage(entries = []) {
  const unique = new Map()
  for (const item of entries) {
    if (!USAGE_EVENTS.has(item?.event) || !SAFE_ID.test(String(item.attemptId || ''))) continue
    // A provider may re-emit a metadata row after an IPC retry; do not double-bill.
    const key = item.attemptId + ':' + item.event + ':' + (item.requestIndex ?? 'none')
    unique.set(key, item)
  }
  const attempts = new Map()
  for (const item of unique.values()) {
    const key = item.attemptId
    if (!attempts.has(key)) attempts.set(key, { provider: item.provider || 'unknown', operation: item.operation || 'unknown',
      attemptIndex: item.attemptIndex, entries: [] })
    attempts.get(key).entries.push(item)
  }
  const byModule = new Map()
  for (const a of attempts.values()) {
    const key = a.operation + ':' + a.provider
    if (!byModule.has(key)) byModule.set(key, { module: a.operation, provider: a.provider,
      attempts: 0, failed: 0, cancelled: 0, timedOut: 0, fallbacks: 0,
      confirmedInputTokens: 0, confirmedOutputTokens: 0, measuredRequests: 0, unmeasuredAttempts: 0 })
    const bucket = byModule.get(key)
    bucket.attempts += 1
    if (a.attemptIndex > 0) bucket.fallbacks += 1
    const events = new Set(a.entries.map(r => r.event))
    if (events.has('attempt_failed')) bucket.failed += 1
    if (events.has('attempt_timed_out')) bucket.timedOut += 1
    if (events.has('attempt_cancelled')) bucket.cancelled += 1
    const billable = a.entries.filter(e => e.event === 'request_usage' ||
      (e.event === 'attempt_succeeded' && a.operation === 'stream'))
    let known = false
    for (const entry of billable) {
      if (entry.inputTokens == null || entry.outputTokens == null) continue
      bucket.confirmedInputTokens += entry.inputTokens
      bucket.confirmedOutputTokens += entry.outputTokens
      bucket.measuredRequests += 1
      known = true
    }
    if (!known) bucket.unmeasuredAttempts += 1 // Unknown != 0 tokens.
  }
  return [...byModule.values()].sort((a, b) => b.attempts - a.attempts).slice(0, 30)
}

/**
 * Non-LLM resource activity is counted from explicit, metadata-only events.
 * These are not billed units: provider pricing, STT minutes and API usage
 * remain unknown unless the provider explicitly confirms them.
 */
function summarizeModuleActivity(rows = []) {
  const modules = {
    rag: { module: 'rag', unit: 'embedding inputs', completedCalls: 0, failedCalls: 0,
      processedUnits: 0, elapsedMs: 0 },
    stt: { module: 'stt', unit: 'final speech segments', completedCalls: 0, failedCalls: 0,
      processedUnits: 0, elapsedMs: null },
    connectors: { module: 'connectors', unit: 'approved source checks', completedCalls: 0, failedCalls: 0,
      processedUnits: 0, elapsedMs: 0 },
  }
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    if (row.component === 'rag' && ['embedding_completed', 'embedding_failed'].includes(row.event)) {
      const item = modules.rag
      item[row.event === 'embedding_completed' ? 'completedCalls' : 'failedCalls']++
      if (row.event === 'embedding_completed') item.processedUnits += numberOrNull(row.inputCount) || 0
      item.elapsedMs += numberOrNull(row.durationMs) || 0
    } else if (row.component === 'stt') {
      const item = modules.stt
      if (row.event === 'final_received' || row.event === 'candidate_microphone_final') {
        item.completedCalls++
        item.processedUnits++
      } else if (['provider_error','token_failed','audio_frames_stalled'].includes(row.event)) {
        item.failedCalls++
      }
    } else if (row.component === 'connectors' && row.event === 'sync_pass_completed') {
      const item = modules.connectors
      item.completedCalls++
      item.failedCalls += numberOrNull(row.failures) || 0
      item.processedUnits += numberOrNull(row.checked) || 0
      item.elapsedMs += numberOrNull(row.durationMs) || 0
    }
  }
  return Object.values(modules)
}

/**
 * Account-specific read model. Backend provider events have the same opaque
 * request ID as renderer API events, but no access to the renderer's account.
 * Bind them only when a renderer API event in THIS scope proves the link.
 * Never guess the owner for old unscoped telemetry.
 */
function filterAccountOperations(rows = [], ledgerEntries = [], scope = 'guest') {
  if (!/^[a-zA-Z0-9._-]{1,160}$/.test(String(scope)))
    throw new Error('Invalid operational account scope')
  const linked = new Set(rows.filter(row =>
    row?.component === 'api' && row.accountScope === scope &&
    SAFE_ID.test(String(row.requestId || ''))).map(row => row.requestId))
  const own = rows.filter(row => row?.accountScope === scope ||
    (row?.component === 'llm' && linked.has(row.requestId)))
  const usage = ledgerEntries.filter(row => row?.accountScope === scope ||
    (row?.requestId && linked.has(row.requestId)))
  return { rows: own, ledgerEntries: usage }
}

function summarizeOperations(rows = [], ledgerEntries = []) {
  const recent = rows.slice(-5000)
  const requests = new Map()
  const modules = new Map()
  let uncorrelatedProviderEvents = 0
  const acceptedComponents = new Set(['api', 'llm', 'stt', 'rag', 'connectors', 'session', 'screen'])
  for (const row of recent) {
    if (!acceptedComponents.has(row?.component) || !row.event) continue
    const component = row.component
    const stats = modules.get(component) || { component, events: 0, failures: 0, durations: [] }
    stats.events += 1
    if (/failed|error|timed_out|timeout/i.test(row.event) || row.level === 'error') stats.failures += 1
    if (numberOrNull(row.durationMs) != null) stats.durations.push(row.durationMs)
    modules.set(component, stats)
    const requestId = row.requestId
    if (!SAFE_ID.test(String(requestId || ''))) {
      if (component === 'llm') uncorrelatedProviderEvents += 1
      continue
    }
    if (!requests.has(requestId)) requests.set(requestId, {
      requestId, route: null, startedAt: null, completedAt: null,
      status: 'unknown', durationMs: null, stages: [], providerAttempts: 0,
    })
    const group = requests.get(requestId)
    if (component === 'api' && REQUEST_EVENTS.has(row.event)) {
      if (row.event === 'request_started') {
        group.startedAt = row.ts
        group.route = typeof row.path === 'string' && /^\/api\/[a-z0-9/-]+$/i.test(row.path) ? row.path : '/api/other'
        group.status = 'in_progress'
      } else {
        group.completedAt = row.ts
        group.status = row.event === 'request_failed' || row.ok === false ? 'failed' : 'completed'
        group.durationMs = numberOrNull(row.durationMs)
      }
    }
    if (component === 'llm' && row.event === 'attempt_started') group.providerAttempts += 1
    if (group.stages.length < 45) group.stages.push({
      ts: row.ts, component, event: row.event,
      durationMs: numberOrNull(row.durationMs),
      status: numberOrNull(row.status),
      provider: textSafe(row.provider),
      attemptIndex: numberOrNull(row.attemptIndex),
    })
  }
  const moduleSummaries = [...modules.values()].map(item => {
    const durations = item.durations.sort((a,b)=>a-b)
    return { component: item.component, events: item.events, failures: item.failures,
      p50Ms: durations.length ? durations[Math.floor((durations.length - 1) * .50)] : null,
      p95Ms: durations.length ? durations[Math.floor((durations.length - 1) * .95)] : null }
  })
  return {
    scope: 'device_metadata_all_local_profiles',
    requests: [...requests.values()].sort((a,b)=>String(b.startedAt || b.completedAt || '').localeCompare(String(a.startedAt || a.completedAt || ''))).slice(0, 50),
    modules: moduleSummaries,
    usage: summarizeUsage(ledgerEntries),
    moduleActivity: summarizeModuleActivity(recent),
    uncorrelatedProviderEvents,
    caveat: 'Provider-supplied tokens are confirmed when present; missing values are unknown. Cost is not inferred. Rotated local history is bounded.',
  }
}

module.exports = { UsageLedger, ledgerRow, summarizeUsage, summarizeOperations,
  summarizeModuleActivity, filterAccountOperations, readJsonl }
