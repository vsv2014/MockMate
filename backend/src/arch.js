const LLM_PROVIDERS = [
  ['openai', 'OPENAI_API_KEY'],
  ['anthropic', 'ANTHROPIC_API_KEY'],
  ['gemini', 'GEMINI_API_KEY'],
  ['groq', 'GROQ_API_KEY'],
  ['cerebras', 'CEREBRAS_API_KEY'],
  ['custom', 'LLM_API_KEY'],
]

function configured(name) {
  return Boolean(String(process.env[name] || '').trim())
}

function firstConfigured(entries) {
  return entries.find(([, env]) => configured(env))?.[0] || null
}

export function resolveCapabilities({ hosted = process.env.MOCKMATE_HOSTED === '1' } = {}) {
  const llmProvider = firstConfigured(LLM_PROVIDERS)
  const deepgram = configured('DEEPGRAM_API_KEY')
  const mongo = configured('MONGO_URI')

  return {
    ablVersion: '0.1',
    application: 'mockmate',
    capabilities: {
      reasoning: llmProvider
        ? { available: true, mode: hosted ? 'managed' : 'byok', provider: llmProvider }
        : { available: false, mode: 'unavailable', provider: null },
      transcription: deepgram
        ? { available: true, mode: hosted ? 'managed' : 'byok', provider: 'deepgram' }
        : { available: false, mode: 'unavailable', provider: null, fallback: 'typed-input' },
      knowledge: { available: true, mode: mongo ? 'managed' : 'local', provider: mongo ? 'mongo' : 'local' },
      persistence: { available: true, mode: mongo ? 'managed' : 'local', provider: mongo ? 'mongo' : 'file' },
    },
  }
}

export function publicCapabilityStatus(options) {
  // Deliberately returns provider/mode metadata only. Never return env names, keys or secret values.
  return resolveCapabilities(options)
}
