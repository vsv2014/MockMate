import { compileAblRuntime } from './abl.js'
import { redactInteractionEvent, summarizeProductIntelligence } from '../../shared/productIntelligence.js'

const LLM_PROVIDERS = [
  ['openai', 'OPENAI_API_KEY'], ['anthropic', 'ANTHROPIC_API_KEY'], ['gemini', 'GEMINI_API_KEY'],
  ['groq', 'GROQ_API_KEY'], ['cerebras', 'CEREBRAS_API_KEY'], ['custom', 'LLM_API_KEY'],
]
const circuits = new Map()
const DEFAULT_COOLDOWN_MS = 30_000
// NOTE (PR #45 review): `perf` and `productEvents` are deliberately process-local today.
// Adaptive lane promotion driven by these maps is therefore process-wide, not per-user;
// acceptable for the current single-digit-user deployment, must be scoped
// (provider+operation+deployment → account/session) before hosted scale-out. See
// docs/ARCHITECTURE.md §2.3 (PI-6).
const perf = new Map()
const productEvents = []
const MAX_PRODUCT_EVENTS = 1000

function runtimePlan() { return compileAblRuntime() }
function configured(name) { return Boolean(String(process.env[name] || '').trim()) }
function configuredProviders(entries = LLM_PROVIDERS) { return entries.filter(([, env]) => configured(env)).map(([provider]) => provider) }
function firstConfigured(entries) { return configuredProviders(entries)[0] || null }
function hostedMode() { return ['1', 'true'].includes(String(process.env.MOCKMATE_HOSTED || '').toLowerCase()) }
function circuitOpen(key, now = Date.now()) { const until = circuits.get(key) || 0; if (until <= now) { circuits.delete(key); return false } return true }
function openCircuit(key, cooldownMs = DEFAULT_COOLDOWN_MS) { circuits.set(key, Date.now() + cooldownMs) }
export function resetArchCircuits() { circuits.clear() }
export function resetArchPerformance() { perf.clear() }
export function resetArchProductIntelligence() { productEvents.length = 0 }

export function recordArchProductEvent(event) {
  const clean = redactInteractionEvent(event)
  if (!clean) return null
  productEvents.push(clean)
  if (productEvents.length > MAX_PRODUCT_EVENTS) {
    productEvents.splice(0, productEvents.length - MAX_PRODUCT_EVENTS)
  }
  return clean
}

export function archProductIntelligenceSnapshot(options = {}) {
  const plan = runtimePlan()
  const piSpec = plan.productIntelligence || {}
  return {
    policy: piSpec,
    ...summarizeProductIntelligence(productEvents, {
      optInReplay: options.optInReplay ?? piSpec.optInReplayDefault ?? false,
      funnels: piSpec.funnels,
      adaptivePolicies: piSpec.adaptivePolicies,
      runtimePerformance: performanceSnapshot(),
    }),
  }
}

export function reasoningLane(operation = 'interview') {
  const plan = runtimePlan()
  return plan.reasoning.routing[operation] || plan.reasoning.routing.default || plan.reasoning.lanes[0]
}

export function recordArchMetric(name, valueMs) {
  const plan = runtimePlan()
  // Support operation-scoped metric names like `turn_latency_ms:interview` —
  // the ABL allowlist applies to the base metric name.
  const base = String(name).split(':')[0]
  if (plan.telemetry.length && !plan.telemetry.includes(base) && !base.endsWith('_provider_ms')) return
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
        tts: {
          available: null, mode: 'client', provider: null,
          declaredModes: plan.speech.tts.streaming?.preferredModes || [],
          required: plan.speech.tts.streaming?.required === true,
        },
        turnDetection: plan.speech.turnDetection,
        hotPath: plan.speech.hotPath,
      },
      knowledge: mongo ? { available: true, mode: 'managed', provider: 'mongo-lexical' } : { available: false, mode: 'client-local', provider: null },
      persistence: mongo ? { available: true, mode: 'managed', provider: 'mongo' } : { available: false, mode: 'client-local', provider: null },
    },
    policy: { reasoningAdapter: plan.reasoning.executionAdapter, noDoubleRetry: plan.reasoning.noDoubleRetry },
  }
}

export async function executeWithFallback({
  capability, providers, execute, fallback, retries = 1, timeoutMs = 15_000, cooldownMs = DEFAULT_COOLDOWN_MS,
  signal: outerSignal,
  shouldRetry = () => true,
  shouldOpenCircuit = () => true,
}) {
  const failures = []
  if (outerSignal?.aborted) return { ok: false, aborted: true, degraded: true, provider: null, failures }

  for (const provider of providers) {
    const circuitKey = `${capability}:${provider}`
    if (circuitOpen(circuitKey)) { failures.push({ provider, reason: 'circuit-open' }); continue }
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      if (outerSignal?.aborted) return { ok: false, aborted: true, degraded: true, provider: null, failures }
      const started = Date.now()
      const controller = new AbortController()
      const relay = () => controller.abort(outerSignal?.reason)
      if (outerSignal) outerSignal.addEventListener('abort', relay, { once: true })
      let timer
      const deadline = new Promise((_, reject) => {
        timer = setTimeout(() => {
          const error = new Error('ARCH_TIMEOUT')
          controller.abort(error)
          reject(error)
        }, timeoutMs)
        timer.unref?.()
      })
      try {
        const result = await Promise.race([Promise.resolve().then(() => execute(provider, attempt, controller.signal)), deadline])
        clearTimeout(timer)
        outerSignal?.removeEventListener('abort', relay)
        circuits.delete(circuitKey)
        recordArchMetric(`${capability}_provider_ms`, Date.now() - started)
        return { ok: true, degraded: provider !== providers[0], provider, result, failures }
      } catch (error) {
        clearTimeout(timer)
        outerSignal?.removeEventListener('abort', relay)
        if (outerSignal?.aborted) return { ok: false, aborted: true, degraded: true, provider: null, failures }
        const timedOut = controller.signal.aborted || error?.message === 'ARCH_TIMEOUT' || error?.name === 'AbortError'
        const reason = timedOut ? 'timeout' : String(error?.message || 'provider-failure').slice(0, 160)
        failures.push({ provider, attempt, reason, status: error?.status || 0 })
        const retryable = timedOut || shouldRetry(error)
        if (!retryable || attempt === retries) {
          if (shouldOpenCircuit(error, { timedOut })) openCircuit(circuitKey, cooldownMs)
          break
        }
      }
    }
  }
  if (outerSignal?.aborted) return { ok: false, aborted: true, degraded: true, provider: null, failures }
  if (fallback) {
    const result = await fallback(failures)
    return { ok: true, degraded: true, provider: null, fallback: true, result, failures }
  }
  return { ok: false, degraded: true, provider: null, failures }
}

export function reasoningPolicy(operation, { adaptive = false } = {}) {
  const plan = runtimePlan()
  const baseLane = reasoningLane(operation)
  if (!adaptive) {
    return { lane: baseLane, executionAdapter: plan.reasoning.executionAdapter, noDoubleRetry: plan.reasoning.noDoubleRetry }
  }
  const snap = performanceSnapshot()
  const policies = plan.productIntelligence?.adaptivePolicies || {}
  const ttftThreshold = Number(policies.ttftFastLaneThresholdMs) || 3200
  const turnThreshold = Number(policies.turnLatencyFastLaneThresholdMs) || 6000
  // Operation-scoped promotion (PR review fix): adaptive routing may only react to
  // latency measured ON THE OPERATION BEING ROUTED. A slow vision/evaluate/career
  // call must not push a healthy interview onto the fast lane. TTFT only feeds the
  // streaming hint domain.
  const turnP95 = Number(snap?.[`turn_latency_ms:${operation}`]?.p95) || 0
  const ttftP95 = operation === 'hint' || operation === 'live_hint'
    ? (Number(snap?.llm_ttft_ms?.p95) || 0)
    : 0
  const shouldPromoteToFast =
    baseLane === 'balanced' &&
    (ttftP95 >= ttftThreshold || turnP95 >= turnThreshold)

  return {
    lane: shouldPromoteToFast ? 'fast' : baseLane,
    baseLane,
    adaptivePromotion: shouldPromoteToFast ? 'high_latency_guardrail' : null,
    executionAdapter: plan.reasoning.executionAdapter,
    noDoubleRetry: plan.reasoning.noDoubleRetry,
  }
}

function sttRetryable(error) {
  const status = Number(error?.status || 0)
  return !status || status === 408 || status === 429 || status >= 500
}
function sttCircuitWorthy(error, { timedOut } = {}) {
  const status = Number(error?.status || 0)
  return timedOut || !status || status === 401 || status === 403 || status === 429 || status >= 500
}

export async function executeTranscription(options) {
  const plan = runtimePlan().runtime.transcription?.batch || {}
  const providers = options.providers || (configured('DEEPGRAM_API_KEY') ? ['deepgram'] : [])
  return executeWithFallback({
    capability: 'transcription', providers,
    retries: Number.isInteger(plan.retries) ? plan.retries : 1,
    timeoutMs: Number(plan.timeoutMs) || 30_000,
    cooldownMs: Number(plan.cooldownMs) || DEFAULT_COOLDOWN_MS,
    shouldRetry: sttRetryable,
    shouldOpenCircuit: sttCircuitWorthy,
    ...options,
  })
}

export function publicCapabilityStatus(options) { return resolveCapabilities(options) }

export function archRuntimeSummary(options = {}) {
  const plan = runtimePlan()
  const hosted = options?.hosted ?? hostedMode()
  const includePerformance = options?.includePerformance ?? !hosted
  const includeProductIntelligence = options?.includeProductIntelligence ?? !hosted
  return {
    ...resolveCapabilities({ ...options, hosted }),
    persona: plan.persona,
    designGoals: plan.designGoals,
    routing: plan.reasoning.routing,
    ...(includePerformance ? { performance: performanceSnapshot() } : {}),
    ...(includeProductIntelligence ? { productIntelligence: archProductIntelligenceSnapshot() } : {}),
  }
}
