import { describe, expect, it } from 'vitest'
import { curateModelOptions, configuredProviderNames, curateProviderFallbacks, persistModelSelection, loadModelSelection } from './modelPicker.js'

describe('compact model picker', () => {
  it('limits each configured provider without mixing unavailable providers', () => {
    const models = Array.from({ length: 12 }, (_, i) => ({ id: `openai::gpt-${i}`, provider: 'openai', model: `gpt-${i}`, label: `GPT ${i}` }))
    const out = curateModelOptions(models)
    expect(out).toHaveLength(3)
    expect(out.every(m => m.provider === 'openai')).toBe(true)
  })

  it('groups multiple catalog entries backed by one key as one provider', () => {
    expect(configuredProviderNames([], [
      { id: 'gpt_5', label: 'GPT-5' }, { id: 'openai', label: 'GPT-4o' }, { id: 'openai_mini', label: 'Mini' },
    ])).toEqual(['OpenAI'])
  })

  it('shows one fallback choice per provider key family', () => {
    const out = curateProviderFallbacks([
      { id: 'gpt_5' }, { id: 'openai' }, { id: 'openai_mini' },
      { id: 'claude_opus' }, { id: 'claude_haiku' },
    ])
    expect(out.map(x => x.id)).toEqual(['gpt_5', 'claude_opus'])
  })

  it('removes a stale saved model when Automatic is selected', () => {
    const values = new Map()
    globalThis.localStorage = {
      getItem: key => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, String(value)),
      removeItem: key => values.delete(key),
    }
    localStorage.setItem('llmProvider', 'openai::old-model')
    persistModelSelection('')
    expect(loadModelSelection()).toBe('')
  })
})
