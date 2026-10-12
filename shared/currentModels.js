import { CURRENT_MODELS, MODEL_CATALOG } from './modelRegistry.js'
// Single source of truth for the curated *current* chat-model picker. This is a
// UI/automatic-routing allowlist, not a claim that every other model is retired.
// Older models can be active but are intentionally omitted from the compact picker.
// Actual account access is still determined by each provider's live /models endpoint.
const BASE_ALIASES = new Set([...Object.keys(MODEL_CATALOG), 'custom'])

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


// Treat provider-published lifecycle metadata as authoritative. A deprecated
// model might still answer requests, but we intentionally stop offering it for
// new sessions; retired models must never be routed. Missing metadata does NOT
// imply deprecation (several providers return only { id }).
export function isActiveModelRecord(record) {
  if (!record || typeof record !== 'object') return false
  const lifecycle = String(record.lifecycle || record.status || '').toLowerCase()
  if (['deprecated', 'retired', 'sunset', 'sunsetted', 'disabled', 'inactive'].includes(lifecycle)) return false
  if (record.deprecated === true || record.is_deprecated === true || record.retired === true || record.is_retired === true) return false
  if (record.deprecated_at && lifecycle !== 'active') return false
  return true
}

// Classify model-specific retirement/unavailability without mistaking a generic
// 400, bad key, provider outage or missing *endpoint* for model deprecation.
export function isModelUnavailableError(error) {
  const status = Number(error?.status ?? error?.statusCode)
  if (![400, 404, 410].includes(status)) return false
  const payload = error?.error || {}
  const code = String(error?.code || payload.code || payload.type || '').toLowerCase()
  if (/^(?:model[_-])?(?:model_not_found|model_not_available|model_unavailable|model_deprecated|model_retired|model_disabled|deployment_not_found)$/.test(code)) return true
  const message = String(error?.message || payload.message || '').toLowerCase()
  return /\b(model|deployment)\b/.test(message)
    && /\b(deprecated|retired|not found|not available|unavailable|does not exist|no longer available|sunset)\b/.test(message)
}

// Discovery is distinct from the compact curated picker. Future generations of
// supported chat families can recover a retired default without a new release.
// Reject specialized/preview endpoints even if the provider lists them.
export function isDiscoveredChatModel(provider, model, record = {}) {
  if (!isActiveModelRecord(record) || typeof model !== 'string') return false
  if (/audio|realtime|transcrib|tts|image|embedding|moderation|search|guard|preview|experimental|live|omni|dall|whisper/i.test(model)) return false
  if (isCurrentChatModel(provider, model)) return true
  if (provider === 'openai') return /^gpt-(?:[6-9]|[1-9]\d+)(?:\.\d+)?-(?:astra|sol|luna)(?:-\d{4}-\d{2}-\d{2})?$/i.test(model)
  if (provider === 'gemini') return /^gemini-(?:3\.(?:[5-9]|[1-9]\d+)|[4-9](?:\.\d+)?|[1-9]\d+(?:\.\d+)?)-(?:flash|flash-lite|pro)$/i.test(model)
  if (provider === 'claude_sonnet') return /^claude-(?:fable|opus|sonnet|haiku)-(?:[5-9]|[1-9]\d+)(?:-\d+)*$/i.test(model)
  // Other providers require positive chat-capability metadata for unfamiliar ids.
  const capabilities = record.capabilities || {}
  return ['groq', 'cerebras'].includes(provider) && (capabilities.chat === true || capabilities.chat_completions === true)
}
