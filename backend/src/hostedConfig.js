const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1'])

export function envFlag(name) {
  return ['1', 'true', 'yes', 'on'].includes(String(process.env[name] || '').trim().toLowerCase())
}

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
function requireIfGroupConfigured(names, errors, label) {
  const configured = names.some(name => String(process.env[name] || '').trim())
  if (!configured) return
  for (const name of names) if (!String(process.env[name] || '').trim()) errors.push(`${name} is required when ${label} is configured.`)
}

export function validateHostedConfig() {
  const hosted = envFlag('MOCKMATE_HOSTED') || isPublicBind()
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
      if (url.protocol !== 'https:' && !LOOPBACK_HOSTS.has(url.hostname)) errors.push(`CORS_ORIGIN must use HTTPS outside loopback: ${origin}`)
      if (url.username || url.password) errors.push(`CORS_ORIGIN must not contain credentials: ${origin}`)
      if (url.pathname !== '/' || url.search || url.hash) errors.push(`CORS_ORIGIN must be an origin only, without path/query/hash: ${origin}`)
    } catch { errors.push(`CORS_ORIGIN contains an invalid URL: ${origin}`) }
  }

  const hasLlmProvider = ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'GROQ_API_KEY', 'CEREBRAS_API_KEY', 'LLM_API_KEY']
    .some(name => String(process.env[name] || '').trim())
  if (!hasLlmProvider) errors.push('At least one server-side LLM provider key is required for hosted Managed AI.')
  if (!String(process.env.DEEPGRAM_API_KEY || '').trim()) errors.push('DEEPGRAM_API_KEY is required for hosted mobile transcription.')

  // Optional integrations may remain fully absent in a free/private beta. Once any
  // member of a group is configured, require a coherent set so readiness never says
  // healthy for a half-wired billing/OAuth flow.
  requireIfGroupConfigured(
    ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'STRIPE_PRICE_ID', 'BILLING_SUCCESS_URL', 'BILLING_CANCEL_URL'],
    errors,
    'Stripe billing',
  )
  requireIfGroupConfigured(
    ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REDIRECT_URI', 'DESKTOP_REDIRECT'],
    errors,
    'Google OAuth',
  )

  const resetEnabled = envFlag('PASSWORD_RESET_ENABLED') || Boolean(String(process.env.RESEND_API_KEY || '').trim())
  if (resetEnabled) {
    if (!String(process.env.RESEND_API_KEY || '').trim()) errors.push('RESEND_API_KEY is required when password reset is enabled in hosted mode.')
    const resetBase = String(process.env.RESET_URL_BASE || '').trim()
    if (!resetBase) errors.push('RESET_URL_BASE is required when password reset is enabled in hosted mode.')
    else {
      try {
        const url = new URL(resetBase)
        if (url.protocol !== 'https:' && !LOOPBACK_HOSTS.has(url.hostname)) errors.push('RESET_URL_BASE must use HTTPS outside loopback.')
      } catch { errors.push('RESET_URL_BASE must be a valid URL.') }
    }
  }

  // Email-verification signup returns NO token until verified; the client shows a
  // "check your email" state. That flow is only launchable when the verification
  // link base AND real email delivery are both configured — otherwise hosted
  // signups would create users nobody can ever sign in as (round-5 review P1).
  if (envFlag('REQUIRE_EMAIL_VERIFICATION')) {
    if (!String(process.env.RESEND_API_KEY || '').trim()) {
      errors.push('RESEND_API_KEY is required when REQUIRE_EMAIL_VERIFICATION is enabled in hosted mode (verification emails must actually be delivered).')
    }
    const verifyBase = String(process.env.VERIFY_URL_BASE || '').trim()
    if (!verifyBase) errors.push('VERIFY_URL_BASE is required when REQUIRE_EMAIL_VERIFICATION is enabled in hosted mode.')
    else {
      try {
        const url = new URL(verifyBase)
        if (url.protocol !== 'https:' && !LOOPBACK_HOSTS.has(url.hostname)) errors.push('VERIFY_URL_BASE must use HTTPS outside loopback.')
      } catch { errors.push('VERIFY_URL_BASE must be a valid URL.') }
    }
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
