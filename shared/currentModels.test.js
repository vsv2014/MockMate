import { describe, expect, it } from 'vitest'
import { isCurrentChatModel, isCurrentProviderChoice } from './currentModels.js'

describe('current model policy', () => {
  it.each([
    ['openai', 'gpt-6-sol'],
    ['openai', 'gpt-6-luna'],
    ['openai', 'gpt-6-astra'],
    ['openai', 'gpt-6.1-sol'],
    ['gemini', 'gemini-3.8-flash'],
    ['gemini', 'gemini-3.6-flash'],
    ['gemini', 'gemini-3.5-flash-lite'],
    ['claude_sonnet', 'claude-fable-5'],
    ['claude_sonnet', 'claude-sonnet-5'],
    ['claude_sonnet', 'claude-haiku-4-5-20251001'],
    ['groq', 'openai/gpt-oss-120b'],
    ['cerebras', 'gpt-oss-120b'],
    ['cerebras', 'zai-glm-4.7'],
  ])('accepts %s::%s', (provider, model) => {
    expect(isCurrentChatModel(provider, model)).toBe(true)
    expect(isCurrentProviderChoice(`${provider}::${model}`)).toBe(true)
  })

  it.each([
    ['openai', 'gpt-4o-mini'],
    ['openai', 'gpt-5.6-terra'],
    ['gemini', 'gemini-2.5-flash'],
    ['gemini', 'gemini-3-flash-preview'],
    ['gemini', 'gemini-3.5-flash'],
    ['claude_sonnet', 'claude-3-7-sonnet-20250219'],
    ['groq', 'llama-3.3-70b-versatile'],
    ['groq', 'groq/compound'],
    ['cerebras', 'llama-3.3-70b'],
  ])('excludes old, unavailable or retired %s::%s', (provider, model) => {
    expect(isCurrentChatModel(provider, model)).toBe(false)
    expect(isCurrentProviderChoice(`${provider}::${model}`)).toBe(false)
  })

  it('retains supported stable aliases but resets discontinued ones', () => {
    for (const base of ['openai', 'openai_mini', 'gpt_6_astra', 'gemini_3_flash', 'claude_sonnet', 'groq', 'custom']) {
      expect(isCurrentProviderChoice(base)).toBe(true)
    }
    for (const base of ['gpt_5', 'gpt_56_sol', 'gpt_56_terra', 'claude_sonnet_5']) {
      expect(isCurrentProviderChoice(base)).toBe(false)
    }
    expect(isCurrentProviderChoice('')).toBe(true)
  })
})
