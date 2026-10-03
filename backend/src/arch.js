const LLM_PROVIDERS = [
  ['openai', 'OPENAI_API_KEY'], ['anthropic', 'ANTHROPIC_API_KEY'], ['gemini', 'GEMINI_API_KEY'],
  ['groq', 'GROQ_API_KEY'], ['cerebras', 'CEREBRAS_API_KEY'], ['custom', 'LLM_API_KEY'],
]
const circuits = new Map()
const DEFAULT_COOLDOWN_MS = 30_000
const perf = new Map()

function configured(name) { return Boolean(String(process.env[name] || '').trim()) }
function configuredProviders(entries = LLM_PROVIDERS) { return entries.filter(([, env]) => configured(env)).map(([provider]) => provider) }
function firstConfigured(entries) { return configuredProviders(entries)[0] || null }
function circuitOpen(key, now = Date.now()) { const until = circuits.get(key) || 0; if (until <= now) { circuits.delete(key); return false } return true }
function openCircuit(key, cooldownMs = DEFAULT_COOLDOWN_MS) { circuits.set(key, Date.now() + cooldownMs) }
export function resetArchCircuits() { circuits.clear() }
export function resetArchPerformance() { perf.clear() }

export function reasoningLane(operation = 'interview') {
  if (['hint', 'live_hint', 'autocomplete'].includes(operation)) return 'fast'
  if (['evaluate', 'report', 'resume', 'career'].includes(operation)) return 'strong'
  if (['screen', 'vision', 'coding_screen'].includes(operation)) return 'vision'
  return 'balanced'
}

export function recordArchMetric(name, valueMs) {
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
  return Object.fromEntries([...perf.entries()].map(([name, values]) => [name, { count: values.length, p50: percentile(values, 50), p95: percentile(values, 95) }]))
}

export function resolveCapabilities({ hosted = process.env.MOCKMATE_HOSTED === '1' } = {}) {
  const providers = configuredProviders(); const llmProvider = firstConfigured(LLM_PROVIDERS)
  const deepgram = configured('DEEPGRAM_API_KEY'); const mongo = configured('MONGO_URI')
  const browserTts = process.env.MOCKMATE_DISABLE_BROWSER_TTS !== '1'
  return { ablVersion: '0.2', application: 'mockmate', capabilities: {
    reasoning: llmProvider ? { available: true, mode: hosted ? 'managed' : 'byok', provider: llmProvider, providers, lanes: ['fast', 'balanced', 'strong', 'vision'] } : { available: false, mode: 'unavailable', provider: null, providers: [], lanes: [] },
    speech: {
      stt: {
        live: deepgram ? { available: true, mode: hosted ? 'managed' : 'byok', provider: 'deepgram', transport: 'stream', fallback: 'typed-input' } : { available: false, mode: 'unavailable', provider: null, fallback: 'typed-input' },
        batch: deepgram ? { available: true, mode: hosted ? 'managed' : 'byok', provider: 'deepgram', transport: 'upload', fallback: 'typed-input' } : { available: false, mode: 'unavailable', provider: null, fallback: 'typed-input' },
      },
      tts: browserTts ? { available: true, mode: 'browser', provider: 'web-speech', streaming: true } : { available: false, mode: 'unavailable', provider: null },
      turnDetection: { mode: 'vad', bargeIn: true },
    },
    knowledge: { available: true, mode: mongo ? 'managed' : 'local', provider: mongo ? 'mongo' : 'local' },
    persistence: { available: true, mode: mongo ? 'managed' : 'local', provider: mongo ? 'mongo' : 'file' },
  }}
}

export async function executeWithFallback({ capability, providers, execute, fallback, retries = 1, timeoutMs = 15_000, cooldownMs = DEFAULT_COOLDOWN_MS }) {
  const failures = []
  for (const provider of providers) {
    const circuitKey = `${capability}:${provider}`
    if (circuitOpen(circuitKey)) { failures.push({ provider, reason: 'circuit-open' }); continue }
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      const started = Date.now()
      try {
        const result = await Promise.race([execute(provider, attempt), new Promise((_, reject) => setTimeout(() => reject(new Error('ARCH_TIMEOUT')), timeoutMs))])
        circuits.delete(circuitKey); recordArchMetric(`${capability}_provider_ms`, Date.now() - started)
        return { ok: true, degraded: provider !== providers[0], provider, result, failures }
      } catch (error) {
        const reason = error?.message === 'ARCH_TIMEOUT' ? 'timeout' : String(error?.message || 'provider-failure').slice(0, 160)
        failures.push({ provider, attempt, reason }); if (attempt === retries) openCircuit(circuitKey, cooldownMs)
      }
    }
  }
  if (fallback) { const result = await fallback(failures); return { ok: true, degraded: true, provider: null, fallback: true, result, failures } }
  return { ok: false, degraded: true, provider: null, failures }
}

// Reasoning is intentionally executed by api/_lib/core.js, which already has richer provider
// fallback/health/model discovery. ARCH selects the lane/policy and must not double-wrap retries.
export function reasoningPolicy(operation) { return { lane: reasoningLane(operation), executionAdapter: 'core', noDoubleRetry: true } }
export async function executeTranscription(options) { const providers = options.providers || (configured('DEEPGRAM_API_KEY') ? ['deepgram'] : []); return executeWithFallback({ capability: 'transcription', providers, retries: 1, timeoutMs: 30_000, ...options }) }
export function publicCapabilityStatus(options) { return { ...resolveCapabilities(options), performance: performanceSnapshot() } }
