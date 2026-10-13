import { describe, expect, it } from 'vitest'
import { claudeLowLatencyThinking, isThinkingModel, modelDisplayName, modelPreferenceScore, MODEL_CATALOG, MODEL_PRIORITIES } from './modelRegistry.js'
import { isCurrentChatModel } from './currentModels.js'

describe('Claude model generation', () => {
  it('defaults to Claude Sonnet 5.5 and Haiku 5.5 with the previous generation as fallback', () => {
    expect(MODEL_CATALOG.claude_sonnet.defaultModel).toBe('claude-sonnet-5-5')
    expect(MODEL_CATALOG.claude_haiku.defaultModel).toBe('claude-haiku-5-5')
    expect(MODEL_PRIORITIES.strong.claude_sonnet).toEqual(['claude-sonnet-5-5', 'claude-sonnet-5'])
    expect(MODEL_PRIORITIES.fast.claude_sonnet).toEqual(['claude-haiku-5-5', 'claude-haiku-4-5-20251001'])
  })

  it('treats both Claude generations as current chat models', () => {
    for (const id of ['claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-sonnet-5', 'claude-haiku-4-5-20251001', 'claude-haiku-4-5']) {
      expect(isCurrentChatModel('claude_sonnet', id)).toBe(true)
    }
  })

  it('ranks the 5.5 defaults above the previous generation', () => {
    const score = id => modelPreferenceScore({ provider: 'claude_sonnet', model: id })
    expect(score('claude-sonnet-5-5')).toBeGreaterThan(score('claude-sonnet-5'))
    expect(score('claude-haiku-5-5')).toBeGreaterThan(score('claude-haiku-4-5-20251001'))
    expect(score('claude-haiku-4-5')).toBe(score('claude-haiku-4-5-20251001'))   // alias == dated snapshot
    expect(score('claude-sonnet-5')).toBeGreaterThan(20)
  })
})

describe('claudeLowLatencyThinking', () => {
  it.each([
    ['claude-sonnet-5-5', { type: 'between_tools' }],
    ['claude-sonnet-5', { type: 'disabled' }],
    ['claude-opus-5', { type: 'disabled' }],
    ['claude-haiku-5-5', { type: 'disabled' }],
    ['claude-haiku-4-5-20251001', { type: 'disabled' }],
    ['claude-sonnet-4-6', { type: 'disabled' }],
  ])('%s → %j', (model, expected) => {
    expect(claudeLowLatencyThinking(model)).toEqual(expected)
  })

  it.each(['claude-fable-5', 'claude-fable-5-1', 'claude-opus-5-5', 'claude-mythos-5', 'gemini-3.8-flash', 'gpt-6.1-sol', ''])(
    'sends nothing for %s (thinking cannot be turned off, or not Claude)', model => {
      expect(claudeLowLatencyThinking(model)).toBeNull()
    })
})

describe('modelDisplayName', () => {
  it.each([
    ['claude-sonnet-5-5', 'Claude Sonnet 5.5'],
    ['claude-haiku-5-5', 'Claude Haiku 5.5'],
    ['claude-sonnet-5', 'Claude Sonnet 5'],
    ['claude-haiku-4-5-20251001', 'Claude Haiku 4.5'],
    ['gemini-3.5-flash-lite', 'Gemini 3.5 Flash-Lite'],
    ['gemini-3.8-flash', 'Gemini 3.8 Flash'],
    ['gemini-3.7-flash', 'Gemini 3.7 Flash'],
    ['gpt-6.1-sol', 'GPT-6.1 Sol'],
    ['openai/gpt-oss-120b', 'Groq · GPT-OSS 120B'],
    ['some-custom-model', 'some-custom-model'],
  ])('%s → %s', (model, expected) => {
    expect(modelDisplayName(model)).toBe(expected)
  })
})

describe('isThinkingModel', () => {
  it('identifies Claude models as thinking models', () => {
    expect(isThinkingModel('claude_sonnet', 'claude-sonnet-5-5')).toBe(true)
    expect(isThinkingModel('claude_sonnet', 'claude-haiku-5-5')).toBe(true)
    expect(isThinkingModel('claude_sonnet', 'claude-fable-5')).toBe(true)
  })
  it('identifies Groq and Cerebras as thinking models', () => {
    expect(isThinkingModel('groq', 'openai/gpt-oss-120b')).toBe(true)
    expect(isThinkingModel('cerebras', 'gpt-oss-120b')).toBe(true)
  })
  it('identifies OpenRouter provider/models as thinking models', () => {
    expect(isThinkingModel('openrouter', 'anthropic/claude-sonnet-5.5')).toBe(true)
    expect(isThinkingModel('openrouter', 'openai/gpt-6.1-sol')).toBe(true)
    expect(isThinkingModel('', 'anthropic/claude-sonnet-5-5')).toBe(true)
    expect(isThinkingModel('', 'openai/gpt-oss-120b')).toBe(true)
  })
  it('identifies OpenAI Astra/Sol as thinking models', () => {
    expect(isThinkingModel('openai', 'gpt-6-astra')).toBe(true)
    expect(isThinkingModel('openai', 'gpt-6.1-sol')).toBe(true)
  })
  it('does not flag fast non-thinking models', () => {
    expect(isThinkingModel('openai', 'gpt-6-luna')).toBe(false)
    expect(isThinkingModel('gemini', 'gemini-3.5-flash-lite')).toBe(false)
    expect(isThinkingModel('gemini', 'gemini-3.8-flash')).toBe(false)
  })
})
