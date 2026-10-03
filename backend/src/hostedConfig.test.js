// Round-5 review P1: hosted email-verification signup returns NO token until the
// email is verified. That flow must not be launchable unless the verification link
// base AND real email delivery are configured — validateHostedConfig enforces this.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { validateHostedConfig } from './hostedConfig.js'

const KEYS = [
  'MOCKMATE_HOSTED', 'HOST', 'JWT_SECRET', 'MONGO_URI', 'CORS_ORIGIN',
  'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'GROQ_API_KEY', 'CEREBRAS_API_KEY', 'LLM_API_KEY',
  'DEEPGRAM_API_KEY', 'REQUIRE_EMAIL_VERIFICATION', 'RESEND_API_KEY', 'VERIFY_URL_BASE',
  'PASSWORD_RESET_ENABLED', 'RESET_URL_BASE', 'STRIPE_SECRET_KEY', 'GOOGLE_CLIENT_ID',
]

function setValidHosted() {
  process.env.MOCKMATE_HOSTED = '1'
  process.env.JWT_SECRET = 'x'.repeat(40)
  process.env.MONGO_URI = 'mongodb://localhost/mockmate'
  process.env.CORS_ORIGIN = 'https://app.example.com'
  process.env.OPENAI_API_KEY = 'sk-test'
  process.env.DEEPGRAM_API_KEY = 'dg-test'
}

describe('validateHostedConfig — email verification guard (round-5 P1)', () => {
  const saved = {}
  beforeEach(() => {
    for (const k of KEYS) { saved[k] = process.env[k]; delete process.env[k] }
    setValidHosted()
  })
  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k]
      else process.env[k] = saved[k]
    }
  })

  it('accepts a valid hosted config without email verification', () => {
    expect(validateHostedConfig().errors).toEqual([])
  })

  it('requires RESEND_API_KEY and VERIFY_URL_BASE when REQUIRE_EMAIL_VERIFICATION is enabled', () => {
    process.env.REQUIRE_EMAIL_VERIFICATION = '1'
    const errors = validateHostedConfig().errors
    expect(errors.some(e => e.includes('RESEND_API_KEY'))).toBe(true)
    expect(errors.some(e => e.includes('VERIFY_URL_BASE is required'))).toBe(true)
  })

  it('passes when verification prerequisites are fully configured', () => {
    process.env.REQUIRE_EMAIL_VERIFICATION = '1'
    process.env.RESEND_API_KEY = 're_12345'
    process.env.VERIFY_URL_BASE = 'https://app.example.com/verify.html'
    // RESEND_API_KEY also enables the password-reset group, which requires its base.
    process.env.RESET_URL_BASE = 'https://app.example.com/reset.html'
    expect(validateHostedConfig().errors).toEqual([])
  })

  it('rejects a non-HTTPS VERIFY_URL_BASE outside loopback', () => {
    process.env.REQUIRE_EMAIL_VERIFICATION = '1'
    process.env.RESEND_API_KEY = 're_12345'
    process.env.VERIFY_URL_BASE = 'http://example.com/verify.html'
    expect(validateHostedConfig().errors.some(e => e.includes('VERIFY_URL_BASE must use HTTPS'))).toBe(true)
  })
})
