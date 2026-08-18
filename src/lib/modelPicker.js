const PROVIDER_LABELS = {
  openai: 'OpenAI',
  claude_sonnet: 'Anthropic',
  gemini: 'Gemini',
  groq: 'Groq',
  cerebras: 'Cerebras',
  custom: 'Custom',
}

const SCORE_RULES = {
  openai: [
    [/gpt-5(?:\.\d+)?(?:$|-chat|-mini)/i, 100],
    [/gpt-4\.1/i, 80],
    [/gpt-4o-mini/i, 70],
    [/gpt-4o(?:$|-)/i, 60],
  ],
  claude_sonnet: [[/sonnet/i, 100], [/haiku/i, 80], [/opus/i, 70]],
  gemini: [[/flash-lite/i, 100], [/flash/i, 90], [/pro/i, 70]],
  groq: [[/llama.*70b/i, 100], [/llama/i, 80], [/qwen/i, 70], [/mixtral/i, 60]],
}

function score(model) {
  const id = String(model.model || model.id || '')
  const rules = SCORE_RULES[model.provider] || []
  const match = rules.find(([re]) => re.test(id))
  let n = match?.[1] || 20
  if (/latest/i.test(id)) n += 4
  if (/preview|experimental|exp-|deprecated|legacy|vision|image|audio|realtime/i.test(id)) n -= 100
  // Prefer stable aliases over date-stamped snapshots in the compact picker.
  if (/\b20\d{2}[-_]\d{2}[-_]\d{2}\b|[-_]20\d{6}\b/.test(id)) n -= 15
  return n
}

/** Compact list for interview setup. Full provider discovery stays server-side. */
export function curateModelOptions(models = [], { maxPerProvider = 3 } = {}) {
  const groups = new Map()
  for (const model of models) {
    if (!model?.id || !model?.provider) continue
    if (!groups.has(model.provider)) groups.set(model.provider, [])
    groups.get(model.provider).push(model)
  }
  const out = []
  for (const [provider, list] of groups) {
    const chosen = [...list].sort((a, b) => score(b) - score(a) || String(a.model).localeCompare(String(b.model))).slice(0, maxPerProvider)
    for (const model of chosen) {
      out.push({ ...model, providerLabel: PROVIDER_LABELS[provider] || provider })
    }
  }
  return out
}

export function configuredProviderNames(models = [], providers = []) {
  const names = new Set()
  for (const model of models) names.add(PROVIDER_LABELS[model.provider] || model.provider)
  if (!names.size) {
    for (const p of providers) {
      const id = String(p.id || '')
      const family = id.startsWith('openai') || id === 'gpt_5' ? 'OpenAI'
        : id.startsWith('claude') ? 'Anthropic'
          : id.startsWith('gemini') ? 'Gemini'
            : PROVIDER_LABELS[id] || p.label || id
      if (family) names.add(family)
    }
  }
  return [...names]
}

/** One catalog default per actual key family when live model discovery is unavailable. */
export function curateProviderFallbacks(providers = []) {
  const seen = new Set()
  const out = []
  for (const provider of providers) {
    const id = String(provider.id || '')
    const family = id.startsWith('openai') || id === 'gpt_5' ? 'openai'
      : id.startsWith('claude') ? 'anthropic'
        : id.startsWith('gemini') ? 'gemini'
          : id
    if (!family || seen.has(family)) continue
    seen.add(family)
    out.push(provider)
  }
  return out
}

export function loadModelSelection() {
  try { return localStorage.getItem('llmProvider') || '' } catch { return '' }
}

export function persistModelSelection(value) {
  try {
    if (value) localStorage.setItem('llmProvider', value)
    else localStorage.removeItem('llmProvider')
  } catch {}
}
