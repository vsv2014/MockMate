import { describe, expect, it } from 'vitest'
import { curateModelOptions, configuredProviderNames, curateProviderFallbacks, persistModelSelection, loadModelSelection } from './modelPicker.js'

describe('current model picker', () => {
  it('limits each configured provider to three supported choices', () => {
    const ids = ['gpt-6.1-sol', 'gpt-6-astra', 'gpt-6-sol', 'gpt-6-luna']
    const out = curateModelOptions(ids.map(model => ({ id: `openai::${model}`, provider: 'openai', model, label: model })))
    expect(out).toHaveLength(3)
    expect(out.every(m => m.provider === 'openai')).toBe(true)
    expect(out.map(m => m.model)).toContain('gpt-6-astra')
    expect(out.map(m => m.model)).toContain('gpt-6-luna')
    expect(out.map(m => m.model)).not.toContain('gpt-6-sol')
  })

  it('excludes retired, legacy, preview, audio and image models even if API discovery returns them', () => {
    const input = [
      ['groq', 'llama-3.3-70b-versatile'],
      ['groq', 'openai/gpt-oss-120b'],
      ['openai', 'gpt-4o-mini'],
      ['openai', 'gpt-6-luna'],
      ['gemini', 'gemini-2.5-flash'],
      ['gemini', 'gemini-3-flash-preview'],
      ['gemini', 'gemini-3.5-flash'],
      ['gemini', 'gemini-3.8-flash'],
      ['claude_sonnet', 'claude-3-7-sonnet-20250219'],
      ['claude_sonnet', 'claude-fable-5'],
    ].map(([provider, model]) => ({ id: `${provider}::${model}`, provider, model }))
    const out = curateModelOptions(input, { maxPerProvider: 5 })
    expect(out.map(x => x.model)).toEqual(['openai/gpt-oss-120b', 'gpt-6-luna', 'gemini-3.8-flash', 'claude-fable-5'])
  })

  it('groups multiple model aliases backed by one key as one provider', () => {
    expect(configuredProviderNames([], [
      { id: 'gpt_6_astra', label: 'GPT-6 Astra' }, { id: 'openai', label: 'GPT-6 Sol' }, { id: 'openai_mini', label: 'Luna' },
    ])).toEqual(['OpenAI'])
  })

  it('shows only one automatic fallback per provider key family', () => {
    const out = curateProviderFallbacks([
      { id: 'gpt_6_astra' }, { id: 'openai' }, { id: 'openai_mini' }, { id: 'gpt_5' },
      { id: 'claude_opus' }, { id: 'claude_haiku' },
    ])
    expect(out.map(x => x.id)).toEqual(['openai_mini', 'claude_haiku'])
  })

  it('removes a stale saved model on load and when Automatic is selected', () => {
    const values = new Map()
    globalThis.localStorage = {
      getItem: key => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, String(value)),
      removeItem: key => values.delete(key),
    }
    localStorage.setItem('llmProvider', 'openai::gpt-4o-mini')
    expect(loadModelSelection()).toBe('')
    persistModelSelection('openai::gpt-6-luna')
    expect(loadModelSelection()).toBe('openai::gpt-6-luna')
    persistModelSelection('groq::llama-3.3-70b-versatile')
    expect(loadModelSelection()).toBe('')
    persistModelSelection('')
    expect(loadModelSelection()).toBe('')
  })

  it('prefers current Gemini stable models over retired/preview entries', () => {
    const out = curateModelOptions([
      { id: 'gemini::gemini-3.5-flash-lite', provider: 'gemini', model: 'gemini-3.5-flash-lite' },
      { id: 'gemini::gemini-3.6-flash', provider: 'gemini', model: 'gemini-3.6-flash' },
      { id: 'gemini::gemini-3.8-flash', provider: 'gemini', model: 'gemini-3.8-flash' },
      { id: 'gemini::gemini-3-flash-preview', provider: 'gemini', model: 'gemini-3-flash-preview' },
    ], { maxPerProvider: 3 })
    expect(out[0].model).toBe('gemini-3.8-flash')
    expect(out.some(m => m.model === 'gemini-3-flash-preview')).toBe(false)
  })

  it('surfaces current OpenAI and Claude options returned by each configured key', () => {
    const out = curateModelOptions([
      { id: 'openai::gpt-6-astra', provider: 'openai', model: 'gpt-6-astra' },
      { id: 'openai::gpt-6-luna', provider: 'openai', model: 'gpt-6-luna' },
      { id: 'claude_sonnet::claude-fable-5', provider: 'claude_sonnet', model: 'claude-fable-5' },
      { id: 'claude_sonnet::claude-sonnet-5', provider: 'claude_sonnet', model: 'claude-sonnet-5' },
    ], { maxPerProvider: 2 })
    expect(out.find(m => m.provider === 'openai').model).toBe('gpt-6-astra')
    expect(out.find(m => m.provider === 'claude_sonnet').model).toBe('claude-fable-5')
  })
})
