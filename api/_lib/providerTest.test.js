import { afterEach, describe, expect, it, vi } from 'vitest'
import { testProviderConnection } from './core.js'

describe('provider connection test', () => {
  const originalOpenAIKey = process.env.OPENAI_API_KEY

  afterEach(() => {
    if (originalOpenAIKey === undefined) delete process.env.OPENAI_API_KEY
    else process.env.OPENAI_API_KEY = originalOpenAIKey
    vi.unstubAllGlobals()
  })

  it('sends one small probe to the explicitly selected configured provider', async () => {
    process.env.OPENAI_API_KEY = 'unit-test-key'
    const fetchMock = vi.fn(async (_url, options) => {
      const request = JSON.parse(options.body)
      expect(request.model).toBe('gpt-6-luna')
      expect(request.max_completion_tokens).toBe(64)
      expect(request.max_tokens).toBeUndefined()
      expect(request.messages).toEqual([{ role: 'user', content: 'Reply with exactly: OK' }])
      return new Response(JSON.stringify({
        id: 'chatcmpl-test',
        object: 'chat.completion',
        choices: [{ index: 0, message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(testProviderConnection('openai_mini')).resolves.toEqual({
      ok: true, provider: 'openai_mini', model: 'gpt-6-luna',
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('recovers from a retired default with the same key before reporting a failed connection', async () => {
    process.env.OPENAI_API_KEY = 'unit-test-key'
    const models = []
    const fetchMock = vi.fn(async (_url, options) => {
      const req = JSON.parse(options.body)
      models.push(req.model)
      if (req.model === 'gpt-6-luna') {
        return new Response(JSON.stringify({
          error: { code: 'model_not_found', type: 'invalid_request_error', message: 'Model gpt-6-luna does not exist' },
        }), { status: 404, headers: { 'Content-Type': 'application/json' } })
      }
      return new Response(JSON.stringify({
        choices: [{ message: { role: 'assistant', content: 'OK' } }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    })
    vi.stubGlobal('fetch', fetchMock)
    await expect(testProviderConnection('openai_mini')).resolves.toMatchObject({
      ok: true, provider: 'openai_mini', model: 'gpt-6.1-sol',
    })
    expect(models).toEqual(['gpt-6-luna', 'gpt-6.1-sol'])
  })

  it('refuses unconfigured or unsupported provider ids without contacting an upstream', async () => {
    delete process.env.OPENAI_API_KEY
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(testProviderConnection('openai_mini')).rejects.toMatchObject({ status: 404 })
    await expect(testProviderConnection('custom')).rejects.toMatchObject({ status: 404 })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
