import { describe, it, expect, vi } from 'vitest'
import { runBenchmark, measure, summarize, validateRun } from './benchmark.mjs'
const options = { provider: 'groq', model: 'openai/gpt-oss-120b', task: 'text', repeats: 1 }
const env = { MOCKMATE_RUN_MODEL_BENCHMARK: '1', GROQ_API_KEY: 'fixture-key' }
const chunks = async function* (values) { for (const value of values) yield value }
const text = (content, finish_reason = null) => ({ choices: [{ delta: { content }, finish_reason }] })
describe('provider benchmark safety and measurement', () => {
  it('defaults to zero requests even with credentials and opt-in env', async () => {
    const request = vi.fn()
    const result = await runBenchmark(options, { env, request })
    expect(result.mode).toBe('dry-run')
    expect(result.requestsPlanned).toBe(4)
    expect(request).not.toHaveBeenCalled()
    expect(result.summary).toBeUndefined()
  })
  it('requires both live gates and caps repeats', () => {
    expect(() => validateRun({ ...options, live: true }, {})).toThrow('Live calls require')
    expect(() => validateRun({ ...options, repeats: 6 })).toThrow('1..5')
    expect(() => validateRun({ ...options, provider: 'cerebras', model: 'zai-glm-4.7' })).toThrow('non-deprecated')
  })
  it('ignores reasoning fields and whitespace for first content timing', async () => {
    let time = 0
    const result = await measure(chunks([
      { choices: [{ delta: { reasoning_content: 'private reasoning' } }] },
      text(' '), text('answer'), text('', 'stop'),
    ]), () => (time += 10))
    expect(result.firstContentMs).toBe(10)
    expect(result.answer).toBe(' answer')
    expect(result.status).toBe('ok')
  })
  it('marks empty, incomplete, truncated and failed streams separately', async () => {
    expect((await measure(chunks([text('', 'stop')]))).status).toBe('empty')
    expect((await measure(chunks([text('partial')]))).status).toBe('incomplete')
    expect((await measure(chunks([text('partial', 'length')]))).status).toBe('truncated_or_nontext_finish')
    const bad = async function* () { yield text('partial'); throw Object.assign(new Error('secret-key'), { status: 429 }) }
    const result = await measure(bad())
    expect(result.status).toBe('error')
    expect(result.httpStatus).toBe(429)
    expect(JSON.stringify(result)).not.toContain('secret-key')
  })
  it('makes exactly one request per fixture with no fallback and no automatic retry', async () => {
    const request = vi.fn(async () => { throw Object.assign(new Error('secret-key'), { status: 503 }) })
    const result = await runBenchmark({ ...options, live: true }, { env, request })
    expect(request).toHaveBeenCalledTimes(4)
    expect(result.summary.failed).toBe(4)
    expect(result.summary.firstContentP95Ms).toBeNull()
    expect(JSON.stringify(result)).not.toContain('secret-key')
  })
  it('includes a real synthetic image for the vision case and records returned model', async () => {
    const request = vi.fn(async body => {
      expect(body.messages[0].content[1].image_url.url).toMatch(/^data:image\/png;base64,iVBOR/)
      return chunks([{ ...text('Use i < nums.length; result is 6.', 'stop'), model: 'actual-model' }])
    })
    const result = await runBenchmark({ ...options, task: 'vision', live: true }, { env, request })
    expect(request).toHaveBeenCalledTimes(1)
    expect(result.rows[0].returnedModel).toBe('actual-model')
    expect(result.rows[0].firstUsefulAnswerMs).toBeNull()
    expect(result.summary.successful).toBe(1)
  })
  it('reports percentiles alongside failure counts without inventing cost or quality', () => {
    const result = summarize([{ status: 'ok', firstContentMs: 10, totalMs: 100 },
      { status: 'ok', firstContentMs: 20, totalMs: 200 }, { status: 'error' }])
    expect(result.firstContentP50Ms).toBe(10)
    expect(result.firstContentP95Ms).toBe(20)
    expect(result.failed).toBe(1)
    expect(result.costUsd).toBeNull()
  })
})
