const LLM_PROVIDERS = [
  ['openai', 'OPENAI_API_KEY'],
  ['anthropic', 'ANTHROPIC_API_KEY'],
  ['gemini', 'GEMINI_API_KEY'],
  ['groq', 'GROQ_API_KEY'],
  ['cerebras', 'CEREBRAS_API_KEY'],
  ['custom', 'LLM_API_KEY'],
]

const circuits = new Map()
const DEFAULT_COOLDOWN_MS = 30_000

function configured(name) {
  return Boolean(String(process.env[name] || '').trim())
}

function configuredProviders(entries = LLM_PROVIDERS) {
  return entries.filter(([, env]) => configured(env)).map(([provider]) => provider)
}

function firstConfigured(entries) {
  return configuredProviders(entries)[0] || null
}

function circuitOpen(key, now = Date.now()) {
  const until = circuits.get(key) || 0
  if (until <= now) {
    circuits.delete(key)
    return false
  }
  return true
}

function openCircuit(key, cooldownMs = DEFAULT_COOLDOWN_MS) {
  circuits.set(key, Date.now() + cooldownMs)
}

export function resetArchCircuits() {
  circuits.clear()
}

export function resolveCapabilities({ hosted = process.env.MOCKMATE_HOSTED === '1' } = {}) {
  const providers = configuredProviders()
  const llmProvider = firstConfigured(LLM_PROVIDERS)
  const deepgram = configured('DEEPGRAM_API_KEY')
  const mongo = configured('MONGO_URI')

  return {
    ablVersion: '0.1',
    application: 'mockmate',
    capabilities: {
      reasoning: llmProvider
        ? { available: true, mode: hosted ? 'managed' : 'byok', provider: llmProvider, providers }
        : { available: false, mode: 'unavailable', provider: null, providers: [] },
      transcription: deepgram
        ? { available: true, mode: hosted ? 'managed' : 'byok', provider: 'deepgram', fallback: 'typed-input' }
        : { available: false, mode: 'unavailable', provider: null, fallback: 'typed-input' },
      knowledge: { available: true, mode: mongo ? 'managed' : 'local', provider: mongo ? 'mongo' : 'local' },
      persistence: { available: true, mode: mongo ? 'managed' : 'local', provider: mongo ? 'mongo' : 'file' },
    },
  }
}

export async function executeWithFallback({
  capability,
  providers,
  execute,
  fallback,
  retries = 1,
  timeoutMs = 15_000,
  cooldownMs = DEFAULT_COOLDOWN_MS,
}) {
  const failures = []
  for (const provider of providers) {
    const circuitKey = `${capability}:${provider}`
    if (circuitOpen(circuitKey)) {
      failures.push({ provider, reason: 'circuit-open' })
      continue
    }
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        const result = await Promise.race([
          execute(provider, attempt),
          new Promise((_, reject) => setTimeout(() => reject(new Error('ARCH_TIMEOUT')), timeoutMs)),
        ])
        circuits.delete(circuitKey)
        return { ok: true, degraded: provider !== providers[0], provider, result, failures }
      } catch (error) {
        const reason = error?.message === 'ARCH_TIMEOUT' ? 'timeout' : String(error?.message || 'provider-failure').slice(0, 160)
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

export async function executeReasoning(options) {
  const providers = options.providers || configuredProviders()
  return executeWithFallback({ capability: 'reasoning', providers, ...options })
}

export async function executeTranscription(options) {
  const providers = options.providers || (configured('DEEPGRAM_API_KEY') ? ['deepgram'] : [])
  return executeWithFallback({ capability: 'transcription', providers, retries: 1, timeoutMs: 30_000, ...options })
}

export function publicCapabilityStatus(options) {
  return resolveCapabilities(options)
}
