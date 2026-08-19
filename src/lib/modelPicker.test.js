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
    expect(out.map(x => x.id)).toEqual(['openai_mini', 'claude_haiku'])
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

  it('prefers the newest stable Gemini model returned by live discovery', () => {
    const out = curateModelOptions([
      { id: 'gemini::gemini-3.1-flash-lite', provider: 'gemini', model: 'gemini-3.1-flash-lite' },
      { id: 'gemini::gemini-3.5-flash-lite', provider: 'gemini', model: 'gemini-3.5-flash-lite' },
      { id: 'gemini::gemini-3.6-flash', provider: 'gemini', model: 'gemini-3.6-flash' },
      { id: 'gemini::gemini-3-flash-preview', provider: 'gemini', model: 'gemini-3-flash-preview' },
    ], { maxPerProvider: 3 })
    expect(out[0].model).toBe('gemini-3.5-flash-lite')
    expect(out.some(m => m.model === 'gemini-3-flash-preview')).toBe(false)
  })

  it('surfaces the strongest current OpenAI and Claude models returned by each key', () => {
    const out = curateModelOptions([
      { id: 'openai::gpt-5.6-sol', provider: 'openai', model: 'gpt-5.6-sol' },
      { id: 'openai::gpt-5.6-luna', provider: 'openai', model: 'gpt-5.6-luna' },
      { id: 'claude_sonnet::claude-fable-5', provider: 'claude_sonnet', model: 'claude-fable-5' },
      { id: 'claude_sonnet::claude-sonnet-5', provider: 'claude_sonnet', model: 'claude-sonnet-5' },
    ], { maxPerProvider: 2 })
    expect(out.find(m => m.provider === 'openai').model).toBe('gpt-5.6-sol')
    expect(out.find(m => m.provider === 'claude_sonnet').model).toBe('claude-fable-5')
  })
})
