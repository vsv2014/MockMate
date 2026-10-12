import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  listModels, getModelDiscoveryStatus, availableProviders, getFallbackProviders,
  completeJSON, _resetProviderHealthForTests, _getProviderHealthForTests,
} from './core.js'

const KEYS = ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'GROQ_API_KEY', 'CEREBRAS_API_KEY', 'LLM_API_KEY']
const SAVED = Object.fromEntries(KEYS.map(key => [key, process.env[key]]))
const reply = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json' },
})

describe('automatic model retirement across runtime and picker', () => {
  beforeEach(() => {
    _resetProviderHealthForTests()
    for (const key of KEYS) delete process.env[key]
  })
  afterEach(() => {
    for (const key of KEYS) {
      if (SAVED[key] === undefined) delete process.env[key]
      else process.env[key] = SAVED[key]
    }
    _resetProviderHealthForTests()
    vi.unstubAllGlobals()
  })

  it('filters provider-published deprecated and retired records, preserving only active ids', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-claude-key'
    vi.stubGlobal('fetch', vi.fn(async () => reply({ data: [
      { id: 'claude-sonnet-5', lifecycle: 'active', display_name: 'Sonnet 5' },
      { id: 'claude-fable-5', lifecycle: 'deprecated', display_name: 'Fable 5' },
      { id: 'claude-opus-5', lifecycle: 'retired', display_name: 'Opus 5' },
    ] })))
    const models = await listModels()
    expect(models.map(m => m.model)).toEqual(['claude-sonnet-5'])
    expect(getModelDiscoveryStatus().discoveredProviders).toEqual(['claude_sonnet'])
    expect(getFallbackProviders('claude_sonnet::claude-fable-5')).not.toContain('claude_sonnet::claude-fable-5')
    // A successfully checked family stays usable with its newly confirmed active model.
    expect(availableProviders()).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'claude_sonnet' })]))
  })

  it('keeps last known active models when provider discovery temporarily fails', async () => {
    process.env.OPENAI_API_KEY = 'test-openai-key'
    let fail = false
    vi.stubGlobal('fetch', vi.fn(async () =>
      fail ? reply({ error: { message: 'unavailable' } }, 503) : reply({ data: [
        { id: 'gpt-6.1-sol', status: 'active' },
        { id: 'gpt-6-luna', status: 'deprecated' },
      ] })))
    expect((await listModels()).map(m => m.model)).toEqual(['gpt-6.1-sol'])
    fail = true
    expect(await listModels()).toEqual([])
    expect(getModelDiscoveryStatus().discoveredProviders).toEqual([])
    expect(availableProviders().some(p => p.id === 'openai')).toBe(true)
    expect(availableProviders().some(p => p.id === 'openai_mini')).toBe(true)
  })

  it('quarantines only the rejected model and uses one alternative on the same key immediately', async () => {
    process.env.OPENAI_API_KEY = 'test-openai-key'
    const called = []
    vi.stubGlobal('fetch', vi.fn(async (_url, opts) => {
      const req = JSON.parse(opts.body)
      called.push(req.model)
      if (req.model === 'gpt-6-luna') {
        return reply({ error: { type: 'invalid_request_error', code: 'model_not_found', message: 'The model gpt-6-luna does not exist' } }, 404)
      }
      return reply({ choices: [{ message: { role: 'assistant', content: '{"ok":true}' } }] })
    }))
    const answer = await completeJSON({ provider: 'openai_mini', messages: [{ role: 'user', content: 'JSON please' }] })
    expect(answer).toEqual({ ok: true })
    expect(called).toEqual(['gpt-6-luna', 'gpt-6.1-sol'])
    expect(_getProviderHealthForTests().quarantinedModels['openai::gpt-6-luna']).toBeGreaterThan(Date.now())
    expect(_getProviderHealthForTests().textBannedUntil.openai_mini).toBeUndefined()

    called.length = 0
    await expect(completeJSON({ provider: 'openai_mini', messages: [{ role: 'user', content: 'again' }] })).resolves.toEqual({ ok: true })
    expect(called).toEqual(['gpt-6.1-sol'])
  })
})
