#!/usr/bin/env node
// MockMate model eval harness — benchmark candidate models on real interview questions so the
// default model choice is data-driven, not a guess. For each (model × question) it generates an
// answer, scores it with an LLM judge against evals/rubric.md, and prints a scoreboard of
// quality / latency (p50,p95) / estimated cost. Results are also written to evals/results.json.
//
// Usage:
//   OPENAI_API_KEY=sk-... ANTHROPIC_API_KEY=sk-ant-... node evals/run.mjs
// Only candidates whose key env-var is set are run; the rest are skipped. Uses the `openai` SDK
// (already a dependency) for OpenAI-compatible providers and a raw fetch for Anthropic.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import OpenAI from 'openai'

const DIR = path.dirname(fileURLToPath(import.meta.url))
const questions = JSON.parse(fs.readFileSync(path.join(DIR, 'questions.json'), 'utf8'))
const rubric = fs.readFileSync(path.join(DIR, 'rubric.md'), 'utf8')

// ── Candidates. Prices are $/1M tokens (input/output) — verify against the provider before trusting
// the cost column. For OpenAI-compatible providers (Groq, Gemini-OpenAI, …) add `baseURL`. ──
const CANDIDATES = [
  { label: 'gpt-5.4',         api: 'openai',    model: 'gpt-5.4',         keyEnv: 'OPENAI_API_KEY',    inP: 2.50, outP: 15.00 },
  { label: 'gpt-5.4-mini',    api: 'openai',    model: 'gpt-5.4-mini',    keyEnv: 'OPENAI_API_KEY',    inP: 0.75, outP: 4.50 },
  { label: 'claude-sonnet-5', api: 'anthropic', model: 'claude-sonnet-5', keyEnv: 'ANTHROPIC_API_KEY', inP: 3.00, outP: 15.00 },
  { label: 'claude-haiku-4-5',api: 'anthropic', model: 'claude-haiku-4-5',keyEnv: 'ANTHROPIC_API_KEY', inP: 1.00, outP: 5.00 },
  // e.g. Groq: { label:'llama-3.3-70b', api:'openai', model:'llama-3.3-70b-versatile', baseURL:'https://api.groq.com/openai/v1', keyEnv:'GROQ_API_KEY', inP:0.59, outP:0.79 },
]

// One fixed judge scores every answer, so scores are comparable across candidates.
const JUDGE = { api: 'openai', model: 'gpt-5.4', keyEnv: 'OPENAI_API_KEY', baseURL: undefined }

// Mirror your PRODUCTION interview-copilot prompt here for a faithful benchmark.
const RESUME = `Software engineer, 5 yrs. Backend at Kore.ai: rebuilt the candidate-matching queue (skill-weighted scoring, cut wait times ~40%). Node, Go, Postgres, Kafka. Led a 3-engineer team.`
const answerPrompt = q => ({
  system: `You are MockMate, a real-time interview copilot. The candidate is in a LIVE ${q.role} interview. Given the interviewer's question, produce a concise, speakable answer the candidate can read aloud — grounded in THEIR resume, structured for the question type, with no preamble. Resume: ${RESUME}`,
  user: `Interviewer asks (${q.type}): "${q.q}"`,
})

async function callOpenAI(c, { system, user }) {
  const client = new OpenAI({ apiKey: process.env[c.keyEnv], baseURL: c.baseURL })
  const t = process.hrtime.bigint()
  const r = await client.chat.completions.create({
    model: c.model,
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    max_completion_tokens: 700,
  })
  const ms = Number(process.hrtime.bigint() - t) / 1e6
  return { text: r.choices[0]?.message?.content || '', inTok: r.usage?.prompt_tokens || 0, outTok: r.usage?.completion_tokens || 0, ms }
}

async function callAnthropic(c, { system, user }) {
  const t = process.hrtime.bigint()
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': process.env[c.keyEnv], 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: c.model, max_tokens: 700, system, messages: [{ role: 'user', content: user }] }),
  })
  const ms = Number(process.hrtime.bigint() - t) / 1e6
  const j = await r.json()
  if (!r.ok) throw new Error(j?.error?.message || `anthropic ${r.status}`)
  const text = (j.content || []).filter(b => b.type === 'text').map(b => b.text).join('')
  return { text, inTok: j.usage?.input_tokens || 0, outTok: j.usage?.output_tokens || 0, ms }
}
const call = (c, p) => (c.api === 'anthropic' ? callAnthropic(c, p) : callOpenAI(c, p))

async function judge(q, answer) {
  const client = new OpenAI({ apiKey: process.env[JUDGE.keyEnv], baseURL: JUDGE.baseURL })
  const r = await client.chat.completions.create({
    model: JUDGE.model,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: `You are a strict interview-answer grader.\n${rubric}\nReturn ONLY JSON: {"relevance":n,"correctness":n,"structure":n,"specificity":n,"conciseness":n,"overall":n,"note":"<= 10 words"} (each n is 1-5).` },
      { role: 'user', content: `Question (${q.type}, ${q.role}): ${q.q}\n\nCandidate answer:\n${answer}` },
    ],
  })
  try { return JSON.parse(r.choices[0].message.content) } catch { return null }
}

const pctl = (arr, p) => { const s = [...arr].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] : 0 }

const results = []
for (const c of CANDIDATES) {
  if (!process.env[c.keyEnv]) { console.log(`skip ${c.label} — ${c.keyEnv} not set`); continue }
  console.log(`\n=== ${c.label} ===`)
  const scores = [], lats = []; let inTot = 0, outTot = 0
  for (const q of questions) {
    try {
      const a = await call(c, answerPrompt(q))
      const s = await judge(q, a.text)
      inTot += a.inTok; outTot += a.outTok; lats.push(a.ms)
      if (s?.overall) scores.push(s.overall)
      console.log(`  [${q.type.padEnd(19)}] ${String(Math.round(a.ms)).padStart(6)}ms  overall=${s?.overall ?? '?'}  ${s?.note || ''}`)
    } catch (e) { console.log(`  [${q.type.padEnd(19)}] ERROR ${e.message}`) }
  }
  results.push({
    model: c.label,
    avgQuality: scores.length ? +(scores.reduce((x, y) => x + y, 0) / scores.length).toFixed(2) : null,
    p50ms: Math.round(pctl(lats, 50)),
    p95ms: Math.round(pctl(lats, 95)),
    costPerSet: +((inTot / 1e6) * c.inP + (outTot / 1e6) * c.outP).toFixed(4),
    n: scores.length,
  })
}

console.log('\n\n================ SCOREBOARD ================')
console.table(results)
fs.writeFileSync(path.join(DIR, 'results.json'), JSON.stringify(results, null, 2))
console.log(`\nWrote ${path.relative(process.cwd(), path.join(DIR, 'results.json'))}. costPerSet = cost to run ALL ${questions.length} questions once, per model.`)
console.log('Pick by: highest avgQuality within your live-latency budget (watch p95), then cost.')
