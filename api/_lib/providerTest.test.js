import { OPENROUTER_FREE_ROUTE } from '../../shared/modelRegistry.js'
import { withManagedTextRouting } from './traceContext.js'
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
    const [blocking, streaming] = fetchMock.mock.calls.map(([, options]) => JSON.parse(options.body))
    expect(blocking).not.toHaveProperty('stream_options')
    expect(streaming).toMatchObject({ stream: true, stream_options: { include_usage: true } })
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
    const requests = []
    vi.stubGlobal('fetch', vi.fn(async (_url, options) => {
      const req = JSON.parse(options.body)
      requests.push(req)
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
    expect(requests).toHaveLength(2)
    expect(requests[0]).not.toHaveProperty('stream_options')
    expect(requests[1]).toMatchObject({ stream: true, stream_options: { include_usage: true } })
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
    expect(requests.every(req => !('stream_options' in req))).toBe(true)
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


describe('OpenRouter free text routing', () => {
  it('uses the free router even when discovery lists only paid models', async () => {
    process.env.OPENROUTER_API_KEY = 'unit-test-openrouter'
    vi.stubGlobal('fetch', vi.fn(async (url, options) => {
      expect(String(url)).toMatch(/^https:\/\/openrouter\.ai\/api\/v1\//)
      if (String(url).endsWith('/models')) {
        return Response.json({ data: [{ id: 'anthropic/claude-sonnet-5.5' }] })
      }
      expect(JSON.parse(options.body).model).toBe('openrouter/free')
      return Response.json({ choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'stop' }] })
    }))
    await listModels()
    await expect(completeJSON({ messages: [{ role: 'user', content: 'Q' }], provider: OPENROUTER_FREE_ROUTE }))
      .resolves.toEqual({ ok: true })
  })

  it('never fails over to paid routes on model unavailability or a missing OpenRouter key', async () => {
    process.env.OPENROUTER_API_KEY = 'unit-test-openrouter'
    process.env.OPENAI_API_KEY = 'unit-test-openai'
    const fetchMock = vi.fn(async (_url, options) => {
      expect(JSON.parse(options.body).model).toBe('openrouter/free')
      return Response.json({ error: { code: 'model_not_found', message: 'Model not found' } }, { status: 404 })
    })
    vi.stubGlobal('fetch', fetchMock)
    const args = { messages: [{ role: 'user', content: 'Q' }], provider: OPENROUTER_FREE_ROUTE }
    await expect(completeJSON(args)).rejects.toBeTruthy()
    expect(fetchMock).toHaveBeenCalledOnce()
    delete process.env.OPENROUTER_API_KEY
    await expect(completeJSON(args)).rejects.toMatchObject({ code: 'no_provider' })
    expect(fetchMock).toHaveBeenCalledOnce()
  })
})

describe('managed text routing', () => {
  it.each([429, 503])('switches from a managed primary after HTTP %i without SDK retries', async status => {
    process.env.GROQ_API_KEY = 'unit-test-groq'
    process.env.GEMINI_API_KEY = 'unit-test-gemini'
    process.env.OPENAI_API_KEY = 'unit-test-openai'
    const hosts = []
    vi.stubGlobal('fetch', vi.fn(async (url, options) => {
      const host = new URL(url).hostname
      hosts.push(host)
      if (host === 'api.groq.com') return Response.json({ error: { message: 'Try later' } }, { status })
      return streamingAnswer(JSON.parse(options.body).model)
    }))
    const tokens = []
    await withManagedTextRouting(['groq', 'gemini_flash_lite'], () => streamText({
      messages: [{ role: 'user', content: 'Q' }], provider: 'openai_mini', onToken: token => tokens.push(token),
    }))
    expect(tokens).toEqual(['OK'])
    expect(hosts).toEqual(['api.groq.com', 'generativelanguage.googleapis.com'])
  })

  it('counts JSON repair calls against the actual request-wide budget', async () => {
    process.env.GROQ_API_KEY = 'unit-test-groq'
    process.env.GEMINI_API_KEY = 'unit-test-gemini'
    const fetchMock = vi.fn(async () => Response.json({
      choices: [{ message: { content: 'invalid JSON' }, finish_reason: 'stop' }],
    }))
    vi.stubGlobal('fetch', fetchMock)
    const args = { messages: [{ role: 'user', content: 'Q' }] }
    await expect(withManagedTextRouting(['groq', 'gemini_flash_lite'], () => completeJSON(args)))
      .rejects.toMatchObject({ code: 'managed_attempt_limit' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('keeps hosted requests inside the configured lane when its only key is missing', async () => {
    process.env.OPENAI_API_KEY = 'unit-test-openai'
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(withManagedTextRouting(['groq'], () => completeJSON({
      messages: [{ role: 'user', content: 'Q' }], provider: 'openai_mini',
    }))).rejects.toBeTruthy()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(getFallbackProviders('openai_mini')[0]).toBe('openai_mini')
  })
})

describe('readiness requires complete provider answers', () => {
  it.each([
    ['blocking', 'length'], ['streaming', 'length'],
    ['blocking', 'content_filter'], ['streaming', 'content_filter'],
  ])('does not certify a %s answer ending with %s', async (transport, finishReason) => {
    process.env.GROQ_API_KEY = 'unit-test-groq'
    const fetchMock = vi.fn(async (_url, options) => {
      const request = JSON.parse(options.body)
      if (!request.stream) return transport === 'blocking'
        ? Response.json({ choices: [{ message: { content: 'Partial' }, finish_reason: finishReason }] })
        : jsonAnswer()
      const event = { choices: [{ delta: { content: 'Partial' }, finish_reason: finishReason }] }
      return new Response(`data: ${JSON.stringify(event)}\n\ndata: [DONE]\n\n`, {
        headers: { 'Content-Type': 'text/event-stream' },
      })
    })
    vi.stubGlobal('fetch', fetchMock)
    await expect(testProviderConnection('groq')).rejects.toMatchObject({
      code: finishReason === 'length' ? 'output_truncated' : 'output_filtered',
    })
    expect(fetchMock).toHaveBeenCalledTimes(transport === 'blocking' ? 1 : 2)
    expect(_getProviderHealthForTests().verifiedRoutes).toEqual({})
    expect(_getProviderHealthForTests().lastWorkingTextProvider).toBeNull()
  })
})
