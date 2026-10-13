import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Fake OpenAI-compatible client: every test supplies `script(params, opts)`, which
// returns an async-iterable stream (or a completion object) or throws.
const calls = []
let script = () => { throw new Error('no script') }

vi.mock('openai', () => ({
  default: class FakeOpenAI {
    constructor(config = {}) {
      this.chat = { completions: { create: async (params, opts) => {
        calls.push({ baseURL: config.baseURL, params: { ...params } })
        return script(params, opts)
      } } }
    }
  },
}))

const ENV = ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'GROQ_API_KEY', 'CEREBRAS_API_KEY', 'LLM_API_KEY', 'LLM_STREAM_TIMEOUT_MS', 'LLM_STREAM_STALL_TIMEOUT_MS']
const saved = {}

beforeEach(() => {
  for (const key of ENV) { saved[key] = process.env[key]; delete process.env[key] }
  calls.length = 0
  vi.resetModules()   // fresh provider cooldown/quarantine state per test
})
afterEach(() => {
  for (const key of ENV) {
    if (saved[key] === undefined) delete process.env[key]
    else process.env[key] = saved[key]
  }
})

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const aborted = () => Object.assign(new Error('Request was aborted.'), { name: 'AbortError' })

function tokenStream(tokens, opts, { gapMs = 0, firstDelayMs = 0, stallBefore = -1, stallMs = 0 } = {}) {
  const signal = opts?.signal
  return {
    async *[Symbol.asyncIterator]() {
      if (firstDelayMs) { await sleep(firstDelayMs); if (signal?.aborted) throw aborted() }
      for (let i = 0; i < tokens.length; i++) {
        if (i === stallBefore) { await sleep(stallMs); if (signal?.aborted) throw aborted() }
        if (gapMs) { await sleep(gapMs); if (signal?.aborted) throw aborted() }
        yield { choices: [{ delta: { content: tokens[i] } }] }
      }
    },
  }
}

async function runStream(core, args = {}) {
  const tokens = []
  let error = null
  try {
    await core.streamText({ messages: [{ role: 'user', content: 'Q' }], maxTokens: 2400, onToken: t => tokens.push(t), ...args })
  } catch (e) { error = e }
  return { tokens, error }
}

describe('Live stream deadline', () => {
  it('keeps streaming a long, healthy answer past the first-token budget', async () => {
    process.env.GEMINI_API_KEY = 'test-gemini'
    process.env.LLM_STREAM_TIMEOUT_MS = '200'
    process.env.LLM_STREAM_STALL_TIMEOUT_MS = '200'
    const words = Array.from({ length: 30 }, (_, i) => `w${i} `)
    script = (params, opts) => tokenStream(words, opts, { gapMs: 20 })   // ~600 ms in total
    const core = await import('./core.js')
    const { tokens, error } = await runStream(core)
    expect(error).toBeNull()
    expect(tokens).toHaveLength(30)
  })

  it('abandons a provider that never starts answering so failover can run', async () => {
    process.env.GEMINI_API_KEY = 'test-gemini'
    process.env.OPENAI_API_KEY = 'test-openai'
    process.env.LLM_STREAM_TIMEOUT_MS = '150'
    let attempt = 0
    script = (params, opts) => (attempt++ === 0
      ? tokenStream(['late'], opts, { firstDelayMs: 400 })
      : tokenStream(['backup answer'], opts))
    const core = await import('./core.js')
    const { tokens, error } = await runStream(core)
    expect(error).toBeNull()
    expect(tokens).toEqual(['backup answer'])
    expect(calls.length).toBeGreaterThanOrEqual(2)
  })

  it('ends a stream that stalls after partial output and keeps the partial answer', async () => {
    process.env.GEMINI_API_KEY = 'test-gemini'
    process.env.LLM_STREAM_TIMEOUT_MS = '1000'
    process.env.LLM_STREAM_STALL_TIMEOUT_MS = '150'
    script = (params, opts) => tokenStream(['a ', 'b ', 'c ', 'd '], opts, { stallBefore: 2, stallMs: 450 })
    const core = await import('./core.js')
    const { tokens, error } = await runStream(core)
    expect(tokens).toEqual(['a ', 'b '])
    expect(error).toBeTruthy()
    expect(String(error.message)).toMatch(/Part of the answer was already shown/i)
    expect(calls).toHaveLength(1)   // never restarts a paid generation after output
  })
})

describe('Claude thinking settings for Live answers', () => {
  it('turns off up-front thinking on Claude Sonnet 5.5 and thinking on Claude Haiku 5.5', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-anthropic'
    script = (params, opts) => tokenStream(['ok'], opts)
    const core = await import('./core.js')
    await runStream(core, { provider: 'claude_sonnet' })
    await runStream(core, { provider: 'claude_haiku' })
    expect(calls[0].params).toMatchObject({ model: 'claude-sonnet-5-5', thinking: { type: 'between_tools' } })
    expect(calls[1].params).toMatchObject({ model: 'claude-haiku-5-5', thinking: { type: 'disabled' } })
  })

  it('does not send the Anthropic thinking field to other providers', async () => {
    process.env.GEMINI_API_KEY = 'test-gemini'
    script = (params, opts) => tokenStream(['ok'], opts)
    const core = await import('./core.js')
    await runStream(core, { provider: 'gemini_3_flash' })
    expect(calls[0].params.thinking).toBeUndefined()
    expect(calls[0].params.reasoning_effort).toBe('none')
  })

  it('retries once without the thinking field if Anthropic rejects it', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-anthropic'
    script = (params, opts) => {
      if (params.thinking) throw Object.assign(new Error('thinking type is not supported for this model'), { status: 400 })
      return tokenStream(['ok'], opts)
    }
    const core = await import('./core.js')
    const { tokens, error } = await runStream(core, { provider: 'claude_sonnet' })
    expect(error).toBeNull()
    expect(tokens).toEqual(['ok'])
    expect(calls).toHaveLength(2)
    expect(calls[0].params.thinking).toEqual({ type: 'between_tools' })
    expect(calls[1].params.thinking).toBeUndefined()
  })

  it('applies the same setting to blocking JSON answers and connection tests', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-anthropic'
    script = () => ({ choices: [{ message: { content: '{"ok":true}' } }], usage: { prompt_tokens: 10, completion_tokens: 3 } })
    const core = await import('./core.js')
    await expect(core.completeJSON({ messages: [{ role: 'user', content: 'Q' }], provider: 'claude_sonnet' })).resolves.toEqual({ ok: true })
    await expect(core.testProviderConnection('claude_haiku')).resolves.toMatchObject({ ok: true, model: 'claude-haiku-5-5' })
    expect(calls[0].params.thinking).toEqual({ type: 'between_tools' })
    expect(calls[1].params.thinking).toEqual({ type: 'disabled' })
  })
})

describe('describeAutomaticRouting', () => {
  it('reports the current Claude generation for an Anthropic-only setup', async () => {
    process.env.ANTHROPIC_API_KEY = 'test-anthropic'
    const core = await import('./core.js')
    expect(core.describeAutomaticRouting()).toEqual({
      fast: { id: 'claude_haiku', model: 'claude-haiku-5-5', label: 'Claude Haiku 5.5' },
      strong: { id: 'claude_sonnet', model: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5' },
    })
  })

  it('keeps Gemini for quick answers and Claude for coding/design when both keys exist', async () => {
    process.env.GEMINI_API_KEY = 'test-gemini'
    process.env.ANTHROPIC_API_KEY = 'test-anthropic'
    const core = await import('./core.js')
    const routing = core.describeAutomaticRouting()
    expect(routing.fast).toMatchObject({ model: 'gemini-3.5-flash-lite', label: 'Gemini 3.5 Flash-Lite' })
    expect(routing.strong).toMatchObject({ model: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5' })
  })

  it('reports nothing when no AI key is configured', async () => {
    const core = await import('./core.js')
    expect(core.describeAutomaticRouting()).toEqual({ fast: null, strong: null })
  })
})

describe('resolved model budgets and safe rejection diagnostics', () => {
  it('applies headroom to the fallback model, not just the requested provider', async () => {
    process.env.GEMINI_API_KEY = 'test-gemini'
    process.env.GROQ_API_KEY = 'test-groq'
    script = (params, opts) => {
      if (params.model.includes('gemini')) throw Object.assign(new Error('unavailable'), { status: 503 })
      return tokenStream(['answer'], opts)
    }
    const core = await import('./core.js')
    const result = await runStream(core, { provider: 'gemini', maxTokens: 380, thinkingTokenFloor: 800 })
    expect(result.error).toBeNull()
    expect(calls[0].params.max_tokens).toBe(380)
    expect(calls.find(c => c.params.model.includes('gpt-oss')).params.max_tokens).toBe(800)
    expect(core.completionBudget({ model: 'plain-model' }, 380, 800)).toEqual({ max_tokens: 380 })
  })
  it('keeps actionable field categories without retaining raw upstream content', async () => {
    const { thinkingRejectionDetails } = await import('./core.js')
    const details = thinkingRejectionDetails({ status: 400, error: { error: { message: 'thinking budget_tokens not supported; private resume Alice sk-example', type: 'invalid_request_error' } } })
    expect(details).toEqual({ status: 400, rejectedFields: ['thinking', 'budget_tokens'], rejectionKind: 'unsupported_setting' })
    expect(JSON.stringify(details)).not.toMatch(/Alice|resume|sk-example/)
  })
})
