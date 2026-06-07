// Shared logic for the serverless functions (api/*.js) and the local dev server
// (server.js). Files prefixed with _ are not treated as routes by Vercel.
import OpenAI from 'openai'
import { analyze } from '../../src/delivery.js'

// ── Provider registry ───────────────────────────────────────────────────────
// Keys live in env (server-side, never shipped to the browser). The client
// chooses which provider by id; the server resolves it here.
const CATALOG = {
  openai: {
    label: 'GPT-4o', envKey: 'OPENAI_API_KEY',
    baseURL: 'https://api.openai.com/v1',
    model: () => process.env.OPENAI_MODEL || 'gpt-4o'
  },
  openai_mini: {
    label: 'GPT-4o mini (fast)', envKey: 'OPENAI_API_KEY',
    baseURL: 'https://api.openai.com/v1',
    model: () => 'gpt-4o-mini'
  },
  groq: {
    label: 'Groq · Llama 3.3 70B', envKey: 'GROQ_API_KEY',
    baseURL: 'https://api.groq.com/openai/v1',
    model: () => process.env.GROQ_MODEL || 'llama-3.3-70b-versatile'
  },
  gemini: {
    label: 'Gemini 2.5 Flash', envKey: 'GEMINI_API_KEY',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    model: () => process.env.GEMINI_MODEL || 'gemini-2.5-flash'
  }
}

export function searchConfigured() {
  return !!(process.env.TAVILY_API_KEY || process.env.SERPER_API_KEY)
}

// Which providers are actually configured (have a key) — for the UI picker.
export function availableProviders() {
  const list = Object.entries(CATALOG)
    .filter(([, p]) => process.env[p.envKey])
    .map(([id, p]) => ({ id, label: p.label }))
  if (process.env.LLM_API_KEY) list.push({ id: 'custom', label: process.env.LLM_MODEL || 'Custom model' })
  return list
}

// Vision-capable provider — GPT-4o preferred, Gemini as fallback.
export function resolveVisionProvider() {
  if (process.env.OPENAI_API_KEY) {
    return { key: process.env.OPENAI_API_KEY, baseURL: 'https://api.openai.com/v1', model: 'gpt-4o' }
  }
  if (process.env.GEMINI_API_KEY) {
    const g = CATALOG.gemini
    return { key: process.env.GEMINI_API_KEY, baseURL: g.baseURL, model: g.model() }
  }
  throw Object.assign(new Error('Screen analysis requires OPENAI_API_KEY or GEMINI_API_KEY in your .env file.'), { status: 400 })
}

// Resolve a chosen provider id to { key, baseURL, model }, with sensible fallback.
function resolveProvider(id) {
  const c = CATALOG[id]
  if (c && process.env[c.envKey]) return { key: process.env[c.envKey], baseURL: c.baseURL, model: c.model() }
  if (process.env.LLM_API_KEY) return { key: process.env.LLM_API_KEY, baseURL: process.env.LLM_BASE_URL, model: process.env.LLM_MODEL || 'gemini-2.5-flash' }
  const first = availableProviders()[0]
  if (first && CATALOG[first.id]) { const p = CATALOG[first.id]; return { key: process.env[p.envKey], baseURL: p.baseURL, model: p.model() } }
  const e = new Error('No LLM provider configured — set GROQ_API_KEY and/or GEMINI_API_KEY.'); e.status = 500; throw e
}

function clientFor(prov) {
  return new OpenAI({ apiKey: prov.key, ...(prov.baseURL ? { baseURL: prov.baseURL } : {}) })
}

export function extractJSON(text) {
  if (!text) throw new Error('Empty response from model')
  let t = text.trim()
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fence) t = fence[1].trim()
  const a = t.indexOf('{'), b = t.lastIndexOf('}')
  if (a === -1 || b === -1) throw new Error('No JSON object in model response')
  const body = t.slice(a, b + 1)
  try { return JSON.parse(body) }
  catch { return JSON.parse(body.replace(/,(\s*[}\]])/g, '$1')) }   // Gemini trailing commas
}

// Robust JSON completion: ask the model, parse, and if the JSON is malformed
// (missing commas, truncation, etc.), make ONE repair pass asking the model to
// fix its own output. Handles the messy ways Gemini emits JSON.
const sleep = ms => new Promise(r => setTimeout(r, ms))
const isRateLimit = e => e?.status === 429 || /\b429\b|rate.?limit|quota|resource.?exhausted/i.test(e?.message || '')

// Cache: remember which provider last worked so we skip failed ones immediately
let lastWorkingProvider = null
const rateLimitedUntil = {}   // provId → timestamp when ban expires (5 min)

function getFallbackProviders(requestedId) {
  const order = ['openai_mini', 'groq', 'gemini', 'openai']
  const configured = availableProviders().map(p => p.id)
  const now = Date.now()
  // Filter out recently rate-limited providers
  const available = [...new Set([requestedId, ...order])]
    .filter(id => configured.includes(id))
    .filter(id => !rateLimitedUntil[id] || rateLimitedUntil[id] < now)
  // Put last-known-working first for speed
  if (lastWorkingProvider && available.includes(lastWorkingProvider)) {
    return [lastWorkingProvider, ...available.filter(id => id !== lastWorkingProvider)]
  }
  return available.length ? available : [requestedId]
}

export async function completeJSON({ messages, maxTokens = 1600, provider }) {
  const providerQueue = getFallbackProviders(provider)
  let lastError

  for (const provId of providerQueue) {
    let prov
    try { prov = resolveProvider(provId) } catch { continue }
    const llm = clientFor(prov), model = prov.model

    const ask = async msgs => {
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const r = await llm.chat.completions.create({ model, max_tokens: maxTokens, messages: msgs })
          return r.choices[0].message.content
        } catch (e) {
          if (!isRateLimit(e) || attempt === 1) throw e
          await sleep(1000)
        }
      }
    }

    try {
      const raw = await ask(messages)
      lastWorkingProvider = provId   // remember what worked
      try {
        return extractJSON(raw)
      } catch {
        const fixed = await ask([
          { role: 'system', content: 'You repair malformed JSON. Output ONLY one valid JSON object — no prose, no code fences, no trailing commas.' },
          { role: 'user', content: 'Fix this into a single valid JSON object:\n\n' + String(raw || '').slice(0, 8000) }
        ])
        return extractJSON(fixed)
      }
    } catch (e) {
      lastError = e
      if (isRateLimit(e)) {
        rateLimitedUntil[provId] = Date.now() + 5 * 60 * 1000   // ban for 5 min
      console.warn(`[MockMate] ${provId} rate-limited → trying next provider`)
      continue
      }
      throw e   // non-rate-limit errors (auth, network) — fail fast
    }
  }

  // All providers exhausted
  const e = new Error('All configured AI providers are rate-limited. Add GROQ_API_KEY (free) or GEMINI_API_KEY (free) to .env for automatic fallback.')
  e.status = 429; throw e
}

// ── Deepgram (accurate speech-to-text) ──────────────────────────────────────
export function deepgramConfigured() { return !!process.env.DEEPGRAM_API_KEY }

// Mint a short-lived (30s default) token so the browser can stream audio to
// Deepgram directly without ever seeing the real API key.
// Prefer a short-lived grant token. If the key lacks grant permission, fall back
// to the raw key ONLY for local dev (allowRawKey) — never expose it on a public
// deployment, where a grant-capable (Owner-scoped) key is required.
export async function deepgramToken({ allowRawKey = false } = {}) {
  if (!process.env.DEEPGRAM_API_KEY) { const e = new Error('Deepgram not configured (set DEEPGRAM_API_KEY).'); e.status = 500; throw e }
  const r = await fetch('https://api.deepgram.com/v1/auth/grant', {
    method: 'POST',
    headers: { Authorization: `Token ${process.env.DEEPGRAM_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ttl_seconds: 300 })   // 5 min — long enough to (re)establish the stream on reconnects
  })
  if (r.ok) return await r.json()   // { access_token, expires_in }
  if (allowRawKey) return { access_token: process.env.DEEPGRAM_API_KEY, _raw: true }   // localhost only
  const e = new Error(`Deepgram token grant failed (${r.status}). For deployment, create an Owner-scoped Deepgram key that can mint tokens.`)
  e.status = r.status
  throw e
}


// ── Shared AI feedback report (peer mocks) ──────────────────────────────────
export async function makeReport({ transcript = [], candidateName = 'the candidate', provider } = {}) {
  const candidateText = transcript.filter(t => t.role === 'candidate').map(t => t.text).join('\n')
  const delivery = analyze(candidateText)
  const convo = transcript.map(t => `${(t.role || 'speaker').toUpperCase()} (${t.speaker || ''}): ${t.text}`).join('\n\n')

  const system = `You are a fair, rigorous interview coach. Two real people just did a mock interview. Evaluate the CANDIDATE's performance honestly and specifically, the way a hiring panel would. Both participants will read this, so be constructive.
Return ONE JSON object, no prose, with this shape:
{ "overallScore": <0-100 integer>, "verdict": "Strong Hire" | "Hire" | "Lean Hire" | "Lean No Hire" | "No Hire",
  "dimensions": [ { "name": "<dimension>", "score": <0-5>, "comment": "<specific>" } ],
  "strengths": [ "<bullet>" ], "improvements": [ "<actionable bullet>" ],
  "delivery": { "tip": "<one delivery change for next time>" },
  "summary": "<3-5 sentences; the single most important thing to improve>" }`
  const report = await completeJSON({
    maxTokens: 2600, provider,
    messages: [{ role: 'system', content: system }, { role: 'user', content: `Candidate: ${candidateName}\n\nTranscript:\n${convo}` }]
  })
  report._delivery = delivery
  return report
}
