import { describe, it, expect } from 'vitest'
import { preferredEfficientModel, MODEL_LIFECYCLE } from './modelRegistry.js'
import { isCurrentChatModel, isDiscoveredChatModel, isCurrentProviderChoice } from './currentModels.js'
describe('documented provider lifecycle overrides', () => {
  it('rejects deprecated Cerebras GLM in picker, saved selection and id-only discovery', () => {
    const id = 'zai-glm-4.7'
    expect(isCurrentChatModel('cerebras', id)).toBe(false)
    expect(isCurrentProviderChoice(`cerebras::${id}`)).toBe(false)
    expect(isDiscoveredChatModel('cerebras', id, { id })).toBe(false)
    expect(isDiscoveredChatModel('cerebras', id, { status: 'active', capabilities: { chat: true } })).toBe(false)
    expect(preferredEfficientModel('cerebras', [id])).toBeNull()
    expect(preferredEfficientModel('cerebras', [id, 'gpt-oss-120b'])).toBe('gpt-oss-120b')
  })
  it('preserves the supported default and scopes the exclusion to its provider', () => {
    expect(isCurrentChatModel('cerebras', 'gpt-oss-120b')).toBe(true)
    expect(isDiscoveredChatModel('openrouter', 'z-ai/glm-4.7')).toBe(true)
    expect(MODEL_LIFECYCLE.cerebras['zai-glm-4.7'].source).toMatch(/^https:/)
  })
})
