import fs from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { MODEL_CATALOG, isExcludedModel, usesCompletionTokenBudget, claudeLowLatencyThinking } from '../../shared/modelRegistry.js'

export const fixtures = [
  { id: 'coding', prompt: 'Implement TypeScript twoSum returning indices. Explain complexity and duplicate handling.' },
  { id: 'sql', prompt: 'Given employees(id, department, salary), write SQL for the top three distinct salaries per department including ties.' },
  { id: 'architecture', prompt: 'Design an idempotent webhook consumer. Explain retries, deduplication, crashes and transactional boundaries.' },
  { id: 'behavioral', prompt: 'Give a hypothetical STAR example of resolving a production incident. Clearly identify it as hypothetical.' },
  { id: 'screenshot', image: 'screenshot.png', prompt: 'Read the code in this screenshot. Identify the bug, give the smallest fix and state the expected result.' },
]

export function validateRun({ provider, model, live = false, repeats = 1, task = 'text' }, env = process.env) {
  const catalog = MODEL_CATALOG[provider]
  if (!catalog) throw new Error('Choose an explicit provider alias from MODEL_CATALOG.')
  if (!Number.isInteger(repeats) || repeats < 1 || repeats > 5) throw new Error('Repeats must be 1..5.')
  if (!['text', 'vision'].includes(task)) throw new Error('Task must be text or vision.')
  const family = catalog.envKey.replace('_API_KEY', '').toLowerCase()
  if (!model || isExcludedModel(family, model)) throw new Error('An explicit non-deprecated model ID is required.')
  if (live && env.MOCKMATE_RUN_MODEL_BENCHMARK !== '1') throw new Error('Live calls require MOCKMATE_RUN_MODEL_BENCHMARK=1 and --live.')
  if (live && !env[catalog.envKey]) throw new Error(`Missing ${catalog.envKey}.`)
  return catalog
}

export const percentile = (values, p) => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b)
  return sorted.length ? sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)] : null
}

// Measures the arrival of non-whitespace content, not semantic usefulness or screen paint.
// Reasoning fields are excluded. Inline reasoning emitted inside content requires review.
export async function measure(stream, now = () => performance.now()) {
  const start = now()
  let firstContentMs = null, answer = '', usage = null, returnedModel = null, finishReason = null
  try {
    for await (const chunk of stream) {
      returnedModel = chunk.model || returnedModel
      usage = chunk.usage || usage
      const choice = chunk.choices?.[0]
      const text = choice?.delta?.content
      if (typeof text === 'string') {
        answer += text
        if (firstContentMs === null && text.trim()) firstContentMs = now() - start
      }
      if (choice?.finish_reason) finishReason = choice.finish_reason
    }
    const status = !answer.trim() ? 'empty' : finishReason === 'stop' ? 'ok' : finishReason ? 'truncated_or_nontext_finish' : 'incomplete'
    return { status, firstContentMs, totalMs: now() - start, answer, usage, returnedModel }
  } catch (error) {
    // Never persist SDK messages, request headers or credentials in reports.
    return { status: error?.name === 'AbortError' ? 'timeout_or_cancelled' : 'error',
      httpStatus: Number.isInteger(error?.status) ? error.status : null,
      firstContentMs, totalMs: now() - start, answer, usage, returnedModel }
  }
}

export function summarize(rows) {
  const ok = rows.filter(r => r.status === 'ok')
  return {
    samples: rows.length, successful: ok.length, failed: rows.length - ok.length,
    // Failures are counted separately; percentiles must never conceal failure rate.
    firstContentP50Ms: percentile(ok.map(r => r.firstContentMs), .5),
    firstContentP95Ms: percentile(ok.map(r => r.firstContentMs), .95),
    completionP95Ms: percentile(ok.map(r => r.totalMs), .95),
    quality: 'unscored: manual rubric required', costUsd: null,
  }
}

export async function runBenchmark(options, { env = process.env, request, now } = {}) {
  const catalog = validateRun(options, env)
  const selected = fixtures.filter(f => options.task === 'vision' ? f.image : !f.image)
  if (!options.live) return { mode: 'dry-run', provider: options.provider, model: options.model,
    task: options.task, requestsPlanned: selected.length * options.repeats, fixtures: selected.map(f => f.id),
    note: 'No network calls and no performance results.' }
  if (!request) {
    const { default: OpenAI } = await import('openai')
    const client = new OpenAI({ apiKey: env[catalog.envKey], baseURL: catalog.baseURL, maxRetries: 0 })
    request = (body, signal) => client.chat.completions.create(body, { signal, timeout: 30000, maxRetries: 0 })
  }
  const rows = []
  for (let repeat = 0; repeat < options.repeats; repeat++) {
    for (const fixture of selected) {
      const content = fixture.image ? [
        { type: 'text', text: fixture.prompt },
        { type: 'image_url', image_url: { url: `data:image/png;base64,${(await fs.readFile(new URL(fixture.image, import.meta.url))).toString('base64')}` } },
      ] : fixture.prompt
      const thinking = catalog.envKey === 'ANTHROPIC_API_KEY' ? claudeLowLatencyThinking(options.model) : null
      const body = { model: options.model, messages: [{ role: 'user', content }], stream: true,
        ...(usesCompletionTokenBudget(catalog.baseURL, options.model) ? { max_completion_tokens: 1024 } : { max_tokens: 1024 }),
        ...(thinking ? { thinking } : {}) }
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 30000)
      try {
        // Lazy generator includes connection/setup latency in measurement.
        const stream = (async function* () { yield* await request(body, controller.signal) })()
        const result = await measure(stream, now)
        rows.push({ fixtureId: fixture.id, repeat, requestedModel: options.model, ...result,
          qualityScore: null, firstUsefulAnswerMs: null, costUsd: null })
      } finally { clearTimeout(timer) }
    }
  }
  return { mode: 'live', fidelity: 'direct-provider-synthetic-streaming', provider: options.provider,
    model: options.model, task: options.task, timestamp: new Date().toISOString(),
    requestSettings: { maxOutputTokens: 1024, timeoutMs: 30000, sdkRetries: 0, fallback: false },
    summary: summarize(rows), rows }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2)
    const value = name => args[args.indexOf(name) + 1]
    const provider = args.includes('--provider') ? value('--provider') : 'groq'
    const options = { provider, model: args.includes('--model') ? value('--model') : MODEL_CATALOG[provider]?.defaultModel,
      live: args.includes('--live'), repeats: args.includes('--repeats') ? Number(value('--repeats')) : 1,
      task: args.includes('--task') ? value('--task') : 'text' }
    const report = await runBenchmark(options)
    const json = JSON.stringify(report, null, 2) + '\n'
    if (args.includes('--out')) await fs.writeFile(value('--out'), json, { flag: 'wx' })
    else process.stdout.write(json)
    if (report.summary?.failed) process.exitCode = 1
  } catch (error) { console.error(error.message); process.exitCode = 1 }
}
