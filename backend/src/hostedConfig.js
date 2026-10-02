const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1'])

export function isPublicBind(host = process.env.HOST) {
  return Boolean(host && !LOOPBACK_HOSTS.has(host))
}

export function parseCorsOrigins(raw = process.env.CORS_ORIGIN || '') {
  return raw.split(',').map(value => value.trim()).filter(Boolean)
}

function requireSecret(name, errors, minLength = 24) {
  const value = String(process.env[name] || '').trim()
  if (!value) errors.push(`${name} is required for hosted mode.`)
  else if (value.length < minLength) errors.push(`${name} must be at least ${minLength} characters.`)
}

export function validateHostedConfig() {
  const hosted = process.env.MOCKMATE_HOSTED === '1' || isPublicBind()
  if (!hosted) return { hosted: false, corsOrigins: parseCorsOrigins(), errors: [] }

  const errors = []
  requireSecret('JWT_SECRET', errors, 32)

  const mongoUri = String(process.env.MONGO_URI || '').trim()
  if (!/^mongodb(\+srv)?:\/\//i.test(mongoUri)) errors.push('MONGO_URI must be a MongoDB connection URI in hosted mode.')

  const corsOrigins = parseCorsOrigins()
  if (!corsOrigins.length) errors.push('CORS_ORIGIN must contain at least one explicit production/staging origin in hosted mode.')
  for (const origin of corsOrigins) {
    try {
      const url = new URL(origin)
      if (url.protocol !== 'https:' && !LOOPBACK_HOSTS.has(url.hostname)) {
        errors.push(`CORS_ORIGIN must use HTTPS outside loopback: ${origin}`)
      }
      if (url.username || url.password) errors.push(`CORS_ORIGIN must not contain credentials: ${origin}`)
      if (url.pathname !== '/' || url.search || url.hash) errors.push(`CORS_ORIGIN must be an origin only, without path/query/hash: ${origin}`)
    } catch {
      errors.push(`CORS_ORIGIN contains an invalid URL: ${origin}`)
    }
  }

  const hasLlmProvider = [
    'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'GROQ_API_KEY', 'CEREBRAS_API_KEY', 'LLM_API_KEY',
  ].some(name => String(process.env[name] || '').trim())
  if (!hasLlmProvider) errors.push('At least one server-side LLM provider key is required for hosted Managed AI.')

  if (!String(process.env.DEEPGRAM_API_KEY || '').trim()) {
    errors.push('DEEPGRAM_API_KEY is required for hosted mobile transcription.')
  }

  return { hosted: true, corsOrigins, errors }
}

export function assertHostedConfig() {
  const result = validateHostedConfig()
  if (result.errors.length) {
    const error = new Error(`Invalid hosted configuration:\n- ${result.errors.join('\n- ')}`)
    error.code = 'INVALID_HOSTED_CONFIG'
    throw error
  }
  return result
}
