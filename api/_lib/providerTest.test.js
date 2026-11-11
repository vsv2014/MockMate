import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  testProviderConnection, describeAutomaticRouting, streamText, completeJSON, listModels, getFallbackProviders,
  _getProviderHealthForTests, _resetProviderHealthForTests,
} from './core.js'

const keys = ['OPENAI_API_KEY', 'GROQ_API_KEY', 'GEMINI_API_KEY', 'ANTHROPIC_API_KEY', 'CEREBRAS_API_KEY', 'OPENROUTER_API_KEY']
const saved = Object.fromEntries(keys.map(key => [key, process.env[key]]))

const jsonAnswer = () => new Response(JSON.stringify({
  id: 'chatcmpl-test',
  object: 'chat.completion',
  choices: [{ index: 0, message: { role: 'assistant', content: 'OK' }, finish_reason: 'stop' }],
}), { status: 200, headers: { 'Content-Type': 'application/json' } })

function streamingAnswer(model = 'test-model') {
  const event = {
    id: 'chatcmpl-test', object: 'chat.completion.chunk', created: 1, model,
    choices: [{ index: 0, delta: { content: 'OK' }, finish_reason: null }],
  }
  return new Response(`data: ${JSON.stringify(event)}\n\ndata: [DONE]\n\n`, {
    status: 200, headers: { 'Content-Type': 'text/event-stream' },
  })
}

beforeEach(() => {
  for (const key of keys) delete process.env[key]
  _resetProviderHealthForTests()
})
afterEach(() => {
  for (const key of keys) {
    if (saved[key] === undefined) delete process.env[key]
    else process.env[key] = saved[key]
  }
  _resetProviderHealthForTests()
  vi.unstubAllGlobals()
})

describe('provider connection test', () => {
  it('checks blocking and streaming on the SAME configured provider and model', async () => {
    process.env.OPENAI_API_KEY = 'unit-test-key'
    const fetchMock = vi.fn(async (_url, options) => {
      const request = JSON.parse(options.body)
      expect(request.model).toBe('gpt-6-luna')
      expect(request.max_completion_tokens).toBe(160)
      expect(request.max_tokens).toBeUndefined()
      expect(request.messages).toEqual([{ role: 'user', content: 'Reply with exactly: OK' }])
      return request.stream ? streamingAnswer(request.model) : jsonAnswer()
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(testProviderConnection('openai_mini')).resolves.toEqual({
      ok: true, provider: 'openai_mini', model: 'gpt-6-luna',
      checked: ['blocking', 'streaming'],
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('discovers accessible models, verifies both transports, then routes to the efficient verified model', async () => {
    process.env.OPENAI_API_KEY = 'unit-test-openai'
    process.env.GROQ_API_KEY = 'unit-test-groq'
    const requests = []
    vi.stubGlobal('fetch', vi.fn(async (url, options = {}) => {
      if (String(url).endsWith('/models')) {
        if (String(url).includes('api.openai.com')) return new Response(JSON.stringify({
          data: [{ id: 'gpt-6-luna' }, { id: 'gpt-6.1-sol' }, { id: 'gpt-6-astra' }],
        }), { status: 200 })
        return new Response(JSON.stringify({ data: [{ id: 'openai/gpt-oss-120b' }] }), { status: 200 })
      }
      const req = JSON.parse(options.body)
      requests.push(req)
      return req.stream ? streamingAnswer(req.model) : jsonAnswer()
    }))
    await listModels()
    const result = await testProviderConnection('openai_mini', { optimize: true })
    expect(result).toMatchObject({
      ok: true, provider: 'openai_mini', model: 'gpt-6.1-sol',
      checked: ['blocking', 'streaming'], optimized: true,
    })
    expect(requests).toHaveLength(2)
    expect(requests.every(req => req.model === 'gpt-6.1-sol')).toBe(true)
    expect(describeAutomaticRouting().strong).toMatchObject({
      id: 'openai::gpt-6.1-sol', model: 'gpt-6.1-sol', verified: true,
    })
    expect(getFallbackProviders('openai::gpt-6.1-sol')[0]).toBe('openai::gpt-6.1-sol')
    expect(JSON.stringify(describeAutomaticRouting())).not.toContain('unit-test-openai')
  })

  it('tries one other discovered model with the same key when the preferred model has retired', async () => {
    process.env.OPENAI_API_KEY = 'unit-test-key'
    const models = []
    vi.stubGlobal('fetch', vi.fn(async (url, options = {}) => {
      if (String(url).endsWith('/models')) return new Response(JSON.stringify({
        data: [{ id: 'gpt-6-luna' }, { id: 'gpt-6.1-sol' }],
      }), { status: 200 })
      const req = JSON.parse(options.body)
      if (!req.stream) models.push(req.model)
      if (req.model === 'gpt-6.1-sol') return new Response(JSON.stringify({
        error: { code: 'model_not_found', type: 'invalid_request_error', message: 'Model was retired' },
      }), { status: 404, headers: { 'Content-Type': 'application/json' } })
      return req.stream ? streamingAnswer(req.model) : jsonAnswer()
    }))
    await listModels()
    await expect(testProviderConnection('openai_mini', { optimize: true })).resolves.toMatchObject({
      ok: true, model: 'gpt-6-luna', optimized: true,
    })
    expect(models).toEqual(['gpt-6.1-sol', 'gpt-6-luna'])
    expect(describeAutomaticRouting().fast).toMatchObject({
      id: 'openai::gpt-6-luna', verified: true,
    })
  })

  it('rejects a stream that emits text then fails before completion', async () => {
    process.env.GROQ_API_KEY = 'unit-test-groq'
    vi.stubGlobal('fetch', vi.fn(async (_url, options) => {
      const req = JSON.parse(options.body)
      if (!req.stream) return jsonAnswer()
      const encoder = new TextEncoder()
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode('data: ' + JSON.stringify({
            choices: [{ delta: { content: 'partial answer' }, finish_reason: null }],
          }) + '\\n\\n'))
          controller.error(new Error('upstream stream interrupted'))
        },
      })
      return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
    }))
    await expect(testProviderConnection('groq')).rejects.toThrow()
    expect(_getProviderHealthForTests().lastWorkingTextProvider).toBeNull()
    expect(_getProviderHealthForTests().verifiedRoutes).toEqual({})
  })

  it('probes Gemini blocking and streaming without unsupported reasoning_effort', async () => {
    process.env.GEMINI_API_KEY = 'unit-test-gemini'
    const requests = []
    vi.stubGlobal('fetch', vi.fn(async (_url, options) => {
      const request = JSON.parse(options.body)
      requests.push(request)
      if ('reasoning_effort' in request) {
        return new Response(JSON.stringify({ error: { message: 'Unsupported reasoning parameter' } }), {
          status: 400, headers: { 'Content-Type': 'application/json' },
        })
      }
      return request.stream ? streamingAnswer(request.model) : jsonAnswer()
    }))
    await expect(testProviderConnection('gemini')).resolves.toMatchObject({
      ok: true, provider: 'gemini', checked: ['blocking', 'streaming'],
    })
    expect(requests).toHaveLength(2)
    expect(requests.every(req => !('reasoning_effort' in req))).toBe(true)
  })

  it('uses a single compatible Gemini attempt in Live streaming and structured JSON', async () => {
    process.env.GEMINI_API_KEY = 'unit-test-gemini'
    const requests = []
    vi.stubGlobal('fetch', vi.fn(async (_url, options) => {
      const request = JSON.parse(options.body)
      requests.push(request)
      if ('reasoning_effort' in request) return new Response(JSON.stringify({
        error: { message: 'Unsupported reasoning parameter' },
      }), { status: 400, headers: { 'Content-Type': 'application/json' } })
      return request.stream ? streamingAnswer(request.model) : new Response(JSON.stringify({
        choices: [{ index: 0, message: { role: 'assistant', content: '{"ok":true}' }, finish_reason: 'stop' }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }))
    let text = ''
    await streamText({ messages: [{ role: 'user', content: 'Say OK' }], provider: 'gemini',
      onToken: token => { text += token } })
    expect(text).toContain('OK')
    await expect(completeJSON({ messages: [{ role: 'user', content: 'Return JSON' }], provider: 'gemini' }))
      .resolves.toEqual({ ok: true })
    expect(requests).toHaveLength(2)
    expect(requests.every(req => !('reasoning_effort' in req))).toBe(true)
  })

  it('recovers a retired default once, then tests both transports on the replacement', async () => {
    process.env.OPENAI_API_KEY = 'unit-test-key'
    const models = []
    vi.stubGlobal('fetch', vi.fn(async (_url, options) => {
      const req = JSON.parse(options.body)
      if (!req.stream) models.push(req.model)
      if (req.model === 'gpt-6-luna') {
        return new Response(JSON.stringify({
          error: { code: 'model_not_found', type: 'invalid_request_error', message: 'Model gpt-6-luna does not exist' },
        }), { status: 404, headers: { 'Content-Type': 'application/json' } })
      }
      return req.stream ? streamingAnswer(req.model) : jsonAnswer()
    }))
    await expect(testProviderConnection('openai_mini')).resolves.toMatchObject({
      ok: true, provider: 'openai_mini', model: 'gpt-6.1-sol',
    })
    expect(models).toEqual(['gpt-6-luna', 'gpt-6.1-sol'])
  })

  it('does not present a blocking-only key as ready when streaming is rejected', async () => {
    process.env.GEMINI_API_KEY = 'unit-test-key'
    process.env.GROQ_API_KEY = 'unit-test-groq'
    vi.stubGlobal('fetch', vi.fn(async (url, options) => {
      const req = JSON.parse(options.body)
      if (String(url).includes('generativelanguage') && req.stream) {
        return new Response(JSON.stringify({ error: { message: 'Streaming request rejected', type: 'invalid_request_error' } }), {
          status: 400, headers: { 'Content-Type': 'application/json' },
        })
      }
      return req.stream ? streamingAnswer(req.model) : jsonAnswer()
    }))
    await expect(testProviderConnection('gemini')).rejects.toMatchObject({ status: 400 })
    expect(_getProviderHealthForTests().textBannedUntil.gemini).toBeGreaterThan(Date.now())
    expect(describeAutomaticRouting().fast?.id).toBe('groq')
  })

  it('benches an out-of-credit OpenAI key instead of promoting it for coding', async () => {
    process.env.OPENAI_API_KEY = 'unit-test-openai'
    process.env.GROQ_API_KEY = 'unit-test-groq'
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      error: { message: 'You have no credits remaining', code: 'insufficient_quota' },
    }), { status: 429, headers: { 'Content-Type': 'application/json' } })))
    await expect(testProviderConnection('openai_mini')).rejects.toMatchObject({ status: 429 })
    expect(_getProviderHealthForTests().textBannedUntil.openai).toBeGreaterThan(Date.now())
    expect(describeAutomaticRouting().strong?.id).toBe('groq')
  })

  it('refuses unconfigured or unsupported ids without contacting a provider', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(testProviderConnection('openai_mini')).rejects.toMatchObject({ status: 404 })
    await expect(testProviderConnection('custom')).rejects.toMatchObject({ status: 404 })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
