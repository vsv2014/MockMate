// Shared logic for the serverless functions (api/*.js) and the local dev server
// (server.js). Files prefixed with _ are not treated as routes by Vercel.
import OpenAI from 'openai'
import { analyze } from '../../shared/delivery.js'
import { fetchWithTimeout } from './http.js'
import { isRateLimit, isQuotaExhausted, isTransient } from '../../shared/llm-errors.js'

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
  },
  // Anthropic via its OpenAI-compatible endpoint (works with the openai client).
  claude_opus: {
    label: 'Claude Opus 4.8', envKey: 'ANTHROPIC_API_KEY',
    baseURL: 'https://api.anthropic.com/v1/',
    model: () => 'claude-opus-4-8'
  },
  claude_sonnet: {
    label: 'Claude Sonnet 4.6', envKey: 'ANTHROPIC_API_KEY',
    baseURL: 'https://api.anthropic.com/v1/',
    model: () => 'claude-sonnet-4-6'
  },
  claude_haiku: {
    label: 'Claude Haiku 4.5 (fast)', envKey: 'ANTHROPIC_API_KEY',
    baseURL: 'https://api.anthropic.com/v1/',
    model: () => 'claude-haiku-4-5'
  }
}

export function searchConfigured() {
  return !!(process.env.TAVILY_API_KEY || process.env.SERPER_API_KEY)
}

// Which providers are actually configured (have a key) — used for default selection + fallback.
export function availableProviders() {
  const list = Object.entries(CATALOG)
    .filter(([, p]) => process.env[p.envKey])
    .map(([id, p]) => ({ id, label: p.label }))
  if (process.env.LLM_API_KEY) list.push({ id: 'custom', label: process.env.LLM_MODEL || 'Custom model' })
  return list
}

// Tier-based provider preference (used for auto-escalation). Keeps provider/key policy in
// core.js (with CATALOG) rather than re-derived from process.env in interview.js. Returns
// null if nothing's configured — callers fall back to the requested provider.
export function pickFastProvider() {
  return process.env.OPENAI_API_KEY ? 'openai_mini' : process.env.GEMINI_API_KEY ? 'gemini' : null
}
export function pickStrongProvider() {
  return process.env.OPENAI_API_KEY ? 'openai' : pickFastProvider()
}

// EVERY model in the catalog, each flagged whether it has a key — for the UI dropdown.
// Configured ones are selectable; the rest are shown disabled with a "needs key" hint.
export function allProviders() {
  return Object.entries(CATALOG).map(([id, p]) => ({
    id,
    // Reflect a custom OPENAI_MODEL in the label so the dropdown confirms it's active.
    label: id === 'openai' && process.env.OPENAI_MODEL ? `OpenAI · ${process.env.OPENAI_MODEL}` : p.label,
    envKey: p.envKey, configured: !!process.env[p.envKey]
  }))
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
  throw Object.assign(new Error('Screen analysis needs a vision key — add an OpenAI (GPT-4o) or Gemini key in ⚙ Settings.'), { status: 400 })
}

// Resolve a chosen provider id to { key, baseURL, model }, with sensible fallback.
function resolveProvider(id) {
  const c = CATALOG[id]
  if (c && process.env[c.envKey]) return { key: process.env[c.envKey], baseURL: c.baseURL, model: c.model() }
  if (process.env.LLM_API_KEY) return { key: process.env.LLM_API_KEY, baseURL: process.env.LLM_BASE_URL, model: process.env.LLM_MODEL || 'gemini-2.5-flash' }
  const first = availableProviders()[0]
  if (first && CATALOG[first.id]) { const p = CATALOG[first.id]; return { key: process.env[p.envKey], baseURL: p.baseURL, model: p.model() } }
  const e = new Error(NO_PROVIDER_MSG); e.status = 402; throw e
}

function clientFor(prov) {
  return new OpenAI({ apiKey: prov.key, ...(prov.baseURL ? { baseURL: prov.baseURL } : {}) })
}

// The API endpoint a provider id talks to — used to make failover jump to a DIFFERENT
// service. Same-endpoint siblings (e.g. gpt-4o & gpt-4o-mini both hit api.openai.com)
// share an outage, so there's no point trying one right after the other fails.
function baseUrlFor(id) {
  const c = CATALOG[id]
  if (c) return c.baseURL
  if (id === 'custom') return process.env.LLM_BASE_URL || 'custom'
  return ''
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
// Error classifiers live in shared/ (single source shared with the client retry path).

// Cache: remember which provider last worked so we skip failed ones immediately
let lastWorkingProvider = null
const rateLimitedUntil = {}   // provId → timestamp when ban expires
// A 429 is "slow down for a bit", not "this model is dead". Keep the ban short so the
// user's CHOSEN model comes back within the same interview instead of being switched
// away for 5 minutes after one transient burst.
const RATE_LIMIT_BAN_MS = 90 * 1000

// Surface-neutral guidance shared by every entry point. Works for the desktop app (keys are
// added in Settings ⚙) — not phrased as ".env", which is only the Vercel deployment surface.
const NO_PROVIDER_MSG = 'No AI provider key found. Open Settings (⚙) and add a key — OpenAI, Anthropic (Claude), Gemini, or Groq (Gemini & Groq have free tiers).'

// Throw a clear, distinct error when the user simply hasn't added any key yet — so callers don't
// get a misleading "all providers rate-limited" (429) when nothing is configured at all.
export function assertProviderConfigured() {
  if (availableProviders().length === 0) { const e = new Error(NO_PROVIDER_MSG); e.status = 402; throw e }
}

function getFallbackProviders(requestedId) {
  // Preferred try-order (fast/cheap first), then EVERY other configured provider appended —
  // so ANY second key you add (Anthropic/Claude, Groq, Gemini, a custom endpoint, …) is part
  // of the failover, not just this hardcoded subset. That's what makes auto-switch actually work.
  const order = ['openai_mini', 'groq', 'gemini', 'openai', 'claude_haiku', 'claude_sonnet', 'claude_opus']
  const configured = availableProviders().map(p => p.id)
  const now = Date.now()
  // Filter out recently rate-limited providers
  const available = [...new Set([requestedId, ...order, ...configured])]
    .filter(id => configured.includes(id))
    .filter(id => !rateLimitedUntil[id] || rateLimitedUntil[id] < now)
  // Respect the caller's REQUESTED provider as primary — keep it first whenever it's
  // available. Only use last-known-working to order the REMAINING fallbacks. (Previously
  // lastWorkingProvider was forced first even over an explicit choice, so after one
  // failover the app would stay switched off the user's selected model.)
  if (requestedId && available.includes(requestedId)) {
    const reqBase = baseUrlFor(requestedId)
    // Order fallbacks so a DIFFERENT endpoint than the primary comes first (stable sort keeps
    // the preference order within each group). On a primary outage the switch is instant —
    // same-endpoint siblings are tried only as a last resort.
    const rest = available.filter(id => id !== requestedId)
      .sort((a, b) => (baseUrlFor(a) === reqBase ? 1 : 0) - (baseUrlFor(b) === reqBase ? 1 : 0))
    // Prefer last-known-working first ONLY if it's on a different endpoint than the primary
    // (a same-endpoint sibling would share the primary's outage, so don't lead with it).
    if (lastWorkingProvider && lastWorkingProvider !== requestedId && rest.includes(lastWorkingProvider) && baseUrlFor(lastWorkingProvider) !== reqBase) {
      return [requestedId, lastWorkingProvider, ...rest.filter(id => id !== lastWorkingProvider)]
    }
    return [requestedId, ...rest]
  }
  // Requested provider unavailable (banned/unconfigured) — fall back, last-working first.
  if (lastWorkingProvider && available.includes(lastWorkingProvider)) {
    return [lastWorkingProvider, ...available.filter(id => id !== lastWorkingProvider)]
  }
  return available.length ? available : [requestedId]
}

export async function completeJSON({ messages, maxTokens = 1600, provider }) {
  assertProviderConfigured()
  const providerQueue = getFallbackProviders(provider)
  let lastError

  for (const provId of providerQueue) {
    let prov
    try { prov = resolveProvider(provId) } catch { continue }
    const llm = clientFor(prov), model = prov.model

    // Gemini 2.5 models THINK by default — reasoning silently eats the token
    // budget, so the actual answer gets truncated into invalid JSON. Disable it
    // and force a clean JSON object (no ```json fences). Scoped to Gemini so
    // Groq/OpenAI requests are unchanged.
    const isGemini = /gemini/i.test(model)
    const ask = async msgs => {
      for (let attempt = 0; ; attempt++) {
        try {
          const params = { model, max_tokens: maxTokens, messages: msgs }
          if (isGemini) { params.reasoning_effort = 'none'; params.response_format = { type: 'json_object' } }
          const r = await llm.chat.completions.create(params)
          return r.choices[0].message.content
        } catch (e) {
          // Retry rate-limits AND transient 5xx/network hiccups with growing backoff,
          // up to 3 tries, before giving up on this provider.
          if ((!isRateLimit(e) && !isTransient(e)) || attempt >= 2) throw e
          await sleep(800 * (attempt + 1))
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
        rateLimitedUntil[provId] = Date.now() + RATE_LIMIT_BAN_MS
        console.warn(`[MockMate] ${provId} rate-limited → trying next provider`)
        continue
      }
      if (isTransient(e)) {
        // Provider had a transient hiccup (503/overloaded/timeout) even after retries —
        // try the next configured provider rather than breaking the interview.
        console.warn(`[MockMate] ${provId} transient error (${e?.status || ''}) → trying next provider`)
        continue
      }
      throw e   // genuine error (auth, bad request) — fail fast
    }
  }

  // All providers exhausted
  if (isQuotaExhausted(lastError)) {
    const e = new Error('Your AI provider is out of credits (insufficient quota). Add billing/credits, switch to another model, or set a free GEMINI_API_KEY as a fallback.')
    e.status = 402; e.code = 'insufficient_quota'; throw e
  }
  if (isTransient(lastError)) {
    const e = new Error('The AI provider is temporarily unavailable (503/overloaded). It usually clears in a few seconds — please try again, or add a second provider key (e.g. GEMINI) for automatic failover.')
    e.status = 503; throw e
  }
  const e = new Error('All your AI provider keys are rate-limited right now. Add a second key (Gemini or Groq — free) in ⚙ Settings for automatic failover, or try again in a moment.')
  e.status = 429; throw e
}

// All vision-capable providers (in preference order) — so screen analysis can fail over
// OpenAI ↔ Gemini instead of dying on one provider's 429.
function visionProviders() {
  const list = []
  if (process.env.OPENAI_API_KEY) list.push({ id: 'openai', key: process.env.OPENAI_API_KEY, baseURL: 'https://api.openai.com/v1', model: process.env.OPENAI_MODEL && /4o|4\.1|gpt-4/.test(process.env.OPENAI_MODEL) ? process.env.OPENAI_MODEL : 'gpt-4o' })
  if (process.env.GEMINI_API_KEY) list.push({ id: 'gemini', key: process.env.GEMINI_API_KEY, baseURL: CATALOG.gemini.baseURL, model: CATALOG.gemini.model() })
  return list
}

// Vision completion with retry + provider fallback. Returns the raw model text.
// Fixes "429 (no body)" on screen analysis: a rate-limit now retries with backoff,
// then falls over to the other vision provider, instead of erroring on the first try.
export async function visionComplete({ imageBase64, prompt, maxTokens = 1500, detail = 'auto' }) {
  const providers = visionProviders()
  if (!providers.length) {
    const e = new Error('Screen analysis needs a vision model — add an OPENAI_API_KEY (GPT-4o) or GEMINI_API_KEY in ⚙ Settings.')
    e.status = 400; throw e
  }
  let lastError
  for (const prov of providers) {
    const llm = clientFor(prov)
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const resp = await llm.chat.completions.create({
          model: prov.model, max_tokens: maxTokens,
          messages: [{ role: 'user', content: [
            { type: 'image_url', image_url: { url: `data:image/png;base64,${imageBase64}`, detail } },
            { type: 'text', text: prompt }
          ] }]
        })
        const raw = resp.choices?.[0]?.message?.content
        if (raw) { lastWorkingProvider = prov.id; return raw }
        throw new Error('No response from vision model')
      } catch (e) {
        lastError = e
        if ((isRateLimit(e) || isTransient(e)) && attempt < 2) { await sleep(800 * (attempt + 1)); continue }
        break   // give up on this provider → try the next
      }
    }
  }
  if (isQuotaExhausted(lastError)) { const e = new Error('Your vision provider is out of credits. Add billing, or add a free GEMINI_API_KEY as a fallback.'); e.status = 402; throw e }
  if (isRateLimit(lastError)) { const e = new Error('Vision model is rate-limited. Add a second vision key (e.g. a free GEMINI_API_KEY) so screen analysis can fail over, or try again in a moment.'); e.status = 429; throw e }
  throw lastError || new Error('Screen analysis failed')
}

// Streaming text completion — emits tokens via onToken as they arrive (true SSE).
// Provider fallback only kicks in BEFORE the first token; once streaming has begun
// we don't restart on another provider (that would duplicate output).
export async function streamText({ messages, maxTokens = 700, provider, onToken, onUsage, signal }) {
  assertProviderConfigured()
  const providerQueue = getFallbackProviders(provider)
  let lastError, emitted = false
  for (const provId of providerQueue) {
    let prov
    try { prov = resolveProvider(provId) } catch { continue }
    const llm = clientFor(prov), model = prov.model
    try {
      const params = { model, max_tokens: maxTokens, messages, stream: true }
      if (/gemini/i.test(model)) params.reasoning_effort = 'none'
      // Only OpenAI/Groq reliably support stream usage; gate it so others don't 400.
      const supportsUsage = /openai\.com|groq\.com/.test(prov.baseURL || '')
      if (supportsUsage) params.stream_options = { include_usage: true }
      let usage = null
      const stream = await llm.chat.completions.create(params, signal ? { signal } : undefined)
      for await (const chunk of stream) {
        if (chunk?.usage) usage = chunk.usage
        const tok = chunk?.choices?.[0]?.delta?.content || ''
        if (tok) { emitted = true; onToken?.(tok) }
      }
      lastWorkingProvider = provId
      if (usage && onUsage) onUsage({ model, input: usage.prompt_tokens || 0, output: usage.completion_tokens || 0 })
      return
    } catch (e) {
      // Client disconnected (question superseded / overlay closed) — stop immediately and
      // do NOT fail over to another provider, which would re-spend tokens on a dead request.
      if (signal?.aborted || e?.name === 'AbortError') throw e
      lastError = e
      if (isRateLimit(e)) rateLimitedUntil[provId] = Date.now() + RATE_LIMIT_BAN_MS
      if (emitted) throw e   // already streamed partial output — don't restart elsewhere
      // Before any token: only fall over for retryable classes (rate-limit / transient).
      // A genuine error (bad/expired key = 401, malformed request = 400) fails FAST with a
      // clear message — same as completeJSON — instead of silently trying every provider.
      if (!isRateLimit(e) && !isTransient(e)) throw e
    }
  }
  if (isQuotaExhausted(lastError)) {
    const e = new Error('Your AI provider is out of credits (insufficient quota). Add billing/credits, switch model, or add a free GEMINI_API_KEY fallback.')
    e.status = 402; e.code = 'insufficient_quota'; throw e
  }
  throw lastError || new Error('No LLM provider could stream a response')
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
  const r = await fetchWithTimeout('https://api.deepgram.com/v1/auth/grant', {
    method: 'POST',
    headers: { Authorization: `Token ${process.env.DEEPGRAM_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ttl_seconds: 300 })   // 5 min — long enough to (re)establish the stream on reconnects
  }, 8000)
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
