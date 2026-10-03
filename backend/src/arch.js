import { compileAblRuntime } from './abl.js'

const LLM_PROVIDERS = [
  ['openai', 'OPENAI_API_KEY'], ['anthropic', 'ANTHROPIC_API_KEY'], ['gemini', 'GEMINI_API_KEY'],
  ['groq', 'GROQ_API_KEY'], ['cerebras', 'CEREBRAS_API_KEY'], ['custom', 'LLM_API_KEY'],
]
const circuits = new Map()
const DEFAULT_COOLDOWN_MS = 30_000
const perf = new Map()

function runtimePlan() { return compileAblRuntime() }
function configured(name) { return Boolean(String(process.env[name] || '').trim()) }
function configuredProviders(entries = LLM_PROVIDERS) { return entries.filter(([, env]) => configured(env)).map(([provider]) => provider) }
function firstConfigured(entries) { return configuredProviders(entries)[0] || null }
function hostedMode() { return ['1', 'true'].includes(String(process.env.MOCKMATE_HOSTED || '').toLowerCase()) }
function circuitOpen(key, now = Date.now()) { const until = circuits.get(key) || 0; if (until <= now) { circuits.delete(key); return false } return true }
function openCircuit(key, cooldownMs = DEFAULT_COOLDOWN_MS) { circuits.set(key, Date.now() + cooldownMs) }
export function resetArchCircuits() { circuits.clear() }
export function resetArchPerformance() { perf.clear() }

export function reasoningLane(operation = 'interview') {
  const plan = runtimePlan()
  return plan.reasoning.routing[operation] || plan.reasoning.routing.default || plan.reasoning.lanes[0]
}

export function recordArchMetric(name, valueMs) {
  const plan = runtimePlan()
  if (plan.telemetry.length && !plan.telemetry.includes(name) && !name.endsWith('_provider_ms')) return
  const value = Number(valueMs)
  if (!Number.isFinite(value) || value < 0) return
  const values = perf.get(name) || []
  values.push(value)
  if (values.length > 500) values.shift()
  perf.set(name, values)
}

function percentile(values, p) {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  return Math.round(sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)])
}

export function performanceSnapshot() {
  const percentiles = runtimePlan().performance.reportPercentiles || [50, 95]
  return Object.fromEntries([...perf.entries()].map(([name, values]) => {
    const row = { count: values.length }
    for (const p of percentiles) row[`p${p}`] = percentile(values, p)
    return [name, row]
  }))
}

export function resolveCapabilities({ hosted = hostedMode() } = {}) {
  const plan = runtimePlan()
  const providers = configuredProviders()
  const llmProvider = firstConfigured(LLM_PROVIDERS)
  const deepgram = configured('DEEPGRAM_API_KEY')
  const mongo = configured('MONGO_URI')
  const lanes = plan.reasoning.lanes
  const stt = plan.speech.stt

  return {
    ablVersion: plan.ablVersion,
    application: plan.application,
    capabilities: {
      reasoning: llmProvider
        ? { available: true, mode: hosted ? 'managed' : 'byok', provider: llmProvider, providers, lanes }
        : { available: false, mode: 'unavailable', provider: null, providers: [], lanes },
      speech: {
        stt: {
          live: deepgram
            ? { available: true, mode: hosted ? 'managed' : 'byok', provider: 'deepgram', transport: 'stream', fallback: stt.live.fallback }
            : { available: false, mode: 'unavailable', provider: null, fallback: stt.live.fallback },
          batch: deepgram
            ? { available: true, mode: hosted ? 'managed' : 'byok', provider: 'deepgram', transport: 'upload', fallback: stt.batch.fallback }
            : { available: false, mode: 'unavailable', provider: null, fallback: stt.batch.fallback },
        },
        // Browser TTS is a client capability. The backend can declare the ABL policy,
        // but cannot truthfully claim that a particular device/browser supports it.
        tts: {
          available: null,
          mode: 'client',
          provider: null,
          declaredModes: plan.speech.tts.streaming?.preferredModes || [],
          required: plan.speech.tts.streaming?.required === true,
        },
        turnDetection: plan.speech.turnDetection,
        hotPath: plan.speech.hotPath,
      },
      // These hosted HTTP capabilities are only reachable when Mongo-backed routes are mounted.
      // Desktop-local RAG/persistence live in the client and are not claimed by this backend status.
      knowledge: mongo
        ? { available: true, mode: 'managed', provider: 'mongo-lexical' }
        : { available: false, mode: 'client-local', provider: null },
      persistence: mongo
        ? { available: true, mode: 'managed', provider: 'mongo' }
        : { available: false, mode: 'client-local', provider: null },
    },
    policy: {
      reasoningAdapter: plan.reasoning.executionAdapter,
      noDoubleRetry: plan.reasoning.noDoubleRetry,
    },
  }
}

export async function executeWithFallback({
  capability, providers, execute, fallback, retries = 1, timeoutMs = 15_000, cooldownMs = DEFAULT_COOLDOWN_MS,
}) {
  const failures = []
  for (const provider of providers) {
    const circuitKey = `${capability}:${provider}`
    if (circuitOpen(circuitKey)) { failures.push({ provider, reason: 'circuit-open' }); continue }
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      const started = Date.now()
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(new Error('ARCH_TIMEOUT')), timeoutMs)
      timer.unref?.()
      try {
        const result = await execute(provider, attempt, controller.signal)
        clearTimeout(timer)
        circuits.delete(circuitKey)
        recordArchMetric(`${capability}_provider_ms`, Date.now() - started)
        return { ok: true, degraded: provider !== providers[0], provider, result, failures }
      } catch (error) {
        clearTimeout(timer)
        const timedOut = controller.signal.aborted || error?.message === 'ARCH_TIMEOUT' || error?.name === 'AbortError'
        const reason = timedOut ? 'timeout' : String(error?.message || 'provider-failure').slice(0, 160)
        failures.push({ provider, attempt, reason })
        if (attempt === retries) openCircuit(circuitKey, cooldownMs)
      }
    }
  }
  if (fallback) {
    const result = await fallback(failures)
    return { ok: true, degraded: true, provider: null, fallback: true, result, failures }
  }
  return { ok: false, degraded: true, provider: null, failures }
}

export function reasoningPolicy(operation) {
  const plan = runtimePlan()
  return { lane: reasoningLane(operation), executionAdapter: plan.reasoning.executionAdapter, noDoubleRetry: plan.reasoning.noDoubleRetry }
}

export async function executeTranscription(options) {
  const plan = runtimePlan().runtime.transcription?.batch || {}
  const providers = options.providers || (configured('DEEPGRAM_API_KEY') ? ['deepgram'] : [])
  return executeWithFallback({
    capability: 'transcription', providers,
    retries: Number.isInteger(plan.retries) ? plan.retries : 1,
    timeoutMs: Number(plan.timeoutMs) || 30_000,
    cooldownMs: Number(plan.cooldownMs) || DEFAULT_COOLDOWN_MS,
    ...options,
  })
}

// Public status intentionally excludes process-global performance samples: per-process
// telemetry belongs in diagnostics/observability, not in a tenant-facing capability response.
export function publicCapabilityStatus(options) { return resolveCapabilities(options) }
