import { modelPreferenceScore as score } from '../../shared/modelRegistry.js'
import { getScopedItem, setScopedItem, removeScopedItem } from './accountScope'
import { isCurrentChatModel, isCurrentProviderChoice } from '../../shared/currentModels.js'

const PROVIDER_LABELS = {
  openai: 'OpenAI', claude_sonnet: 'Anthropic', gemini: 'Gemini',
  groq: 'Groq', cerebras: 'Cerebras', custom: 'Custom',
}


// Show only current, key-discovered text models; audio/preview/deprecated
// models never belong in the interview-answer picker.
export function curateModelOptions(models = [], { maxPerProvider = 3 } = {}) {
  const groups = new Map()
  for (const model of models) {
    if (!model?.id || !model?.provider || !isCurrentChatModel(model.provider, model.model)) continue
    if (!groups.has(model.provider)) groups.set(model.provider, [])
    groups.get(model.provider).push(model)
  }
  const out = []
  for (const [provider, list] of groups) {
    const chosen = [...list].sort((a, b) => score(b) - score(a) || String(a.model).localeCompare(String(b.model))).slice(0, maxPerProvider)
    for (const model of chosen) out.push({ ...model, providerLabel: PROVIDER_LABELS[provider] || provider })
  }
  return out
}

export function configuredProviderNames(models = [], providers = []) {
  const names = new Set()
  for (const model of models) {
    if (isCurrentChatModel(model.provider, model.model)) names.add(PROVIDER_LABELS[model.provider] || model.provider)
  }
  if (!names.size) {
    for (const p of providers) {
      const id = String(p.id || '')
      const family = id.startsWith('openai') || id === 'gpt_6_astra' ? 'OpenAI'
        : id.startsWith('claude') ? 'Anthropic'
          : id.startsWith('gemini') ? 'Gemini'
            : PROVIDER_LABELS[id] || p.label || id
      if (family) names.add(family)
    }
  }
  return [...names]
}

export function curateProviderFallbacks(providers = []) {
  const preferred = { openai: 'openai_mini', anthropic: 'claude_haiku', gemini: 'gemini_flash_lite' }
  const family = id => String(id || '').startsWith('openai') || id === 'gpt_6_astra' ? 'openai'
    : String(id || '').startsWith('claude') ? 'anthropic'
      : String(id || '').startsWith('gemini') ? 'gemini' : String(id || '')
  const ordered = [...providers].filter(p => isCurrentProviderChoice(p.id))
    .sort((a, b) => Number(b.id === preferred[family(b.id)]) - Number(a.id === preferred[family(a.id)]))
  const seen = new Set(); const out = []
  for (const provider of ordered) {
    const group = family(provider.id)
    if (!group || seen.has(group)) continue
    seen.add(group); out.push(provider)
  }
  return out
}

export function loadModelSelection() {
  const selected = getScopedItem('llmProvider', '') || ''
  if (isCurrentProviderChoice(selected)) return selected
  removeScopedItem('llmProvider')
  return ''
}

export function persistModelSelection(value) {
  if (value && isCurrentProviderChoice(value)) setScopedItem('llmProvider', value)
  else removeScopedItem('llmProvider')
}
