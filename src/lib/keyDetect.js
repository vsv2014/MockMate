// On-device API key format detection for Settings. Nothing here sends a key anywhere.
// A detected provider is a suggestion the user confirms, not proof: formats change and
// some prefixes are shared, so ambiguous shapes are reported with lower confidence.

// Providers a pasted key can be saved for (env names match the local key store).
export const KEY_PROVIDERS = [
  { id: 'gemini', envKey: 'GEMINI_API_KEY', name: 'Google Gemini' },
  { id: 'anthropic', envKey: 'ANTHROPIC_API_KEY', name: 'Anthropic (Claude)' },
  { id: 'openai', envKey: 'OPENAI_API_KEY', name: 'OpenAI' },
  { id: 'groq', envKey: 'GROQ_API_KEY', name: 'Groq' },
  { id: 'cerebras', envKey: 'CEREBRAS_API_KEY', name: 'Cerebras' },
  { id: 'openrouter', envKey: 'OPENROUTER_API_KEY', name: 'OpenRouter (multi-model gateway)' },
  { id: 'deepgram', envKey: 'DEEPGRAM_API_KEY', name: 'Deepgram (voice transcription)' },
]

const byId = Object.fromEntries(KEY_PROVIDERS.map(p => [p.id, p]))

// Ordered: more specific prefixes first (sk-ant- and sk-or- before generic sk-).
const RULES = [
  { id: 'anthropic', re: /^sk-ant-admin\d*-[A-Za-z0-9_-]{20,}$/, confidence: 'high',
    problem: 'This looks like an Anthropic Admin key. Admin keys manage an organization and cannot answer questions — create a regular API key in the Claude Console.' },
  { id: 'anthropic', re: /^sk-ant-(?:api\d+-)?[A-Za-z0-9_-]{20,}$/, confidence: 'high' },
  { id: 'openrouter', re: /^sk-or-(?:v\d+-)?[A-Za-z0-9_-]{20,}$/, confidence: 'high',
    note: 'OpenRouter key — MockMate routes through OpenRouter\'s gateway to any supported model.' },
  { id: 'openai', re: /^sk-(?:proj|svcacct)-[A-Za-z0-9_-]{20,}$/, confidence: 'high' },
  { id: 'openai', re: /^sk-admin-[A-Za-z0-9_-]{20,}$/, confidence: 'high',
    problem: 'This looks like an OpenAI Admin key, which cannot answer questions. Create a project API key instead.' },
  { id: 'groq', re: /^gsk_[A-Za-z0-9]{20,}$/, confidence: 'high' },
  { id: 'cerebras', re: /^csk-[A-Za-z0-9]{20,}$/, confidence: 'high' },
  { id: 'gemini', re: /^AIza[0-9A-Za-z_-]{30,}$/, confidence: 'high', note: 'Google API key — MockMate uses it for Gemini.' },
  // Several services issue plain "sk-" keys, so this is only a likely match.
  { id: 'openai', re: /^sk-[A-Za-z0-9_-]{20,}$/, confidence: 'medium' },
  // Deepgram keys are 40 hex characters with no prefix; other services use that shape too.
  { id: 'deepgram', re: /^[a-f0-9]{40}$/i, confidence: 'medium' },
]

/** Trim whitespace and stray quotes; accept a pasted NAME=value line. */
export function cleanPastedKey(raw) {
  let value = String(raw ?? '').trim()
  const assignment = value.match(/^([A-Z][A-Z0-9_]*)\s*=\s*(.+)$/)
  if (assignment) value = assignment[2].trim()
  value = value.replace(/^['"`]+|['"`]+$/g, '').trim()
  return value
}

/**
 * @returns {{ provider: object|null, providerId: string|null, confidence: 'high'|'medium'|null,
 *   unsupported: boolean, problem: string|null, note: string|null, value: string }}
 */
export function detectKeyProvider(raw) {
  const value = cleanPastedKey(raw)
  const none = { provider: null, providerId: null, confidence: null, unsupported: false, problem: null, note: null, value }
  if (!value) return none
  if (/\s/.test(value)) return { ...none, problem: 'API keys do not contain spaces. Paste only the key.' }
  for (const rule of RULES) {
    if (!rule.re.test(value)) continue
    return {
      provider: rule.unsupported ? null : byId[rule.id] || null,
      providerId: rule.id,
      confidence: rule.confidence,
      unsupported: !!rule.unsupported,
      problem: rule.problem || null,
      note: rule.note || null,
      value,
    }
  }
  return none
}

/** One-line description of the detection result for the Settings screen. */
export function describeDetection(result) {
  if (!result?.value) return ''
  if (result.problem) return result.problem
  if (!result.provider) return 'MockMate could not recognise this key format. Choose the provider it belongs to.'
  const base = result.confidence === 'high'
    ? `Looks like a${/^[AEIOU]/.test(result.provider.name) ? 'n' : ''} ${result.provider.name} key.`
    : `Possibly a${/^[AEIOU]/.test(result.provider.name) ? 'n' : ''} ${result.provider.name} key — other services use the same format, so confirm the provider.`
  return result.note ? `${base} ${result.note}` : base
}
