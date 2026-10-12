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
      expect(request.max_tokens).toBe(8)
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

  it('refuses unconfigured or unsupported provider ids without contacting an upstream', async () => {
    delete process.env.OPENAI_API_KEY
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(testProviderConnection('openai_mini')).rejects.toMatchObject({ status: 404 })
    await expect(testProviderConnection('custom')).rejects.toMatchObject({ status: 404 })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
