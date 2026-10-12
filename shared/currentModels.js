// Single source of truth for the curated *current* chat-model picker. This is a
// UI/automatic-routing allowlist, not a claim that every other model is retired.
// Older models can be active but are intentionally omitted from the compact picker.
// Actual account access is still determined by each provider's live /models endpoint.
const CURRENT_MODELS = {
  openai: /^(?:gpt-6(?:\.\d+)?-(?:astra|sol|luna))$/i,
  claude_sonnet: /^claude-(?:(?:fable|opus|sonnet)-5(?:-\d+)?|haiku-4-5(?:-\d{8})?)$/i,
  gemini: /^gemini-(?:3\.8-flash|3\.7-flash|3\.6-flash|3\.5-flash-lite)$/i,
  groq: /^(?:openai\/gpt-oss-(?:120b|20b)|qwen\/qwen3\.8-27b)$/i,
  cerebras: /^(?:gpt-oss-120b|zai-glm-4\.7)$/i,
}
const BASE_ALIASES = new Set([
  'openai', 'openai_mini', 'gpt_6_astra',
  'gemini', 'gemini_3_flash', 'gemini_flash_lite',
  'groq', 'cerebras',
  'claude_fable', 'claude_opus', 'claude_sonnet', 'claude_haiku',
  'custom',
])

export function isCurrentChatModel(provider, model) {
  const test = CURRENT_MODELS[provider]
  return Boolean(test && typeof model === 'string' && test.test(model))
}

// Old saved choices should reset to Automatic instead of sending a retired model
// or leaving a select with a value that no longer appears in its options.
export function isCurrentProviderChoice(value) {
  if (!value) return true
  if (typeof value !== 'string') return false
  if (!value.includes('::')) return BASE_ALIASES.has(value)
  const separator = value.indexOf('::')
  const provider = value.slice(0, separator)
  const model = value.slice(separator + 2)
  return isCurrentChatModel(provider, model)
}
