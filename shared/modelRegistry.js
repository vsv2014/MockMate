// Provider/model configuration shared by UI and execution. Keys remain server-side.
export const MODEL_CATALOG = {
  openai: { score: 220, label: 'OpenAI · GPT-6.1 Sol (balanced)', envKey: 'OPENAI_API_KEY', baseURL: 'https://api.openai.com/v1', envOverrides: ['OPENAI_MODEL', 'OPENAI_BALANCED_MODEL'], defaultModel: 'gpt-6.1-sol' },
  openai_mini: { score: 210, label: 'OpenAI · GPT-6 Luna (fast)', envKey: 'OPENAI_API_KEY', baseURL: 'https://api.openai.com/v1', envOverrides: ['OPENAI_MINI_MODEL', 'OPENAI_FAST_MODEL'], defaultModel: 'gpt-6-luna' },
  gpt_6_astra: { score: 240, label: 'OpenAI · GPT-6 Astra (maximum quality)', envKey: 'OPENAI_API_KEY', baseURL: 'https://api.openai.com/v1', envOverrides: ['OPENAI_MAX_MODEL'], defaultModel: 'gpt-6-astra' },
  gemini_flash_lite: { score: 190, label: 'Gemini 3.5 Flash-Lite (fast)', envKey: 'GEMINI_API_KEY', baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/', envOverrides: ['GEMINI_FLASH_LITE_MODEL'], defaultModel: 'gemini-3.5-flash-lite' },
  gemini_3_flash: { score: 220, label: 'Gemini 3.8 Flash (quality)', envKey: 'GEMINI_API_KEY', baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/', envOverrides: ['GEMINI_3_MODEL'], defaultModel: 'gemini-3.8-flash' },
  gemini: { score: 200, label: 'Gemini 3.6 Flash (balanced)', envKey: 'GEMINI_API_KEY', baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/', envOverrides: ['GEMINI_MODEL'], defaultModel: 'gemini-3.6-flash' },
  groq: { score: 180, label: 'Groq · GPT-OSS 120B', envKey: 'GROQ_API_KEY', baseURL: 'https://api.groq.com/openai/v1', envOverrides: ['GROQ_MODEL'], defaultModel: 'openai/gpt-oss-120b' },
  cerebras: { score: 170, label: 'Cerebras · GPT-OSS 120B', envKey: 'CEREBRAS_API_KEY', baseURL: 'https://api.cerebras.ai/v1', envOverrides: ['CEREBRAS_MODEL'], defaultModel: 'gpt-oss-120b' },
  claude_fable: { score: 240, label: 'Claude Fable 5 (maximum quality)', envKey: 'ANTHROPIC_API_KEY', baseURL: 'https://api.anthropic.com/v1/', envOverrides: ['ANTHROPIC_FABLE_MODEL'], defaultModel: 'claude-fable-5' },
  claude_opus: { score: 220, label: 'Claude Opus 5', envKey: 'ANTHROPIC_API_KEY', baseURL: 'https://api.anthropic.com/v1/', envOverrides: ['ANTHROPIC_OPUS_MODEL'], defaultModel: 'claude-opus-5' },
  claude_sonnet: { score: 200, label: 'Claude Sonnet 5.5 (balanced)', envKey: 'ANTHROPIC_API_KEY', baseURL: 'https://api.anthropic.com/v1/', envOverrides: ['ANTHROPIC_SONNET_MODEL', 'ANTHROPIC_SONNET5_MODEL'], defaultModel: 'claude-sonnet-5-5' },
  claude_haiku: { score: 130, label: 'Claude Haiku 5.5 (fast)', envKey: 'ANTHROPIC_API_KEY', baseURL: 'https://api.anthropic.com/v1/', envOverrides: ['ANTHROPIC_HAIKU_MODEL'], defaultModel: 'claude-haiku-5-5' },
}

// Previous Claude generation, still active at Anthropic. Kept as discovery-time
// fallbacks for keys/workspaces that cannot reach the 5.5 models yet.
const CLAUDE_PREVIOUS = { sonnet: 'claude-sonnet-5', haiku: 'claude-haiku-4-5-20251001' }

export function configuredModel(alias, env = {}) {
  const record = MODEL_CATALOG[alias]
  return record?.envOverrides.map(name => env[name]).find(Boolean) || record?.defaultModel
}

export const MODEL_PRIORITIES = {
  fast: { gemini: [MODEL_CATALOG.gemini_flash_lite.defaultModel], openai: [MODEL_CATALOG.openai_mini.defaultModel], claude_sonnet: [MODEL_CATALOG.claude_haiku.defaultModel, CLAUDE_PREVIOUS.haiku] },
  strong: { openai: [MODEL_CATALOG.openai.defaultModel, "gpt-6-sol"], claude_sonnet: [MODEL_CATALOG.claude_sonnet.defaultModel, CLAUDE_PREVIOUS.sonnet], gemini: [MODEL_CATALOG.gemini_3_flash.defaultModel, "gemini-3.7-flash", MODEL_CATALOG.gemini.defaultModel] },
  best: { openai: [MODEL_CATALOG.gpt_6_astra.defaultModel, MODEL_CATALOG.openai.defaultModel, "gpt-6-sol"], claude_sonnet: [MODEL_CATALOG.claude_fable.defaultModel, MODEL_CATALOG.claude_opus.defaultModel, MODEL_CATALOG.claude_sonnet.defaultModel], gemini: [MODEL_CATALOG.gemini_3_flash.defaultModel, "gemini-3.7-flash", MODEL_CATALOG.gemini.defaultModel] },
}

// Curated secondary candidates share policy with the preferred defaults above.
const EXTRA_SCORES = {
  openai: { 'gpt-6-sol': 190 },
  gemini: { 'gemini-3.7-flash': 170 },
  groq: { 'qwen/qwen3.8-27b': 160, 'openai/gpt-oss-20b': 125 },
  cerebras: { 'zai-glm-4.7': 190 },
  claude_sonnet: { [CLAUDE_PREVIOUS.sonnet]: 190, [CLAUDE_PREVIOUS.haiku]: 120 },
}
// Anthropic publishes undated aliases and dated snapshots (claude-haiku-4-5-20251001).
const withoutAnthropicDate = id => String(id || '').replace(/-\d{8}$/, '')
export function modelPreferenceScore(model) {
  const id = String(model.model || model.id || '')
  const family = model.provider
  const match = Object.values(MODEL_CATALOG).find(record => {
    const anthropic = record.envKey === 'ANTHROPIC_API_KEY'
    const recordFamily = anthropic ? 'claude_sonnet' : record.envKey.replace('_API_KEY', '').toLowerCase()
    return recordFamily === family && (record.defaultModel === id
      || (anthropic && withoutAnthropicDate(record.defaultModel) === withoutAnthropicDate(id)))
  })
  const extra = EXTRA_SCORES[family]
  return match?.score || extra?.[id]
    || (family === 'claude_sonnet' && Object.entries(extra || {}).find(([known]) => withoutAnthropicDate(known) === withoutAnthropicDate(id))?.[1])
    || 20
}

// Claude 5-generation models think by default. Through the OpenAI-compatible
// endpoint that thinking is never returned, still counts toward max_tokens, is
// billed as output, and reasoning_effort is ignored. Live answers are latency
// bound, so request the lowest thinking mode each model accepts:
//  - "disabled": Sonnet 5, Opus 5 (at effort high or below), Haiku 5.5 (at effort
//    high or below), and the 4.x models where thinking is already off by default.
//  - "between_tools": Sonnet 5.5 rejects "disabled"; this turns off up-front
//    thinking, and without tools the response is text only.
// Fable, Mythos and Opus 5.5 cannot turn thinking off: return null and send nothing.
export function claudeLowLatencyThinking(model) {
  const id = withoutAnthropicDate(String(model || '').toLowerCase())
  if (id === 'claude-sonnet-5-5') return { type: 'between_tools' }
  if (/^claude-(?:sonnet-5|opus-5|haiku-5-5|haiku-4-5|sonnet-4-[56]|opus-4-[5-8])$/.test(id)) return { type: 'disabled' }
  return null
}

// Human-readable model name for settings and diagnostics UI. Catalog defaults reuse
// their curated label without the routing hint; other ids are formatted directly.
export function modelDisplayName(model) {
  const id = String(model || '').trim()
  if (!id) return ''
  const record = Object.values(MODEL_CATALOG).find(r => r.defaultModel === id
    || (r.envKey === 'ANTHROPIC_API_KEY' && withoutAnthropicDate(r.defaultModel) === withoutAnthropicDate(id)))
  if (record) return record.label.replace(/^OpenAI · /, '').replace(/\s*\([^)]*\)\s*$/, '')
  const claude = withoutAnthropicDate(id).match(/^claude-([a-z]+)-(\d+)(?:-(\d+))?$/i)
  if (claude) return `Claude ${claude[1][0].toUpperCase()}${claude[1].slice(1)} ${claude[2]}${claude[3] ? `.${claude[3]}` : ''}`
  const gemini = id.match(/^gemini-([\d.]+)-(flash-lite|flash|pro)$/i)
  if (gemini) return `Gemini ${gemini[1]} ${gemini[2].split('-').map(w => w[0].toUpperCase() + w.slice(1)).join('-')}`
  const gpt = id.match(/^gpt-([\d.]+)-([a-z]+)$/i)
  if (gpt) return `GPT-${gpt[1]} ${gpt[2][0].toUpperCase()}${gpt[2].slice(1)}`
  return id
}


export const CURRENT_MODELS = {
  openai: /^(?:gpt-6(?:\.\d+)?-(?:astra|sol|luna))$/i,
  claude_sonnet: /^claude-(?:(?:fable|opus|sonnet)-5(?:-\d+)?|haiku-[45]-5(?:-\d{8})?)$/i,
  gemini: /^gemini-(?:3\.8-flash|3\.7-flash|3\.6-flash|3\.5-flash-lite)$/i,
  groq: /^(?:openai\/gpt-oss-(?:120b|20b)|qwen\/qwen3\.8-27b)$/i,
  cerebras: /^(?:gpt-oss-120b|zai-glm-4\.7)$/i,
}

export const EMBEDDING_MODELS = { openai: "text-embedding-3-small", gemini: "gemini-embedding-001" }

export function usesCompletionTokenBudget(baseURL, model) {
  return /^https:\/\/api\.openai\.com\/v1\/?$/i.test(String(baseURL || ''))
    && /^gpt-(?:[6-9]|[1-9]\d+)(?:\.\d+)?-/i.test(String(model || ''))
}

// Official key-management destinations. Keys identify provider accounts/projects,
// while the execution registry resolves models separately.
export const PROVIDER_KEY_LINKS = {
  groq: { href: 'https://console.groq.com/keys', label: 'Create Groq API key' },
  gemini: { href: 'https://aistudio.google.com/apikey', label: 'Create Gemini API key' },
  openai: { href: 'https://platform.openai.com/api-keys', label: 'Create OpenAI API key' },
  anthropic: { href: 'https://platform.claude.com/settings/keys', label: 'Create Claude API key' },
  cerebras: { href: 'https://cloud.cerebras.ai', label: 'Cerebras Console → API Keys' },
  deepgram: { href: 'https://console.deepgram.com', label: 'Deepgram Console → Settings → API Keys' },
}
