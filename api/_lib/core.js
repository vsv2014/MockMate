// Shared logic for the serverless functions (api/*.js) and the local dev server
// (server.js). Files prefixed with _ are not treated as routes by Vercel.
import OpenAI from 'openai'
import { analyze } from '../../shared/delivery.js'
import { fetchWithTimeout } from './http.js'
import { isRateLimit, isQuotaExhausted, isTransient } from '../../shared/llm-errors.js'

// ── Provider registry ───────────────────────────────────────────────────────
// Keys live in env (server-side, never shipped to the browser). The client
// chooses which provider by id; the server resolves it here.
// Every model default is env-overridable (X_MODEL) so a renamed/unavailable id is a one-line .env
// fix — no code change. Exact ids drift fast; listModels() also live-discovers what each key can
// actually use, and completeJSON/streamText bench-and-failover on a bad id, so a stale default
// degrades gracefully rather than breaking a session.
const CATALOG = {
  // ── OpenAI ──
  gpt_5: {
    label: 'GPT-5.4', envKey: 'OPENAI_API_KEY',
    baseURL: 'https://api.openai.com/v1',
    model: () => process.env.OPENAI_GPT5_MODEL || 'gpt-5.4'
  },
  openai: {
    label: 'GPT-4o', envKey: 'OPENAI_API_KEY',
    baseURL: 'https://api.openai.com/v1',
    model: () => process.env.OPENAI_MODEL || 'gpt-4o'
  },
  openai_mini: {
    label: 'GPT mini (fast)', envKey: 'OPENAI_API_KEY',
    baseURL: 'https://api.openai.com/v1',
    model: () => process.env.OPENAI_MINI_MODEL || 'gpt-4o-mini'   // un-hardcoded — set OPENAI_MINI_MODEL=gpt-5-mini to modernize
  },
  // ── Google Gemini ──
  gemini_flash_lite: {
    label: 'Gemini 3.1 Flash-Lite (fastest)', envKey: 'GEMINI_API_KEY',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    model: () => process.env.GEMINI_FLASH_LITE_MODEL || 'gemini-3.1-flash-lite'
  },
  gemini_3_flash: {
    label: 'Gemini 3 Flash', envKey: 'GEMINI_API_KEY',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    model: () => process.env.GEMINI_3_MODEL || 'gemini-3-flash'
  },
  gemini: {
    label: 'Gemini 2.5 Flash', envKey: 'GEMINI_API_KEY',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    model: () => process.env.GEMINI_MODEL || 'gemini-2.5-flash'
  },
  // ── Groq (LPU — very low TTFT) ──
  groq: {
    label: 'Groq · Llama 3.3 70B', envKey: 'GROQ_API_KEY',
    baseURL: 'https://api.groq.com/openai/v1',
    model: () => process.env.GROQ_MODEL || 'llama-3.3-70b-versatile'
  },
  // ── Cerebras (Wafer-Scale — fastest throughput; OpenAI-compatible) ──
  cerebras: {
    label: 'Cerebras · Llama 3.3 70B', envKey: 'CEREBRAS_API_KEY',
    baseURL: 'https://api.cerebras.ai/v1',
    model: () => process.env.CEREBRAS_MODEL || 'llama-3.3-70b'
  },
  // ── Anthropic via its OpenAI-compatible endpoint (works with the openai client) ──
  claude_opus: {
    label: 'Claude Opus 4.8', envKey: 'ANTHROPIC_API_KEY',
    baseURL: 'https://api.anthropic.com/v1/',
    model: () => process.env.ANTHROPIC_OPUS_MODEL || 'claude-opus-4-8'
  },
  claude_sonnet_5: {
    label: 'Claude Sonnet 5', envKey: 'ANTHROPIC_API_KEY',
    baseURL: 'https://api.anthropic.com/v1/',
    model: () => process.env.ANTHROPIC_SONNET5_MODEL || 'claude-sonnet-5'
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
// AUTO uses KNOWN-GOOD current models — IDs every key of that provider can actually call — so the
// first request never wastes a round-trip 400ing on a model the key lacks (which benches it and
// silently drops the answer to a lower tier). The newer/faster catalog entries (Gemini 3 Flash-Lite,
// Cerebras, GPT-5.4, Sonnet 5) stay selectable in the dropdown and remain in the failover queue.
// FAST tier — Live hints / simple questions. Optimize time-to-first-token + generous limits.
export function pickFastProvider() {
  if (process.env.GEMINI_API_KEY) return 'gemini'          // 2.5-flash: fast, free, universally available
  if (process.env.OPENAI_API_KEY) return 'openai_mini'     // gpt-4o-mini (override via OPENAI_MINI_MODEL)
  if (process.env.CEREBRAS_API_KEY) return 'cerebras'
  if (process.env.GROQ_API_KEY) return 'groq'
  return null
}
// STRONG tier — coding / system-design. A strong model the key can definitely use.
export function pickStrongProvider() {
  if (process.env.OPENAI_API_KEY) return 'openai'          // gpt-4o: strong + universally available
  if (process.env.ANTHROPIC_API_KEY) return 'claude_opus'  // claude-opus-4-8
  return pickFastProvider()
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

// Ask each CONFIGURED provider what models its key can ACTUALLY use — so the picker is always
// current and never 400s on a stale/unavailable model id (the Gemini-2.5 trap). Returns
// [{ id:'provider::model', provider, model, label }]. Per-provider failures are swallowed
// (best-effort discovery) so one bad key can't break the whole list.
export async function listModels() {
  const out = []
  const push = (provider, model, label) => { if (model) out.push({ id: `${provider}::${model}`, provider, model, label }) }
  const settle = async (fn) => { try { await fn() } catch {} }

  await Promise.all([
    // OpenAI — chat models only (skip audio/image/embedding/etc.)
    process.env.OPENAI_API_KEY && settle(async () => {
      const r = await fetchWithTimeout('https://api.openai.com/v1/models', { headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` } })
      if (!r.ok) return
      ;((await r.json())?.data || []).map(m => m.id)
        .filter(id => /^(gpt-|o[0-9]|chatgpt)/i.test(id) && !/audio|realtime|transcrib|tts|image|embedding|moderation|search|dall|whisper/i.test(id))
        .sort().reverse()
        .forEach(id => push('openai', id, `OpenAI · ${id}`))
    }),
    // Anthropic (Claude) — the base id 'claude_sonnet' just carries the shared key/endpoint.
    process.env.ANTHROPIC_API_KEY && settle(async () => {
      const r = await fetchWithTimeout('https://api.anthropic.com/v1/models?limit=100', { headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' } })
      if (!r.ok) return
      ;((await r.json())?.data || []).forEach(m => push('claude_sonnet', m.id, `Claude · ${m.display_name || m.id}`))
    }),
    // Google Gemini — models that support generateContent.
    process.env.GEMINI_API_KEY && settle(async () => {
      const r = await fetchWithTimeout(`https://generativelanguage.googleapis.com/v1beta/models?key=${process.env.GEMINI_API_KEY}&pageSize=100`)
      if (!r.ok) return
      ;((await r.json())?.models || [])
        .filter(m => (m.supportedGenerationMethods || []).includes('generateContent') && /gemini/i.test(m.name || ''))
        .forEach(m => { const id = (m.name || '').replace(/^models\//, ''); push('gemini', id, `Gemini · ${m.displayName || id}`) })
    }),
    // Groq (OpenAI-compatible).
    process.env.GROQ_API_KEY && settle(async () => {
      const r = await fetchWithTimeout('https://api.groq.com/openai/v1/models', { headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}` } })
      if (!r.ok) return
      ;((await r.json())?.data || []).map(m => m.id).filter(id => !/whisper|tts|guard/i.test(id))
        .forEach(id => push('groq', id, `Groq · ${id}`))
    }),
  ].filter(Boolean))
  return out
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
  throw aiError('vision_none', 400)
}

// A provider id may be a plain CATALOG key ('openai') OR an encoded dynamic-model pick
// ('openai::gpt-5.1' = that provider's key/endpoint + an exact model chosen from /api/models).
// baseOf() returns the CATALOG key so failover/ban logic keeps working on the provider level.
const baseOf = id => (id && id.includes('::')) ? id.slice(0, id.indexOf('::')) : id

// Resolve a chosen provider id to { key, baseURL, model }, with sensible fallback.
function resolveProvider(id) {
  // Encoded "providerId::modelId" — use that provider's key/endpoint with the exact chosen model.
  if (id && id.includes('::')) {
    const base = id.slice(0, id.indexOf('::')), model = id.slice(id.indexOf('::') + 2)
    const cc = CATALOG[base]
    if (cc && process.env[cc.envKey] && model) return { key: process.env[cc.envKey], baseURL: cc.baseURL, model }
    id = base   // base unusable → fall through to normal resolution
  }
  const c = CATALOG[id]
  if (c && process.env[c.envKey]) return { key: process.env[c.envKey], baseURL: c.baseURL, model: c.model() }
  if (process.env.LLM_API_KEY) return { key: process.env.LLM_API_KEY, baseURL: process.env.LLM_BASE_URL, model: process.env.LLM_MODEL || 'gemini-2.5-flash' }
  const first = availableProviders()[0]
  if (first && CATALOG[first.id]) { const p = CATALOG[first.id]; return { key: process.env[p.envKey], baseURL: p.baseURL, model: p.model() } }
  throw aiError('no_provider', 402)
}

function clientFor(prov) {
  return new OpenAI({ apiKey: prov.key, ...(prov.baseURL ? { baseURL: prov.baseURL } : {}) })
}

// The API endpoint a provider id talks to — used to make failover jump to a DIFFERENT
// service. Same-endpoint siblings (e.g. gpt-4o & gpt-4o-mini both hit api.openai.com)
// share an outage, so there's no point trying one right after the other fails.
function baseUrlFor(id) {
  id = baseOf(id)
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

// Mode-aware user-facing errors. The SAME engine serves TWO deployments: the local BYOK server
// (server.js :3002), where the user owns the key, and the managed proxy (backend/server.js :4000),
// where they don't. "Check your API key in Settings" is correct advice for BYOK but confusing for a
// managed user who has no key to check — so the managed backend sets MOCKMATE_MANAGED=1 and we swap
// the wording to the action a managed user actually has: retry, or switch to their own key.
const managedMode = () => process.env.MOCKMATE_MANAGED === '1'
// Each entry: [ byokMessage, managedMessage ]. Same status code either way.
const AI_ERRORS = {
  no_provider: [
    'No AI provider key found. Open Settings (⚙) and add a key — OpenAI, Anthropic (Claude), Gemini, or Groq (Gemini & Groq have free tiers).',
    'MockMate AI is temporarily unavailable. Please try again in a moment, or switch to your own API key in Settings (⚙).',
  ],
  quota: [
    'Your AI provider is out of credits (insufficient quota). Add billing/credits, switch to another model, or set a free GEMINI_API_KEY as a fallback.',
    'MockMate AI has hit a temporary capacity limit. Please try again shortly, or switch to your own API key in Settings (⚙) for uninterrupted use.',
  ],
  rate: [
    'All your AI provider keys are rate-limited right now. Add a second key (Gemini or Groq — free) in ⚙ Settings for automatic failover, or try again in a moment.',
    'MockMate AI is busy right now. Please try again in a moment, or switch to your own API key in Settings (⚙).',
  ],
  transient: [
    'The AI provider is temporarily unavailable (503/overloaded). It usually clears in a few seconds — please try again, or add a second provider key (e.g. GEMINI) for automatic failover.',
    'MockMate AI is temporarily unavailable. It usually clears in a few seconds — please try again.',
  ],
  generic: [
    'Couldn\'t reach your AI right now. Check your API key in ⚙ Settings — some free keys hit limits or reject models during long sessions; a funded OpenAI key runs reliably.',
    'Couldn\'t reach MockMate AI right now. Please try again, or switch to your own API key in Settings (⚙).',
  ],
  vision_none: [
    'Screen analysis needs a vision model — add an OPENAI_API_KEY (GPT-4o) or GEMINI_API_KEY in ⚙ Settings.',
    'Screen analysis is temporarily unavailable. Please try again, or add your own OpenAI/Gemini key in Settings (⚙).',
  ],
  vision_quota: [
    'Your vision provider is out of credits. Add billing, or add a free GEMINI_API_KEY as a fallback.',
    'Screen analysis has hit a temporary capacity limit. Please try again shortly, or add your own key in Settings (⚙).',
  ],
  vision_rate: [
    'Vision model is rate-limited. Add a second vision key (e.g. a free GEMINI_API_KEY) so screen analysis can fail over, or try again in a moment.',
    'Screen analysis is busy right now. Please try again in a moment.',
  ],
}
// Build a user-facing Error with the wording that matches the current deployment mode.
function aiError(kind, status) {
  const pair = AI_ERRORS[kind] || AI_ERRORS.generic
  const e = new Error(managedMode() ? pair[1] : pair[0])
  e.status = status
  return e
}

// Throw a clear, distinct error when the user simply hasn't added any key yet — so callers don't
// get a misleading "all providers rate-limited" (429) when nothing is configured at all.
export function assertProviderConfigured() {
  if (availableProviders().length === 0) throw aiError('no_provider', 402)
}

function getFallbackProviders(requestedId) {
  // Preferred try-order (fast/cheap first), then EVERY other configured provider appended —
  // so ANY second key you add (Anthropic/Claude, Groq, Gemini, a custom endpoint, …) is part
  // of the failover, not just this hardcoded subset. That's what makes auto-switch actually work.
  // Known-good current models first so failover never leads with a speculative id that 400s; the
  // newer entries (gpt_5 / gemini_3_flash / flash-lite / sonnet_5 / cerebras) are still in the queue.
  const order = ['gemini', 'openai_mini', 'groq', 'openai', 'cerebras', 'claude_haiku', 'gemini_3_flash', 'gemini_flash_lite', 'gpt_5', 'claude_sonnet', 'claude_sonnet_5', 'claude_opus']
  const configured = availableProviders().map(p => p.id)
  const now = Date.now()
  const reqBase = baseOf(requestedId)
  const encoded = !!requestedId && requestedId !== reqBase   // 'provider::model' dynamic pick
  // Filter out recently rate-limited providers (bans are keyed by the base provider id).
  const available = [...new Set([reqBase, ...order, ...configured])]
    .filter(id => configured.includes(id))
    .filter(id => !rateLimitedUntil[id] || rateLimitedUntil[id] < now)
  // Dynamic-model pick → lead with the EXACT encoded choice so its chosen model is used,
  // then the remaining configured providers as automatic failover.
  if (encoded && available.includes(reqBase)) {
    return [requestedId, ...available.filter(id => id !== reqBase)]
  }
  // Respect the caller's REQUESTED provider as primary — keep it first whenever it's
  // available. Only use last-known-working to order the REMAINING fallbacks.
  if (reqBase && available.includes(reqBase)) {
    const reqUrl = baseUrlFor(reqBase)
    // Order fallbacks so a DIFFERENT endpoint than the primary comes first (stable sort keeps
    // the preference order within each group). On a primary outage the switch is instant —
    // same-endpoint siblings are tried only as a last resort.
    const rest = available.filter(id => id !== reqBase)
      .sort((a, b) => (baseUrlFor(a) === reqUrl ? 1 : 0) - (baseUrlFor(b) === reqUrl ? 1 : 0))
    if (lastWorkingProvider && lastWorkingProvider !== reqBase && rest.includes(lastWorkingProvider) && baseUrlFor(lastWorkingProvider) !== reqUrl) {
      return [reqBase, lastWorkingProvider, ...rest.filter(id => id !== lastWorkingProvider)]
    }
    return [reqBase, ...rest]
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
  let lastError, sawQuota = false, sawRate = false, sawTransient = false

  for (const provId of providerQueue) {
    let prov
    try { prov = resolveProvider(provId) } catch { continue }
    const llm = clientFor(prov), model = prov.model

    // Gemini 2.5 models THINK by default — reasoning silently eats the token
    // budget, so the actual answer gets truncated into invalid JSON. Disable it
    // and force a clean JSON object (no ```json fences). Scoped to Gemini so
    // Groq/OpenAI requests are unchanged.
    const isGemini = /gemini/i.test(model)
    // JSON mode is for OpenAI/Groq only. Gemini 2.5 (OpenAI-compat) 400s on
    // response_format:json_object — it just needs reasoning_effort:'none' (set below) to stop
    // its default "thinking" from eating the token budget. This matches streamText, which works.
    const jsonMode = /openai\.com|groq\.com/i.test(prov.baseURL || '')
    const ask = async msgs => {
      let useExtras = true   // JSON-mode / reasoning params; dropped if this provider 400s on them
      for (let attempt = 0; ; attempt++) {
        try {
          const params = { model, max_tokens: maxTokens, messages: msgs }
          if (useExtras && isGemini) params.reasoning_effort = 'none'
          if (useExtras && jsonMode) params.response_format = { type: 'json_object' }
          const r = await llm.chat.completions.create(params)
          // A content-filter / safety refusal / some Gemini responses come back with an empty
          // choices array. Throw a transient-classified error so we retry, rather than a raw
          // TypeError on r.choices[0].
          const choice = r.choices?.[0]
          if (!choice?.message) { const e = new Error('provider returned no choices'); e.status = 503; throw e }
          return choice.message.content ?? ''
        } catch (e) {
          // A 400 while sending the optional JSON-mode/reasoning params usually means THIS
          // provider/model rejects one of them (e.g. some Gemini models 400 on reasoning_effort).
          // Drop the extras and retry once before treating it as a real failure.
          if (e?.status === 400 && useExtras && (jsonMode || isGemini)) {
            console.warn(`[llm] ${provId} rejected JSON-mode params (400) → retrying without them`)
            useExtras = false
            attempt--   // param-probe shouldn't consume a real transient/rate retry
            continue
          }
          // Retry rate-limits AND transient 5xx/network hiccups with growing backoff.
          if ((!isRateLimit(e) && !isTransient(e)) || attempt >= 2) throw e
          await sleep(800 * (attempt + 1))
        }
      }
    }

    try {
      const raw = await ask(messages)
      let parsed
      try {
        parsed = extractJSON(raw)
      } catch {
        const fixed = await ask([
          { role: 'system', content: 'You repair malformed JSON. Output ONLY one valid JSON object — no prose, no code fences, no trailing commas.' },
          { role: 'user', content: 'Fix this into a single valid JSON object:\n\n' + String(raw || '').slice(0, 8000) }
        ])
        parsed = extractJSON(fixed)
      }
      lastWorkingProvider = provId   // remember only AFTER a clean parse — not for garbage output
      return parsed
    } catch (e) {
      lastError = e
      // Check quota BEFORE rate-limit: "insufficient_quota" also matches the rate-limit regex,
      // but out-of-credits is a different, more actionable problem.
      if (isQuotaExhausted(e)) { sawQuota = true; console.warn(`[MockMate] ${provId} out of quota → trying next provider`); continue }
      if (isRateLimit(e)) {
        sawRate = true
        rateLimitedUntil[baseOf(provId)] = Date.now() + RATE_LIMIT_BAN_MS
        console.warn(`[MockMate] ${provId} rate-limited → trying next provider`)
        continue
      }
      if (isTransient(e)) {
        sawTransient = true
        console.warn(`[MockMate] ${provId} transient error (${e?.status || ''}) → trying next provider`)
        continue
      }
      // Genuine error (bad model id, invalid key, bad request) on THIS provider. Fail over to the
      // next configured provider. A 400/401/403/404 won't self-heal this session, so BENCH the
      // provider briefly — otherwise a permanently-broken key (e.g. a Gemini model your key can't
      // use) gets retried on every single request, spamming logs and adding latency to each turn.
      if ([400, 401, 403, 404].includes(e?.status)) rateLimitedUntil[baseOf(provId)] = Date.now() + RATE_LIMIT_BAN_MS
      console.error(`[llm] ${provId} (${model}) failed (${e?.status || ''}): ${e?.message || e} → trying next provider`)
      continue
    }
  }

  // All providers exhausted — surface the MOST actionable error seen across ALL of them
  // (not just the last), so an earlier out-of-credits/rate-limit isn't masked by a later 400.
  if (sawQuota) { const e = aiError('quota', 402); e.code = 'insufficient_quota'; throw e }
  if (sawRate) throw aiError('rate', 429)
  if (sawTransient) throw aiError('transient', 503)
  // Every configured provider hit a genuine error. Keep the technical detail in the LOG (already
  // logged per-provider above), but show the USER a human message — never a raw "400 no body".
  console.error(`[llm] all providers failed — last: ${lastError?.status || ''} ${lastError?.message || lastError}`)
  throw aiError('generic', lastError?.status || 502)
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
  if (!providers.length) throw aiError('vision_none', 400)
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
  if (isQuotaExhausted(lastError)) throw aiError('vision_quota', 402)
  if (isRateLimit(lastError)) throw aiError('vision_rate', 429)
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
      if (isRateLimit(e)) rateLimitedUntil[baseOf(provId)] = Date.now() + RATE_LIMIT_BAN_MS
      if (emitted) throw e   // already streamed partial output — don't restart elsewhere
      // Before any token: only fall over for retryable classes (rate-limit / transient).
      // A genuine error (bad/expired key = 401, malformed request = 400) fails FAST with a
      // clear message — same as completeJSON — instead of silently trying every provider.
      if (!isRateLimit(e) && !isTransient(e)) throw e
    }
  }
  if (isQuotaExhausted(lastError)) { const e = aiError('quota', 402); e.code = 'insufficient_quota'; throw e }
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

// ── LiveKit room token — MockMate "Duo" ─────────────────────────────────────
// A shared room where a friend/mentor joins your interview live: shared transcript + screen +
// a PRIVATE AI co-pilot only the candidate sees (see src/Room.jsx). livekit-server-sdk is imported
// LAZILY inside the function so the shared engine still loads when Duo isn't installed/configured —
// Solo & Live must never break because an OPTIONAL feature's package is missing (same lazy pattern
// as the Mongo store). Configure LIVEKIT_URL / LIVEKIT_API_KEY / LIVEKIT_API_SECRET to enable.
export async function mintToken({ room, identity, name } = {}) {
  const { LIVEKIT_API_KEY, LIVEKIT_API_SECRET, LIVEKIT_URL } = process.env
  if (!room || !identity) { const e = new Error('room and identity are required'); e.status = 400; throw e }
  if (!LIVEKIT_API_KEY || !LIVEKIT_API_SECRET || !LIVEKIT_URL) {
    const e = new Error('Duo/rooms are not configured — set LIVEKIT_URL / LIVEKIT_API_KEY / LIVEKIT_API_SECRET.'); e.status = 501; throw e
  }
  let AccessToken
  try { ({ AccessToken } = await import('livekit-server-sdk')) }
  catch { const e = new Error('Duo needs the livekit-server-sdk package — run `npm i livekit-server-sdk`.'); e.status = 501; throw e }
  const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, { identity, name: name || identity, ttl: '2h' })
  at.addGrant({ roomJoin: true, room, canPublish: true, canSubscribe: true, canPublishData: true })
  return { token: await at.toJwt(), url: LIVEKIT_URL }
}

// ── Embeddings — powers document RAG (chunk → embed → retrieve, see shared/retrieval.js) ─────
// Provider-agnostic, reusing the configured LLM keys: OpenAI text-embedding-3-small (preferred),
// else Gemini text-embedding-004. Returns one vector per input string. Cheap; keep the doc index
// on the client and only hit this to embed chunks (once) + each question.
export async function embed(input) {
  const list = (Array.isArray(input) ? input : [input]).filter(t => t && String(t).trim())
  if (!list.length) return []
  let prov
  if (process.env.OPENAI_API_KEY) prov = { key: process.env.OPENAI_API_KEY, baseURL: 'https://api.openai.com/v1', model: process.env.EMBED_MODEL || 'text-embedding-3-small' }
  else if (process.env.GEMINI_API_KEY) prov = { key: process.env.GEMINI_API_KEY, baseURL: CATALOG.gemini.baseURL, model: process.env.EMBED_MODEL || 'text-embedding-004' }
  else { const e = new Error('Document search needs an OpenAI or Gemini key (for embeddings).'); e.status = 501; throw e }
  const llm = clientFor(prov)
  const r = await llm.embeddings.create({ model: prov.model, input: list.map(t => String(t).slice(0, 8000)) })
  return r.data.map(d => d.embedding)
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
