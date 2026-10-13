import { MODEL_CATALOG, MODEL_PRIORITIES, EMBEDDING_MODELS, configuredModel, usesCompletionTokenBudget, claudeLowLatencyThinking, isThinkingModel, modelDisplayName } from '../../shared/modelRegistry.js'
// Shared logic for the serverless functions (api/*.js) and the local dev server
// (server.js). Files prefixed with _ are not treated as routes by Vercel.
import OpenAI from 'openai'
import { isCurrentChatModel, isDiscoveredChatModel, isCurrentProviderChoice, isActiveModelRecord, isModelUnavailableError } from '../../shared/currentModels.js'
import { analyze } from '../../shared/delivery.js'
import { fetchWithTimeout } from './http.js'
import { getRetryAfterMs, isRateLimit, isQuotaExhausted, isTransient } from '../../shared/llm-errors.js'
import { LIVE_PROVIDER_ATTEMPT_TIMEOUT_MS, LIVE_STREAM_STALL_TIMEOUT_MS } from '../../shared/liveTiming.js'
import {
  filterVisionProviders,
  markVision429Family,
  markVisionSuccess,
  classifyVisionError,
  shouldRetryVisionAttempt,
  shouldFailoverVision,
  makeVisionRateLimitedError,
  makeVisionUnavailableError,
  runVisionSingleFlight,
  estimateImageBytes,
  visionTelemetry,
  isVisionCooling,
  getVisionCooldown,
} from './visionPolicy.js'

// Forward metadata-only provider events to Electron's local diagnostic store when running in
// its local API service (Node fork in development, utility process in packaged builds).
// Hosted/serverless runtimes have no IPC channel and simply skip it.

// Single truth table for the hosted flag — 1/true/yes/on, trimmed, case-insensitive
// (mirrors backend/src/hostedConfig.js envFlag). Divergent parsers previously meant a
// MOCKMATE_HOSTED=true deploy counted as hosted for /api/arch but silently lost all
// provider diagnostics here (=== '1'), and the Deepgram raw-key gate was case-sensitive.
export function isHostedDeploy(env = process.env) {
  return ['1', 'true', 'yes', 'on'].includes(String(env.MOCKMATE_HOSTED || '').trim().toLowerCase())
}

function providerDiagnostic(event, fields = {}, level = 'info') {
  const row = { component: 'llm', event, level, ...fields }
  try {
    if (typeof process.send === 'function') process.send({ type: 'diagnostic', row })
    else if (process.parentPort) process.parentPort.postMessage({ type: 'diagnostic', row })
    else if (isHostedDeploy()) console.log(JSON.stringify({ ts: new Date().toISOString(), ...row }))
  } catch {}
}

let providerAttemptSequence = 0
const newProviderAttemptId = () => `llm_${Date.now().toString(36)}_${(++providerAttemptSequence).toString(36)}`

// ── Provider registry ───────────────────────────────────────────────────────
// Keys live in env (server-side, never shipped to the browser). The client
// chooses which provider by id; the server resolves it here.
// Every model default is env-overridable (X_MODEL) so a renamed/unavailable id is a one-line .env
// fix — no code change. Exact ids drift fast; listModels() also live-discovers what each key can
// actually use, and completeJSON/streamText bench-and-failover on a bad id, so a stale default
// degrades gracefully rather than breaking a session.
const CATALOG = Object.fromEntries(Object.entries(MODEL_CATALOG).map(([id, record]) => [id, {
  ...record, model: () => configuredModel(id, process.env),
}]))

// Runtime model lifecycle registry. Key-specific provider discovery is the source of
// truth once it succeeds; catalog defaults are only cold-start candidates.
// A confirmed model-specific retirement 400/404 quarantines JUST that model,
// not the entire API-key family. Never abort an already-streaming answer.
const discoveredModels = new Map()
let lastSuccessfulDiscoveries = new Set()
const quarantinedModels = new Map()
const MODEL_QUARANTINE_MS = 6 * 60 * 60 * 1000
const MODEL_REFRESH_INTERVAL_MS = 15 * 60 * 1000
let nextModelDiscoveryAt = 0

function modelFamily(id) {
  const base = String(id || '').split('::', 1)[0]
  if (base.startsWith('openai') || base === 'gpt_6_astra') return 'openai'
  if (base.startsWith('claude')) return 'claude_sonnet'
  if (base.startsWith('gemini')) return 'gemini'
  if (base === 'openrouter') return 'openrouter'
  return base
}

function isQuarantinedModel(family, model, now = Date.now()) {
  const key = `${family}::${model}`
  const expiresAt = quarantinedModels.get(key) || 0
  if (expiresAt && expiresAt <= now) quarantinedModels.delete(key)
  return expiresAt > now
}

function quarantineModel(providerId, model, error) {
  if (!isModelUnavailableError(error) || !model) return false
  const family = modelFamily(providerId)
  if (isQuarantinedModel(family, model)) return true
  quarantinedModels.set(`${family}::${model}`, Date.now() + MODEL_QUARANTINE_MS)
  // A key can access other active models. Re-discover in the background rather
  // than benching every sibling because one model was retired or unavailable.
  const known = discoveredModels.get(family)
  known?.delete(model)
  nextModelDiscoveryAt = 0
  providerDiagnostic('model_quarantined', { provider: family, model, reason: 'model_unavailable' }, 'warn')
  return true
}

function selectActiveModel(alias, { vision = false } = {}) {
  const catalog = CATALOG[alias]
  if (!catalog || !process.env[catalog.envKey]) return null
  const family = modelFamily(alias)
  const known = discoveredModels.get(family)
  const suggested = [
    catalog.model(),
    ...Object.entries(CATALOG)
      .filter(([other]) => modelFamily(other) === family && other !== alias)
      .map(([, p]) => p.model()),
    ...(known ? [...known].sort().reverse() : []),
  ]
  return suggested.find(model =>
    (known ? known.has(model) : isCurrentChatModel(family, model))
    && (!vision || isCurrentChatModel(family, model))
    && !isQuarantinedModel(family, model)
    && (!known || known.has(model))
  ) || null
}

// Refresh opportunistically in the background, never blocking an interview
// on a slow or unavailable provider's /models endpoint. A failed discovery
// preserves the last successfully confirmed models; it does not mark them retired.
function scheduleModelDiscovery() {
  if (process.env.NODE_ENV === 'test') return
  const now = Date.now()
  if (now < nextModelDiscoveryAt) return
  nextModelDiscoveryAt = now + MODEL_REFRESH_INTERVAL_MS
  void listModels().catch(() => {})
}

function newestDiscovered(provider, orderedIds) {
  const known = discoveredModels.get(provider)
  const found = orderedIds.find(id => known?.has(id) && !isQuarantinedModel(provider, id))
  return found ? `${provider}::${found}` : null
}

export function searchConfigured() {
  return !!(process.env.TAVILY_API_KEY || process.env.SERPER_API_KEY)
}

// Which providers are actually configured (have a key) — used for default selection + fallback.
export function availableProviders() {
  const list = Object.entries(CATALOG)
    .filter(([id, p]) => process.env[p.envKey] && selectActiveModel(id))
    .map(([id, p]) => ({ id, label: p.label }))
  if (process.env.LLM_API_KEY) list.push({ id: 'custom', label: process.env.LLM_MODEL || 'Custom model' })
  return list
}

const PROVIDER_TEST_IDS = new Set(['groq', 'gemini', 'openai_mini', 'claude_haiku', 'cerebras', 'openrouter'])
/** Make one small, explicit probe against a selected saved key; this is never part of normal routing. */
export async function testProviderConnection(providerId) {
  const id = String(providerId || '')

  // Deepgram is STT, not an LLM — verify the key via the auth/grant endpoint.
  if (id === 'deepgram') {
    if (!process.env.DEEPGRAM_API_KEY) {
      const error = new Error('No Deepgram key configured.')
      error.status = 404
      throw error
    }
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 8_000)
    try {
      const response = await fetch('https://api.deepgram.com/v1/auth/token', {
        method: 'GET',
        headers: { Authorization: `Token ${process.env.DEEPGRAM_API_KEY}` },
        signal: controller.signal,
      })
      if (!response.ok) {
        const error = new Error(
          response.status === 401 || response.status === 403
            ? 'Deepgram key is invalid or expired. Check Settings → Voice.'
            : `Deepgram connection test failed (HTTP ${response.status}).`
        )
        error.status = response.status
        throw error
      }
      return { ok: true, provider: 'deepgram', model: 'stt' }
    } finally {
      clearTimeout(timer)
    }
  }

  if (!PROVIDER_TEST_IDS.has(id) || !availableProviders().some(provider => provider.id === id)) {
    const error = aiError('no_provider', 404)
    error.message = 'That provider is not configured on this device.'
    throw error
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 8_000)
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const provider = resolveProvider(id)
      const llm = clientFor(provider)
      try {
        const params = {
          model: provider.model,
          ...completionBudget(provider, 64),
          messages: [{ role: 'user', content: 'Reply with exactly: OK' }],
        }
        // Without this, Claude 5-generation thinking can consume the 64-token test budget.
        const thinking = claudeThinkingFor(provider)
        if (thinking) params.thinking = thinking
        const response = await createWithThinkingFallback(llm, params, { signal: controller.signal })
        if (!response.choices?.[0]?.message) {
          const error = new Error('The provider returned no answer. Check the key and model access.')
          error.status = 502
          throw error
        }
        return { ok: true, provider: id, model: provider.model }
      } catch (error) {
        // A retired default should not force a user to search for model names.
        // Try a different active model once; never retry auth or rate-limit errors.
        if (!quarantineModel(id, provider.model, error) || attempt) throw error
        if (!selectActiveModel(id)) throw error
      }
    }
    throw aiError('no_provider', 502)
  } finally {
    clearTimeout(timer)
  }
}

// Tier-aware selection uses model IDs returned for each key when possible.
// Cold starts use current stable catalog defaults; a provider 404/403 fails over.
export function pickFastProvider() {
  if (process.env.GEMINI_API_KEY) return newestDiscovered('gemini', MODEL_PRIORITIES.fast.gemini) || 'gemini_flash_lite'
  if (process.env.OPENAI_API_KEY) return newestDiscovered('openai', MODEL_PRIORITIES.fast.openai) || 'openai_mini'
  if (process.env.CEREBRAS_API_KEY) return 'cerebras'
  if (process.env.GROQ_API_KEY) return 'groq'
  if (process.env.ANTHROPIC_API_KEY) return newestDiscovered('claude_sonnet', MODEL_PRIORITIES.fast.claude_sonnet) || 'claude_haiku'
  if (process.env.OPENROUTER_API_KEY) return newestDiscovered('openrouter', MODEL_PRIORITIES.strong.openrouter) || 'openrouter'
  return null
}

// Which model automatic routing would use right now for quick answers and for
// coding/system-design answers. Settings shows this; it never includes key material.
export function describeAutomaticRouting() {
  const describe = id => {
    if (!id) return null
    try {
      const provider = resolveProvider(id)
      if (!provider?.model) return null
      return { id, model: provider.model, label: modelDisplayName(provider.model) }
    } catch { return null }
  }
  return { fast: describe(pickFastProvider()), strong: describe(pickStrongProvider()) }
}

export function pickStrongProvider() {
  if (process.env.OPENAI_API_KEY) return newestDiscovered('openai', MODEL_PRIORITIES.strong.openai) || 'openai'
  if (process.env.ANTHROPIC_API_KEY) return newestDiscovered('claude_sonnet', MODEL_PRIORITIES.strong.claude_sonnet) || 'claude_sonnet'
  if (process.env.GEMINI_API_KEY) return newestDiscovered('gemini', MODEL_PRIORITIES.strong.gemini) || 'gemini_3_flash'
  if (process.env.OPENROUTER_API_KEY) return newestDiscovered('openrouter', MODEL_PRIORITIES.strong.openrouter) || 'openrouter'
  return pickFastProvider()
}

export function pickBestProvider() {
  const candidates = [
    process.env.ANTHROPIC_API_KEY && newestDiscovered('claude_sonnet', MODEL_PRIORITIES.best.claude_sonnet),
    process.env.OPENAI_API_KEY && newestDiscovered('openai', MODEL_PRIORITIES.best.openai),
    process.env.GEMINI_API_KEY && newestDiscovered('gemini', MODEL_PRIORITIES.best.gemini),
  ].filter(Boolean)
  return candidates[0] || pickStrongProvider()
}

export function _setDiscoveredModelsForTests(provider, models = []) {
  discoveredModels.set(provider, new Set(models))
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
  const staged = new Map()
  const successful = new Set()
  const push = (provider, model, label, record = {}) => {
    if (!isDiscoveredChatModel(provider, model, record) || isQuarantinedModel(provider, model)) return
    if (!staged.has(provider)) staged.set(provider, new Set())
    staged.get(provider).add(model)
    out.push({ id: `${provider}::${model}`, provider, model, label })
  }
  // Replace a provider's known-good set only after that provider was queried successfully.
  // A transient discovery outage must not erase models already proven usable mid-interview.
  const settle = async (provider, fn) => {
    try {
      await fn()
      successful.add(provider)
      discoveredModels.set(provider, new Set(staged.get(provider) || []))
    } catch {}
  }

  await Promise.all([
    // OpenAI — chat models only (skip audio/image/embedding/etc.)
    process.env.OPENAI_API_KEY && settle('openai', async () => {
      const r = await fetchWithTimeout('https://api.openai.com/v1/models', { headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` } })
      if (!r.ok) throw new Error('Model discovery unavailable')
      ;((await r.json())?.data || []).filter(isActiveModelRecord)
        .forEach(m => push('openai', m.id, `OpenAI · ${m.id}`, m))
    }),
    // Anthropic (Claude) — the base id 'claude_sonnet' just carries the shared key/endpoint.
    process.env.ANTHROPIC_API_KEY && settle('claude_sonnet', async () => {
      const r = await fetchWithTimeout('https://api.anthropic.com/v1/models?limit=100', { headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' } })
      if (!r.ok) throw new Error('Model discovery unavailable')
      ;((await r.json())?.data || []).filter(isActiveModelRecord).forEach(m => push('claude_sonnet', m.id, `Claude · ${m.display_name || m.id}`, m))
    }),
    // Google Gemini — models that support generateContent.
    process.env.GEMINI_API_KEY && settle('gemini', async () => {
      const r = await fetchWithTimeout(`https://generativelanguage.googleapis.com/v1beta/models?key=${process.env.GEMINI_API_KEY}&pageSize=100`)
      if (!r.ok) throw new Error('Model discovery unavailable')
      ;((await r.json())?.models || [])
        .filter(m => isActiveModelRecord(m) && (m.supportedGenerationMethods || []).includes('generateContent') && /gemini/i.test(m.name || ''))
        .forEach(m => { const id = (m.name || '').replace(/^models\//, ''); push('gemini', id, `Gemini · ${m.displayName || id}`, m) })
    }),
    // Groq (OpenAI-compatible).
    process.env.GROQ_API_KEY && settle('groq', async () => {
      const r = await fetchWithTimeout('https://api.groq.com/openai/v1/models', { headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}` } })
      if (!r.ok) throw new Error('Model discovery unavailable')
      ;((await r.json())?.data || []).filter(isActiveModelRecord)
        .forEach(m => push('groq', m.id, `Groq · ${m.id}`, m))
    }),
    // Cerebras (OpenAI-compatible).
    process.env.CEREBRAS_API_KEY && settle('cerebras', async () => {
      const r = await fetchWithTimeout('https://api.cerebras.ai/v1/models', { headers: { Authorization: `Bearer ${process.env.CEREBRAS_API_KEY}` } })
      if (!r.ok) throw new Error('Model discovery unavailable')
      ;((await r.json())?.data || []).filter(isActiveModelRecord)
        .forEach(m => push('cerebras', m.id, `Cerebras · ${m.id}`, m))
    }),
    // OpenRouter — multi-model gateway. Models endpoint returns { data: [{ id, ... }] }.
    // Uses provider/model naming (e.g. anthropic/claude-sonnet-5.5).
    process.env.OPENROUTER_API_KEY && settle('openrouter', async () => {
      const r = await fetchWithTimeout('https://openrouter.ai/api/v1/models', {
        headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}` },
      })
      if (!r.ok) throw new Error('Model discovery unavailable')
      ;((await r.json())?.data || []).filter(isActiveModelRecord)
        .forEach(m => push('openrouter', m.id, `OpenRouter · ${m.name || m.id}`, m))
    }),
  ].filter(Boolean))
  lastSuccessfulDiscoveries = successful
  providerDiagnostic('model_discovery_completed', {
    modelCount: out.length,
    providerCount: new Set(out.map(m => m.provider)).size,
  })
  return out
}

// Metadata lets the UI distinguish a successfully checked provider with no
// active models from an offline endpoint; no API key or credential is exposed.
export function getModelDiscoveryStatus() {
  return { discoveredProviders: [...lastSuccessfulDiscoveries] }
}

// A provider id may be a plain CATALOG key ('openai') OR an encoded dynamic-model pick
// ('openai::gpt-6-luna' = that provider's key/endpoint + an exact model chosen from /api/models).
// baseOf() returns the CATALOG key so failover/ban logic keeps working on the provider level.
const baseOf = id => (id && id.includes('::')) ? id.slice(0, id.indexOf('::')) : id

// Resolve a chosen provider id to { key, baseURL, model }, with sensible fallback.
function resolveProvider(id) {
  // Encoded "providerId::modelId" — use that provider's key/endpoint with the exact chosen model.
  if (id && id.includes('::')) {
    const base = id.slice(0, id.indexOf('::')), model = id.slice(id.indexOf('::') + 2)
    const cc = CATALOG[base]
    const family = modelFamily(base)
    const known = discoveredModels.get(family)
    if (cc && process.env[cc.envKey] && (known ? known.has(model) : isCurrentChatModel(family, model))
      && !isQuarantinedModel(family, model) && (!known || known.has(model))) {
      return { key: process.env[cc.envKey], baseURL: cc.baseURL, model }
    }
    id = base   // base unusable → fall through to normal resolution
  }
  const c = CATALOG[id]
  if (c && process.env[c.envKey]) {
    const model = selectActiveModel(id)
    if (model) return { key: process.env[c.envKey], baseURL: c.baseURL, model }
  }
  if (process.env.LLM_API_KEY) return { key: process.env.LLM_API_KEY, baseURL: process.env.LLM_BASE_URL, model: process.env.LLM_MODEL || MODEL_CATALOG.openai_mini.defaultModel }
  const first = availableProviders()[0]
  if (first && CATALOG[first.id]) {
    const p = CATALOG[first.id], model = selectActiveModel(first.id)
    if (model) return { key: process.env[p.envKey], baseURL: p.baseURL, model }
  }
  throw aiError('no_provider', 402)
}

function clientFor(prov) {
  return new OpenAI({ apiKey: prov.key, ...(prov.baseURL ? { baseURL: prov.baseURL } : {}) })
}

// GPT-6 Chat Completions rejects the old max_tokens field; other providers
// have different OpenAI-compatible contracts. Scope this change to OpenAI GPT-6.
export function completionBudget(prov, maxTokens, thinkingTokenFloor = 0) {
  if (isThinkingModel('', prov.model)) maxTokens = Math.max(maxTokens, thinkingTokenFloor)
  return usesCompletionTokenBudget(prov.baseURL, prov.model)
    ? { max_completion_tokens: maxTokens }
    : { max_tokens: maxTokens }
}

// The API endpoint a provider id talks to — used to make failover jump to a DIFFERENT
// service. Same-endpoint siblings (e.g. GPT-6 Sol and Luna both hit api.openai.com)
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

// Text-lane health (Live hints, Solo, Career, Jobs ranking). Vision has its own lane in
// visionPolicy.js — a screen 429 must not reorder or ban text providers, and a text success
// must not prefer a vision-only slot on the next hint.
let lastWorkingTextProvider = null
const textBannedUntil = {}   // provider id → timestamp when its family cooldown expires
const textBannedReason = {}  // provider id → quota | rate_limit | transient | hard_failure
let lastWorkingVisionProvider = null
// Cooldowns are scoped by provider family: a 429 is brief, transient outages are shorter,
// and credential/model failures are benched longer. Provider Retry-After metadata can extend
// a rate/quota cooldown; it never causes an automatic second request for the current stream.
const RATE_LIMIT_BAN_MS = 90 * 1000
const TRANSIENT_BAN_MS = 30 * 1000
const HARD_FAILURE_BAN_MS = 15 * 60 * 1000
const QUOTA_BAN_MS = 5 * 60 * 1000

/** Permanent-looking provider failures — fail over (and briefly bench) before first token. */
export function isProviderHardFail(e) {
  const s = e?.status ?? e?.statusCode
  // 401/403/404 describe credential/model availability and can cool the provider family.
  // A generic 400 is commonly request/model-parameter specific: fail over THIS request without
  // poisoning the provider for every other user/turn.
  return s === 401 || s === 403 || s === 404
}

/** Shared pre-emit failover rule for completeJSON + streamText. */
export function shouldFailoverTextError(e, { emitted = false } = {}) {
  if (emitted) return false
  if (!e) return false
  const status = e?.status ?? e?.statusCode
  if (status === 400 || isQuotaExhausted(e) || isRateLimit(e) || isTransient(e) || isProviderHardFail(e)) return true
  return false
}

function banTextProvider(provId, ms = RATE_LIMIT_BAN_MS, reason = 'rate_limit') {
  if (!provId) return
  // Aliases sharing one key/endpoint are one provider family. If a Gemini model is rejected,
  // immediately trying other hard-coded Gemini aliases repeats the same account/key failure.
  const base = baseOf(provId)
  const familyURL = baseUrlFor(base)
  const expiresAt = Date.now() + Math.max(0, ms)
  for (const id of availableProviders().map(p => p.id)) {
    if (baseUrlFor(id) === familyURL) {
      textBannedUntil[id] = expiresAt
      textBannedReason[id] = reason
    }
  }
  textBannedUntil[base] = expiresAt
  textBannedReason[base] = reason
}

function noteTextProviderFailure(provId, e, model = null) {
  if (quarantineModel(provId, model, e)) return
  const retryAfterMs = getRetryAfterMs(e)
  if (isQuotaExhausted(e)) banTextProvider(provId, Math.max(QUOTA_BAN_MS, retryAfterMs), 'quota')
  else if (isProviderHardFail(e)) banTextProvider(provId, HARD_FAILURE_BAN_MS, 'hard_failure')
  else if (isRateLimit(e)) banTextProvider(provId, Math.max(RATE_LIMIT_BAN_MS, retryAfterMs), 'rate_limit')
  else if (isTransient(e)) banTextProvider(provId, TRANSIENT_BAN_MS, 'transient')
}

function activeTextCooldowns(now = Date.now()) {
  return availableProviders()
    .map(({ id }) => ({ id, until: textBannedUntil[id], reason: textBannedReason[id] || 'unknown' }))
    .filter(row => Number.isFinite(row.until) && row.until > now)
}

function textProviderCoolingError() {
  const now = Date.now()
  const active = activeTextCooldowns(now)
  const reasons = new Set(active.map(row => row.reason))
  const retryAfterMs = active.length ? Math.max(0, Math.min(...active.map(row => row.until)) - now) : 0
  let kind = 'provider_cooling'
  let status = 503
  if (reasons.size === 1 && reasons.has('rate_limit')) { kind = 'rate'; status = 429 }
  else if (reasons.size === 1 && reasons.has('quota')) { kind = 'quota'; status = 402 }
  else if (reasons.size === 1 && reasons.has('transient')) { kind = 'transient'; status = 503 }
  else if (reasons.size > 1 && [...reasons].some(reason => reason !== 'unknown')) kind = 'provider_mixed'

  const error = aiError(kind, status)
  if (kind === 'quota') error.code = 'insufficient_quota'
  else if (kind === 'rate') error.code = 'rate_limit'
  else if (kind === 'transient') error.code = 'transient'
  else if (kind === 'provider_mixed') error.code = 'provider_limits'
  else error.code = 'provider_cooling'
  if (retryAfterMs > 0) error.retryAfterMs = retryAfterMs
  providerDiagnostic('all_providers_cooling', {
    activeProviderCount: active.length,
    reasons: [...reasons].filter(reason => reason !== 'unknown'),
    retryAfterMs: error.retryAfterMs || null,
  }, 'warn')
  return error
}

/** Test helper — reset text/vision preference + text bans (vision cooldowns: visionPolicy). */
export function _resetProviderHealthForTests() {
  lastWorkingTextProvider = null
  lastWorkingVisionProvider = null
  discoveredModels.clear()
  lastSuccessfulDiscoveries = new Set()
  quarantinedModels.clear()
  nextModelDiscoveryAt = 0
  for (const k of Object.keys(textBannedUntil)) delete textBannedUntil[k]
  for (const k of Object.keys(textBannedReason)) delete textBannedReason[k]
}

export function _getProviderHealthForTests() {
  return {
    lastWorkingTextProvider,
    lastWorkingVisionProvider,
    textBannedUntil: { ...textBannedUntil },
    textBannedReason: { ...textBannedReason },
    quarantinedModels: Object.fromEntries(quarantinedModels),
  }
}

/** Test-only: seed text/vision preference without calling providers. */
export function _setProviderHealthForTests({ text, vision, banText, banTextReason } = {}) {
  if (text !== undefined) lastWorkingTextProvider = text
  if (vision !== undefined) lastWorkingVisionProvider = vision
  if (banText) {
    for (const [id, until] of Object.entries(banText)) textBannedUntil[id] = until
  }
  if (banTextReason) {
    for (const [id, reason] of Object.entries(banTextReason)) textBannedReason[id] = reason
  }
}

// Mode-aware user-facing errors. The SAME engine serves TWO deployments: the local BYOK server
// (server.js :3002), where the user owns the key, and the managed proxy (backend/server.js :4000),
// where they don't. "Check your API key in Settings" is correct advice for BYOK but confusing for a
// managed user who has no key to check — so the managed backend sets MOCKMATE_MANAGED=1 and we swap
// the wording to the action a managed user actually has: retry, or switch to their own key.
const managedMode = () => process.env.MOCKMATE_MANAGED === '1'
// Each entry: [ byokMessage, managedMessage ]. Same status code either way.
const AI_ERRORS = {
  no_provider: [
    'No AI provider key found. Open Settings (⚙) and add a supported provider key. Provider billing and usage limits still apply.',
    'MockMate AI is temporarily unavailable. Please try again in a moment, or switch to your own API key in Settings (⚙).',
  ],
  quota: [
    'Your AI provider reported exhausted usage or credits, not a temporary request-rate limit. Add billing/credits or switch to a separately provisioned provider with available usage. Changing models or adding another key under the same provider account may not help.',
    'MockMate AI has hit an upstream usage or credit limit. Please try again later, or switch to your own funded API key in Settings (⚙).',
  ],
  rate: [
    'Your AI provider is temporarily rate-limiting requests or tokens. Wait for its reset or configure a separately provisioned provider in Settings → API Keys; keys in the same provider account may share limits.',
    'MockMate AI is temporarily rate-limited upstream. Please retry after the provider reset, or switch to your own separately provisioned API key in Settings (⚙).',
  ],
  transient: [
    'The AI provider had a temporary outage or network error (this is not a quota diagnosis). Please retry shortly, or configure an independently provisioned fallback in Settings → API Keys.',
    'MockMate AI is temporarily unavailable because of an upstream service or network error. Please try again shortly.',
  ],
  provider_cooling: [
    'All configured AI providers are cooling after recent failures, so MockMate did not send another request. Check provider keys, model access, billing, and limits in Settings → API Keys, then retry shortly.',
    'MockMate AI is temporarily unavailable after upstream provider failures. Please retry shortly, or switch to your own API key in Settings (⚙).',
  ],
  provider_mixed: [
    'All configured AI providers failed for different reasons: one or more may have exhausted usage, be rate-limited, be temporarily unavailable, or have a key/model-access problem. Check billing, limits, credentials, and model access; use a separately provisioned backup if available.',
    'Some upstream AI providers are rate-limited, out of usage, temporarily unavailable, or could not authenticate or access the selected model. Please retry later, or switch to your own separately provisioned API key in Settings (⚙).',
  ],
  auth: [
    'The AI provider rejected the API key. Replace it in Settings → API Keys and test the connection again.',
    'The managed AI provider could not authenticate. Retry later or use your own API key in Settings.',
  ],
  access: [
    'The AI provider denied model access. Check this account’s model permissions or configure another provider in Settings → API Keys.',
    'The managed AI provider denied model access. Retry later or use your own provider in Settings.',
  ],
  model_unavailable: [
    'No usable model remained after automatic recovery. Test the provider connection in Settings or add another provider; you do not need to choose a model.',
    'The managed AI model is unavailable after recovery. Retry later or use your own provider in Settings.',
  ],
  request_invalid: [
    'The AI provider rejected the request format. Export diagnostics from Settings so the integration can be checked; replacing the key may not help.',
    'The managed AI provider rejected the request format. Export diagnostics from Settings and report the failure.',
  ],
  generic: [
    'Could not reach the configured AI provider. Check the provider key, model access, and current provider status in Settings (⚙), then try again or use another supported provider.',
    'Could not reach MockMate AI right now. Please try again shortly, or switch to your own API key in Settings (⚙).',
  ],
  vision_none: [
    'Screen analysis needs a vision-capable model — add an OpenAI GPT-6 or Gemini key in Settings (⚙).',
    'Screen analysis is temporarily unavailable. Please try again, or add your own OpenAI/Gemini key in Settings (⚙).',
  ],
  vision_quota: [
    'Your vision provider reports exhausted usage or credits. Check billing or switch to a separately provisioned vision provider; another key in the same account may share the limit.',
    'Screen analysis has hit an upstream usage or credit limit. Please try again later, or use your own provider key in Settings (⚙).',
  ],
  vision_rate: [
    'Your vision provider is temporarily rate-limiting requests. Wait for its reset or configure a separately provisioned vision provider in Settings (⚙).',
    'Screen analysis is temporarily rate-limited upstream. Please try again after the provider reset.',
  ],
}
// Build a user-facing Error with the wording that matches the current deployment mode.
function aiError(kind, status) {
  const pair = AI_ERRORS[kind] || AI_ERRORS.generic
  const e = new Error(managedMode() ? pair[1] : pair[0])
  e.status = status
  e.kind = kind
  e.code = ({
    no_provider: 'no_provider',
    auth: 'provider_auth', access: 'model_access', model_unavailable: 'model_unavailable', request_invalid: 'request_invalid',
    quota: 'insufficient_quota',
    rate: 'rate_limit',
    transient: 'transient',
    provider_cooling: 'provider_cooling',
    provider_mixed: 'provider_limits',
    vision_quota: 'insufficient_quota',
    vision_none: 'vision_unavailable',
  })[kind] || 'provider_error'
  return e
}

// Throw a clear, distinct error when the user simply hasn't added any key yet — so callers don't
// get a misleading "all providers rate-limited" (429) when nothing is configured at all.
export function assertProviderConfigured() {
  if (availableProviders().length === 0) throw aiError('no_provider', 402)
}

export function getFallbackProviders(requestedId) {
  scheduleModelDiscovery()
  // Preferred try-order (fast/cheap first), then EVERY other configured provider appended —
  // so ANY second key you add (Anthropic/Claude, Groq, Gemini, a custom endpoint, …) is part
  // of the failover, not just this hardcoded subset. That's what makes auto-switch actually work.
  // Known-good current models first so failover never leads with a speculative id that 400s; the
  // current entries remain available by exact key-specific model discovery.
  // One automatic candidate per API-key family. Additional models remain available through
  // /api/models when the user explicitly selects them, but fallback must never spray every
  // hard-coded alias belonging to the same key (the v1.4.9 log tried four Claude aliases).
  const order = ['gemini_flash_lite', 'openai_mini', 'groq', 'cerebras', 'claude_haiku', 'custom']
  const configured = availableProviders().map(p => p.id)
  const now = Date.now()
  const requestedParts = String(requestedId || '').split('::')
  const discoveredChoice = requestedParts.length === 2 && discoveredModels.get(modelFamily(requestedParts[0]))?.has(requestedParts[1])
  const candidateChoice = isCurrentProviderChoice(requestedId) || discoveredChoice ? requestedId : ''
  const requestedFamily = modelFamily(candidateChoice)
  const requestedModel = String(candidateChoice).includes('::') ? String(candidateChoice).split('::').slice(1).join('::') : null
  const safeRequestedId = requestedModel && (isQuarantinedModel(requestedFamily, requestedModel)
    || (discoveredModels.has(requestedFamily) && !discoveredModels.get(requestedFamily).has(requestedModel)))
    ? '' : candidateChoice
  const reqBase = baseOf(safeRequestedId)
  const encoded = !!safeRequestedId && safeRequestedId !== reqBase   // 'provider::model' dynamic pick
  // Filter out recently banned text providers (bans are keyed by the base provider id).
  const candidates = [...new Set([reqBase, lastWorkingTextProvider, ...order, ...configured])]
    .filter(id => configured.includes(id))
    .filter(id => !textBannedUntil[id] || textBannedUntil[id] < now)
  const seenFamilies = new Set()
  const available = candidates.filter(id => {
    // Always retain the explicitly requested model first. For automatic fallbacks retain only
    // the first candidate using a given endpoint/key family.
    if (id === reqBase) { seenFamilies.add(baseUrlFor(id)); return true }
    const family = baseUrlFor(id)
    if (seenFamilies.has(family)) return false
    seenFamilies.add(family)
    return true
  })
  // Dynamic-model pick → lead with the EXACT encoded choice so its chosen model is used,
  // then the remaining configured providers as automatic failover.
  if (encoded && available.includes(reqBase)) {
    return [safeRequestedId, ...available.filter(id => id !== reqBase)]
  }
  // Respect the caller's REQUESTED provider as primary — keep it first whenever it's
  // available. Only use last-known-working TEXT provider to order the REMAINING fallbacks.
  if (reqBase && available.includes(reqBase)) {
    const reqUrl = baseUrlFor(reqBase)
    // Order fallbacks so a DIFFERENT endpoint than the primary comes first (stable sort keeps
    // the preference order within each group). On a primary outage the switch is instant —
    // same-endpoint siblings are tried only as a last resort.
    const rest = available.filter(id => id !== reqBase)
      .sort((a, b) => (baseUrlFor(a) === reqUrl ? 1 : 0) - (baseUrlFor(b) === reqUrl ? 1 : 0))
    const last = lastWorkingTextProvider
    if (last && last !== reqBase && rest.includes(last) && baseUrlFor(last) !== reqUrl) {
      return [reqBase, last, ...rest.filter(id => id !== last)]
    }
    return [reqBase, ...rest]
  }
  // Requested provider unavailable (banned/unconfigured) — fall back, last-working text first.
  if (lastWorkingTextProvider && available.includes(lastWorkingTextProvider)) {
    return [lastWorkingTextProvider, ...available.filter(id => id !== lastWorkingTextProvider)]
  }
  // Do not resurrect the requested provider when every configured family is cooling.
  // The caller will return a typed cooldown error without spending another request.
  return available
}

function exhaustedProviderError({ sawQuota, sawRate, sawTransient, retryAfterMs = 0 } = {}) {
  const kinds = [sawQuota && 'quota', sawRate && 'rate', sawTransient && 'transient'].filter(Boolean)
  const kind = kinds.length > 1 ? 'provider_mixed' : kinds[0] || 'provider_cooling'
  const status = kind === 'quota' ? 402 : kind === 'rate' ? 429 : kind === 'transient' ? 503 : 503
  const error = aiError(kind, status)
  if (retryAfterMs > 0) error.retryAfterMs = retryAfterMs
  return error
}

// Return actionable categories, never arbitrary upstream messages or credentials.
export function actionableProviderError(error) {
  const status = Number(error?.status || error?.statusCode) || 502
  const kind = isQuotaExhausted(error) ? 'quota'
    : isRateLimit(error) ? 'rate'
      : isModelUnavailableError(error) ? 'model_unavailable'
        : status === 401 ? 'auth'
          : status === 403 ? 'access'
            : status === 400 ? 'request_invalid'
              : isTransient(error) ? 'transient' : 'generic'
  return aiError(kind, status >= 400 && status <= 599 ? status : 502)
}

function userFacingPartialStreamError(error) {
  let kind = null
  let status = Number(error?.status || error?.statusCode || 502)
  if (isQuotaExhausted(error)) { kind = 'quota'; status = 402 }
  else if (isRateLimit(error)) { kind = 'rate'; status = 429 }
  else if (isTransient(error)) { kind = 'transient'; status = 503 }
  if (!kind) return error

  const visibleError = aiError(kind, status)
  const retryAfterMs = getRetryAfterMs(error)
  if (retryAfterMs > 0) visibleError.retryAfterMs = retryAfterMs
  visibleError.partial = true
  visibleError.message += ' Part of the answer was already shown; MockMate kept it and did not restart the provider request. Use the question\'s Retry control only if you want a fresh answer.'
  return visibleError
}

// One same-key recovery when a model has definitively disappeared. Do not
// retry every sibling or restart a stream once the user saw any tokens.
function enqueueActiveModelRecovery(queue, currentIndex, provId, previousModel, error, recoveredFamilies) {
  if (!isModelUnavailableError(error)) return
  const alias = baseOf(provId)
  const family = modelFamily(alias)
  if (recoveredFamilies.has(family)) return
  const nextModel = selectActiveModel(alias)
  if (!nextModel || nextModel === previousModel) return
  recoveredFamilies.add(family)
  queue.splice(currentIndex + 1, 0, alias)
  providerDiagnostic('model_replacement_selected', { provider: family, previousModel, replacementModel: nextModel })
}

export async function completeJSON({ messages, maxTokens = 1600, provider, thinkingTokenFloor = 0 }) {
  assertProviderConfigured()
  const providerQueue = getFallbackProviders(provider)
  if (!providerQueue.length) throw textProviderCoolingError()
  let lastError, sawQuota = false, sawRate = false, sawTransient = false, retryAfterMs = 0

  const recoveredFamilies = new Set()
  for (let queueIndex = 0; queueIndex < providerQueue.length; queueIndex++) {
    const provId = providerQueue[queueIndex]
    let prov
    try { prov = resolveProvider(provId) } catch { continue }
    const llm = clientFor(prov), model = prov.model
    const providerStartedAt = Date.now()
    const attemptId = newProviderAttemptId()
    providerDiagnostic('attempt_started', { attemptId, operation: 'json', provider: provId, model, maxTokens: Object.values(completionBudget(prov, maxTokens, thinkingTokenFloor))[0], attemptIndex: queueIndex, contextChars: JSON.stringify(messages).length })

    // Gemini 2.5 models THINK by default — reasoning silently eats the token
    // budget, so the actual answer gets truncated into invalid JSON. Disable it
    // and force a clean JSON object (no ```json fences). Scoped to Gemini so
    // Groq/OpenAI requests are unchanged.
    const isGemini = /gemini/i.test(model)
    // JSON mode is for OpenAI/Groq only. Gemini 2.5 (OpenAI-compat) 400s on
    // response_format:json_object — it just needs reasoning_effort:'none' (set below) to stop
    // its default "thinking" from eating the token budget. This matches streamText, which works.
    const jsonMode = /openai\.com|groq\.com/i.test(prov.baseURL || '')
    // Claude 5-generation thinking is invisible here, eats max_tokens and adds latency.
    const claudeThinking = claudeThinkingFor(prov)
    let requestCount = 0
    const ask = async msgs => {
      let useExtras = true   // JSON-mode / reasoning / thinking params; dropped if this provider 400s on them
      for (let attempt = 0; ; attempt++) {
        try {
          const params = { model, ...completionBudget(prov, maxTokens, thinkingTokenFloor), messages: msgs }
          if (useExtras && isGemini) params.reasoning_effort = 'none'
          if (useExtras && jsonMode) params.response_format = { type: 'json_object' }
          if (useExtras && claudeThinking) params.thinking = claudeThinking
          const requestIndex = requestCount++
          const requestStartedAt = Date.now()
          const r = await llm.chat.completions.create(params)
          providerDiagnostic('request_usage', {
            attemptId, operation: 'json', provider: provId, model,
            requestIndex, retryCount: requestIndex, status: 200,
            contextChars: JSON.stringify(msgs).length,
            durationMs: Date.now() - requestStartedAt,
            inputTokens: r.usage?.prompt_tokens ?? null,
            outputTokens: r.usage?.completion_tokens ?? null,
          })
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
          if (e?.status === 400 && useExtras && (jsonMode || isGemini || claudeThinking)) {
            console.warn(`[llm] ${provId} rejected optional JSON-mode/reasoning/thinking params (400) → retrying without them`)
            if (claudeThinking) providerDiagnostic('thinking_setting_rejected', { attemptId, operation: 'json', provider: provId, model, ...thinkingRejectionDetails(e) }, 'warn')
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
      lastWorkingTextProvider = baseOf(provId)   // remember only AFTER a clean parse — not for garbage output
      providerDiagnostic('attempt_succeeded', { attemptId, operation: 'json', provider: provId, model, durationMs: Date.now() - providerStartedAt })
      return parsed
    } catch (e) {
      lastError = e
      if (quarantineModel(provId, model, e)) {
        enqueueActiveModelRecovery(providerQueue, queueIndex, provId, model, e, recoveredFamilies)
      }
      providerDiagnostic('attempt_failed', { attemptId, operation: 'json', provider: provId, model, status: e?.status || 0, durationMs: Date.now() - providerStartedAt, class: isQuotaExhausted(e) ? 'quota' : isRateLimit(e) ? 'rate_limit' : isTransient(e) ? 'transient' : 'hard_failure' }, 'warn')
      // Check quota BEFORE rate-limit: "insufficient_quota" also matches the rate-limit regex,
      // but out-of-credits is a different, more actionable problem.
      if (isQuotaExhausted(e)) { sawQuota = true; noteTextProviderFailure(provId, e, model); console.warn(`[MockMate] ${provId} out of quota → trying next provider`); continue }
      if (isRateLimit(e)) {
        sawRate = true
        const providerWaitMs = Math.max(RATE_LIMIT_BAN_MS, getRetryAfterMs(e))
        retryAfterMs = retryAfterMs > 0 ? Math.min(retryAfterMs, providerWaitMs) : providerWaitMs
        noteTextProviderFailure(provId, e, model)
        console.warn(`[MockMate] ${provId} rate-limited → trying next provider`)
        continue
      }
      if (isTransient(e)) {
        sawTransient = true
        noteTextProviderFailure(provId, e, model)
        console.warn(`[MockMate] ${provId} transient error (${e?.status || ''}) → trying next provider`)
        continue
      }
      // Genuine error (bad model id, invalid key, bad request) on THIS provider. Fail over to the
      // next configured provider. A 400/401/403/404 won't self-heal this session, so BENCH the
      // provider briefly — otherwise a permanently-broken key (e.g. a Gemini model your key can't
      // use) gets retried on every single request, spamming logs and adding latency to each turn.
      if (isProviderHardFail(e)) noteTextProviderFailure(provId, e, model)
      console.error(`[llm] ${provId} (${model}) failed (${e?.status || ''}): ${e?.message || e} → trying next provider`)
      continue
    }
  }

  // Preserve the distinct cause when only one class failed. If different configured
  // providers failed for different reasons, say so rather than disguising every outcome as quota.
  if (sawQuota || sawRate || sawTransient) {
    throw exhaustedProviderError({ sawQuota, sawRate, sawTransient, retryAfterMs })
  }
  // Every configured provider hit a genuine error. Keep the technical detail in the LOG (already
  // logged per-provider above), but show the USER a human message — never a raw "400 no body".
  console.error(`[llm] all providers failed — last: ${lastError?.status || ''} ${lastError?.message || lastError}`)
  throw actionableProviderError(lastError)
}

// Vision-capable providers — cheap/fast first so screen solve survives free-tier 429s.
// Prefer current Gemini Flash-Lite / GPT-6 Luna before heavier models; skip cooling slots.
export function listVisionProviders() {
  const list = []
  // Apply the same active/discovered/retired-model policy used by text.
  // Vision and text still maintain independent rate-limit health/cooldowns.
  for (const id of ['gemini_flash_lite', 'gemini', 'gemini_3_flash', 'openai_mini', 'openai']) {
    const c = CATALOG[id]
    const model = selectActiveModel(id, { vision: true })
    if (model) list.push({ id, key: process.env[c.envKey], baseURL: c.baseURL, model })
  }
  // Custom vision ids are not in the curated text catalog. These are explicit
  // user overrides and remain permitted unless the provider rejects that exact model.
  if (process.env.GROQ_API_KEY && process.env.GROQ_VISION_MODEL
    && !isQuarantinedModel('groq_vision', process.env.GROQ_VISION_MODEL)) {
    list.push({
      id: 'groq_vision',
      key: process.env.GROQ_API_KEY,
      baseURL: 'https://api.groq.com/openai/v1',
      model: process.env.GROQ_VISION_MODEL,
    })
  }
  if (process.env.VISION_API_KEY && process.env.VISION_MODEL && process.env.VISION_BASE_URL
    && !isQuarantinedModel('custom_vision', process.env.VISION_MODEL)) {
    list.push({
      id: 'custom_vision',
      key: process.env.VISION_API_KEY,
      baseURL: process.env.VISION_BASE_URL,
      model: process.env.VISION_MODEL,
    })
  }
  return list
}

function visionProviders(now = Date.now()) {
  const list = listVisionProviders()
  const ready = filterVisionProviders(list, now)
  if (!ready.length) return []
  // Prefer last-working VISION provider among ready (do not resurrect a cooling provider).
  if (lastWorkingVisionProvider) {
    const hit = ready.find(p => p.id === lastWorkingVisionProvider)
    if (hit) return [hit, ...ready.filter(p => p.id !== hit.id)]
  }
  return ready
}

function visionDataUrl(imageBase64, mime = 'image/png') {
  const raw = String(imageBase64 || '')
  if (raw.startsWith('data:')) return raw
  return `data:${mime || 'image/png'};base64,${raw}`
}

/**
 * Vision completion with provider failover + cooldown.
 * Budget for ONE screen analysis: at most one image call per provider, failover on 429
 * without re-hitting the same provider. No same-provider 429 retry storm.
 *
 * @param {object} opts
 * @param {string} opts.imageBase64
 * @param {string} opts.prompt
 * @param {number} [opts.maxTokens]
 * @param {string} [opts.detail]
 * @param {string} [opts.mime]
 * @param {string} [opts.requestId] — stable screen/request id for single-flight + telemetry
 * @param {string} [opts.fingerprint] — image fingerprint for single-flight key
 * @param {AbortSignal} [opts.signal]
 * @param {{ width?: number, height?: number }} [opts.imageDimensions]
 * @param {function} [opts._callProvider] — test inject
 * @param {boolean} [opts._skipSingleFlight]
 */
export async function visionComplete(opts = {}) {
  const {
    imageBase64, prompt, maxTokens = 1500, detail = 'low', mime = 'image/png',
    requestId, fingerprint, signal, imageDimensions,
    _callProvider, _skipSingleFlight,
  } = opts

  const managed = process.env.MOCKMATE_MANAGED === '1'
  const providersAll = listVisionProviders()
  if (!providersAll.length) throw makeVisionUnavailableError(managed)

  const key = fingerprint || requestId || 'vision-default'
  const rid = requestId || key
  const run = () => visionCompleteOnce({
    imageBase64, prompt, maxTokens, detail, mime, requestId: rid, signal, imageDimensions, _callProvider, managed,
  })
  if (_skipSingleFlight) return run()
  return runVisionSingleFlight(key, rid, run)
}

async function visionCompleteOnce({
  imageBase64, prompt, maxTokens, detail, mime, requestId, signal, imageDimensions, _callProvider, managed,
}) {
  const providers = visionProviders()
  if (!providers.length) {
    // All configured providers are in cooldown.
    if (listVisionProviders().length) throw makeVisionRateLimitedError(managed)
    throw makeVisionUnavailableError(managed)
  }

  const dataUrl = visionDataUrl(imageBase64, mime)
  const imageBytes = estimateImageBytes(imageBase64)
  const dims = imageDimensions || null
  let lastError
  let sawRate = false
  let failover = false
  const debug = process.env.MOCKMATE_DEBUG_VISION === '1'

  const callOne = _callProvider || (async (prov) => {
    const llm = clientFor(prov)
    const resp = await llm.chat.completions.create({
      model: prov.model, ...completionBudget(prov, maxTokens),
      messages: [{ role: 'user', content: [
        { type: 'image_url', image_url: { url: dataUrl, detail } },
        { type: 'text', text: prompt },
      ] }],
    }, signal ? { signal } : undefined)
    return resp.choices?.[0]?.message?.content
  })

  for (let pi = 0; pi < providers.length; pi++) {
    const prov = providers[pi]
    if (signal?.aborted) {
      const e = new Error('Screen analysis cancelled'); e.name = 'AbortError'; throw e
    }
    if (isVisionCooling(prov.id)) continue
    if (pi > 0) failover = true

    for (let attempt = 0; ; attempt++) {
      const t0 = Date.now()
      try {
        const raw = await callOne(prov)
        if (!raw) {
          const e = new Error('No response from vision model'); e.status = 502; throw e
        }
        markVisionSuccess(prov.id)
        lastWorkingVisionProvider = prov.id
        if (debug) {
          console.info('[vision]', visionTelemetry({
            screenRequestId: requestId, provider: prov.id, attempt, imageBytes,
            imageDimensions: dims, status: 'ok', latencyMs: Date.now() - t0, failover,
          }))
        }
        return raw
      } catch (e) {
        lastError = e
        quarantineModel(prov.id, prov.model, e)
        const kind = classifyVisionError(e)
        if (debug) {
          console.info('[vision]', visionTelemetry({
            screenRequestId: requestId, provider: prov.id, attempt, imageBytes,
            imageDimensions: dims, status: kind, latencyMs: Date.now() - t0,
            is429: kind === 'rate', cooldown: getVisionCooldown(prov.id),
            failover, cancelled: kind === 'cancelled',
          }))
        }
        if (kind === 'cancelled') throw e
        if (kind === 'rate') {
          sawRate = true
          markVision429Family(prov.id)
          // Vision lane only — do not ban text providers for a screen 429.
          break // never re-hit this provider for this request
        }
        if (kind === 'auth' || kind === 'bad_request' || kind === 'quota') {
          // Do not retry this provider; try next only for auth if another vendor exists.
          if (kind === 'quota') { /* continue failover */ }
          break
        }
        if (shouldRetryVisionAttempt(kind, attempt)) {
          await sleep(400 * (attempt + 1))
          continue
        }
        if (!shouldFailoverVision(kind)) break
        break
      }
    }
  }

  if (isQuotaExhausted(lastError)) throw aiError('vision_quota', 402)
  if (sawRate || classifyVisionError(lastError) === 'rate') throw makeVisionRateLimitedError(managed)
  if (classifyVisionError(lastError) === 'auth') {
    const e = aiError('vision_none', 401); e.code = 'VISION_AUTH'; throw e
  }
  throw lastError || makeVisionUnavailableError(managed)
}

/** Text-only repair — do NOT re-send the screenshot (avoids a second vision 429). */
export async function completeTextQuick({ prompt, maxTokens = 1200, signal, requestId } = {}) {
  assertProviderConfigured()
  const providerQueue = getFallbackProviders('auto')
  if (!providerQueue.length) throw textProviderCoolingError()
  let lastError
  const debug = process.env.MOCKMATE_DEBUG_VISION === '1'
  for (const provId of providerQueue) {
    if (signal?.aborted) { const e = new Error('cancelled'); e.name = 'AbortError'; throw e }
    let prov
    try { prov = resolveProvider(provId) } catch { continue }
    const t0 = Date.now()
    try {
      const llm = clientFor(prov)
      const resp = await llm.chat.completions.create({
        model: prov.model, ...completionBudget(prov, maxTokens),
        messages: [{ role: 'user', content: prompt }],
      }, signal ? { signal } : undefined)
      const raw = resp.choices?.[0]?.message?.content
      if (raw) {
        lastWorkingTextProvider = baseOf(provId)
        if (debug) {
          console.info('[vision-repair]', visionTelemetry({
            screenRequestId: requestId, provider: provId, status: 'ok',
            latencyMs: Date.now() - t0, repairAttempt: true, repairType: 'text',
          }))
        }
        return raw
      }
    } catch (e) {
      lastError = e
      const kind = classifyVisionError(e)
      if (kind === 'cancelled') throw e
      if (kind === 'rate') {
        noteTextProviderFailure(provId, e, prov.model)
        // Same API key is rate-limited — cool vision siblings for this repair path only.
        markVision429Family(baseOf(provId))
        continue
      }
      if (kind === 'quota') {
        noteTextProviderFailure(provId, e, prov.model)
        continue
      }
      if (kind === 'auth' || kind === 'bad_request') {
        if (isProviderHardFail(e)) noteTextProviderFailure(provId, e, prov.model)
        continue
      }
      if (isTransient(e)) {
        noteTextProviderFailure(provId, e, prov.model)
        continue
      }
      if (!isRateLimit(e)) throw e
    }
  }
  if (isQuotaExhausted(lastError)) throw aiError('vision_quota', 402)
  if (isRateLimit(lastError)) throw makeVisionRateLimitedError(process.env.MOCKMATE_MANAGED === '1')
  throw lastError || new Error('Could not repair screen-analysis response')
}


// Streaming text completion — emits tokens via onToken as they arrive (true SSE).
// Provider fallback only kicks in BEFORE the first token; once streaming has begun
// we don't restart on another provider (that would duplicate output).
// Two-phase stream deadline. Until the first answer token arrives, `firstTokenMs`
// bounds the wait so failover can still run. Each progress() call after that
// re-arms a shorter inactivity timer instead: the stream is ended only when it
// stalls, never because a healthy answer is long.
function withStreamDeadline(upstreamSignal, { firstTokenMs, stallMs }) {
  const controller = new AbortController()
  let timedOutKind = null   // null | 'first_token' | 'stall'
  let timer = null
  const abortFromUpstream = () => controller.abort(upstreamSignal?.reason)
  if (upstreamSignal?.aborted) abortFromUpstream()
  else upstreamSignal?.addEventListener?.('abort', abortFromUpstream, { once: true })
  const arm = (kind, ms) => {
    clearTimeout(timer)
    timer = setTimeout(() => {
      timedOutKind = kind
      controller.abort(new Error(kind === 'stall' ? 'LLM stream stalled' : 'LLM stream timed out'))
    }, ms)
    timer.unref?.()
  }
  arm('first_token', firstTokenMs)
  return {
    signal: controller.signal,
    timedOut: () => timedOutKind !== null,
    timeoutKind: () => timedOutKind,
    progress: () => { if (!controller.signal.aborted) arm('stall', stallMs) },
    cleanup: () => {
      clearTimeout(timer)
      upstreamSignal?.removeEventListener?.('abort', abortFromUpstream)
    },
  }
}

// Low-latency thinking setting for Claude models served by Anthropic directly.
// Other gateways may not accept the field, so it is only sent to api.anthropic.com.
function claudeThinkingFor(prov) {
  return /^https:\/\/api\.anthropic\.com\//i.test(String(prov?.baseURL || ''))
    ? claudeLowLatencyThinking(prov?.model)
    : null
}

// If Anthropic rejects the thinking setting for a model (for example because a
// future effort default no longer allows it), retry once without the field rather
// than failing the answer. Only a 400 before any output triggers the retry.
// A 400 with a thinking field is not proof that thinking caused the rejection.
export function thinkingRejectionDetails(error) {
  const body = error?.error?.error || error?.error || error?.body || {}
  const text = String(typeof body === 'string' ? body : body.message || error?.message || '')
  const fields = ['thinking', 'budget_tokens', 'output_config.effort', 'max_tokens', 'temperature', 'display', 'block_binding']
    .filter(field => text.includes(field))
  return {
    status: Number(error?.status) || 400,
    rejectedFields: fields,
    rejectionKind: /not supported|unsupported/i.test(text) ? 'unsupported_setting'
      : /extra|unexpected|not permitted/i.test(text) ? 'unexpected_field'
        : /effort/i.test(text) ? 'effort_constraint' : 'unclassified_400',
  }
}
async function createWithThinkingFallback(llm, params, requestOpts, onRejected) {
  try {
    return await llm.chat.completions.create(params, requestOpts)
  } catch (e) {
    if (!params.thinking || Number(e?.status) !== 400 || requestOpts?.signal?.aborted) throw e
    const { thinking: _rejected, ...withoutThinking } = params
    try { onRejected?.(e, thinkingRejectionDetails(e)) } catch {}
    return await llm.chat.completions.create(withoutThinking, requestOpts)
  }
}

export async function streamText({ messages, maxTokens = 700, provider, thinkingTokenFloor = 0, onToken, onUsage, onProviderEvent, signal }) {
  assertProviderConfigured()
  const providerQueue = getFallbackProviders(provider)
  if (!providerQueue.length) throw textProviderCoolingError()
  let lastError, emitted = false, sawQuota = false, sawRate = false, sawTransient = false, retryAfterMs = 0
  const recoveredFamilies = new Set()
  for (let attemptIndex = 0; attemptIndex < providerQueue.length; attemptIndex++) {
    const provId = providerQueue[attemptIndex]
    let prov
    try { prov = resolveProvider(provId) } catch { continue }
    const llm = clientFor(prov), model = prov.model
    const providerStartedAt = Date.now()
    let firstTokenAt = null
    const attemptId = newProviderAttemptId()
    const deadline = withStreamDeadline(signal, {
      firstTokenMs: Number(process.env.LLM_STREAM_TIMEOUT_MS) || LIVE_PROVIDER_ATTEMPT_TIMEOUT_MS,
      stallMs: Number(process.env.LLM_STREAM_STALL_TIMEOUT_MS) || LIVE_STREAM_STALL_TIMEOUT_MS,
    })
    providerDiagnostic('attempt_started', {
      attemptId, operation: 'stream', provider: provId, model, maxTokens: Object.values(completionBudget(prov, maxTokens, thinkingTokenFloor))[0], attemptIndex, contextChars: JSON.stringify(messages).length,
      requestedProvider: provider || 'auto', selectionReason: attemptIndex > 0 ? 'fallback' : (provider && provider !== 'auto' ? 'requested' : 'automatic'),
    })
    try { onProviderEvent?.({ type: 'started', attemptId, attemptIndex, provider: provId, model }) } catch {}
    try {
      const params = { model, ...completionBudget(prov, maxTokens, thinkingTokenFloor), messages, stream: true }
      if (/gemini/i.test(model)) params.reasoning_effort = 'none'
      const claudeThinking = claudeThinkingFor(prov)
      if (claudeThinking) params.thinking = claudeThinking
      // Only OpenAI/Groq reliably support stream usage; gate it so others don't 400.
      const supportsUsage = /openai\.com|groq\.com/.test(prov.baseURL || '')
      if (supportsUsage) params.stream_options = { include_usage: true }
      let usage = null
      // A live interview cannot wait indefinitely for the first answer text. The SDK
      // timeout only covers connecting (it clears once response headers arrive); the
      // first-token deadline below then lets failover run before anything is shown.
      // After the first token only a stall ends the stream (no new text for
      // LIVE_STREAM_STALL_TIMEOUT_MS), so a long, healthy answer is never cut off.
      const requestOpts = { timeout: 9000, signal: deadline.signal }
      const stream = await createWithThinkingFallback(llm, params, requestOpts, (_e, details = {}) => {
        providerDiagnostic('thinking_setting_rejected', { attemptId, operation: 'stream', provider: provId, model, ...details }, 'warn')
      })
      for await (const chunk of stream) {
        if (chunk?.usage) usage = chunk.usage
        const tok = chunk?.choices?.[0]?.delta?.content || ''
        if (tok) { if (!firstTokenAt) firstTokenAt = Date.now(); emitted = true; onToken?.(tok) }
        if (firstTokenAt) deadline.progress()
      }
      lastWorkingTextProvider = baseOf(provId)
      if (usage && onUsage) onUsage({ model, input: usage.prompt_tokens || 0, output: usage.completion_tokens || 0 })
      providerDiagnostic('attempt_succeeded', { attemptId, operation: 'stream', provider: provId, model, durationMs: Date.now() - providerStartedAt, ttftMs: firstTokenAt ? firstTokenAt - providerStartedAt : null, attemptIndex, status: 200, inputTokens: usage?.prompt_tokens ?? null, outputTokens: usage?.completion_tokens ?? null })
      try { onProviderEvent?.({ type: 'succeeded', attemptId, attemptIndex, provider: provId, model, durationMs: Date.now() - providerStartedAt }) } catch {}
      return
    } catch (e) {
      // Client disconnected (question superseded / overlay closed) — stop immediately and
      // do NOT fail over to another provider, which would re-spend tokens on a dead request.
      if (signal?.aborted) {
        providerDiagnostic('attempt_cancelled', { attemptId, operation: 'stream', provider: provId, model, emitted, durationMs: Date.now() - providerStartedAt }, 'warn')
        try { onProviderEvent?.({ type: 'cancelled', attemptId, attemptIndex, provider: provId, emitted }) } catch {}
        throw e
      }
      lastError = e
      if (quarantineModel(provId, model, e) && !emitted) {
        enqueueActiveModelRecovery(providerQueue, attemptIndex, provId, model, e, recoveredFamilies)
      }
      const timedOut = deadline.timedOut() || /timed? ?out|ETIMEDOUT/i.test(e?.message || '')
      if (timedOut && !e?.status) e.status = 504
      providerDiagnostic(timedOut ? 'attempt_timed_out' : 'attempt_failed', { attemptId, operation: 'stream', provider: provId, model, status: e?.status || 0, emitted, timeoutKind: deadline.timeoutKind(), durationMs: Date.now() - providerStartedAt, class: isQuotaExhausted(e) ? 'quota' : isRateLimit(e) ? 'rate_limit' : isTransient(e) ? 'transient' : 'hard_failure' }, 'warn')
      try { onProviderEvent?.({ type: timedOut ? 'timed_out' : 'failed', attemptId, attemptIndex, provider: provId, status: e?.status || 0, emitted }) } catch {}
      if (emitted) {
        // Keep the partial answer visible and never restart this paid generation. Cool the
        // failed provider for a later question and send a classified, actionable error to UI.
        noteTextProviderFailure(provId, e, model)
        throw userFacingPartialStreamError(e)
      }
      // Before any token: same failover classes as completeJSON (rate / transient / hard fail / quota).
      if (!shouldFailoverTextError(e, { emitted: false })) throw e
      if (isQuotaExhausted(e)) { sawQuota = true; noteTextProviderFailure(provId, e, model); console.warn(`[MockMate] ${provId} out of quota → trying next provider`); continue }
      if (isRateLimit(e)) {
        sawRate = true
        const providerWaitMs = Math.max(RATE_LIMIT_BAN_MS, getRetryAfterMs(e))
        retryAfterMs = retryAfterMs > 0 ? Math.min(retryAfterMs, providerWaitMs) : providerWaitMs
        noteTextProviderFailure(provId, e, model)
        console.warn(`[MockMate] ${provId} rate-limited → trying next provider`)
        continue
      }
      if (isTransient(e)) {
        sawTransient = true
        noteTextProviderFailure(provId, e, model)
        console.warn(`[MockMate] ${provId} transient error (${e?.status || ''}) → trying next provider`)
        continue
      }
      if (isProviderHardFail(e)) noteTextProviderFailure(provId, e, model)
      console.error(`[llm] ${provId} (${model}) stream failed (${e?.status || ''}): ${e?.message || e} → trying next provider`)
    } finally {
      deadline.cleanup()
    }
  }
  if (sawQuota || sawRate || sawTransient) {
    throw exhaustedProviderError({ sawQuota, sawRate, sawTransient, retryAfterMs })
  }
  if (isQuotaExhausted(lastError)) throw aiError('quota', 402)
  throw actionableProviderError(lastError)
}

// ── Deepgram (accurate speech-to-text) ──────────────────────────────────────
export function deepgramConfigured() { return !!process.env.DEEPGRAM_API_KEY }

// Mint a short-lived grant token so the browser can stream audio to Deepgram.
// Prefer a short-lived grant. Member / scoped Deepgram keys often 403 on /v1/auth/grant —
// for LOCAL Electron (BYOK :3002 or the local managed fork :4000) we fall back to the
// project API key as the WS token because that key already lives on this machine.
//
// NEVER return the raw key when MOCKMATE_HOSTED=1 (real remote production).
// Local MOCKMATE_MANAGED=1 is fine — it is still this laptop's key, not a multi-tenant leak.
// Opt out anytime with MOCKMATE_DEEPGRAM_KEY_FALLBACK=0.
//
// DEV NOTE: local/BYOK testing reads DEEPGRAM_API_KEY from the encrypted user config or a
// developer .env. Public installers never bundle it. Owner-scoped keys can mint grants; Member keys need
// this fallback. Tighten for production hosted only — do not break local solo testing.
export async function deepgramToken(opts = {}) {
  if (!process.env.DEEPGRAM_API_KEY) { const e = new Error('Deepgram not configured (set DEEPGRAM_API_KEY).'); e.status = 500; throw e }
  const key = process.env.DEEPGRAM_API_KEY
  const r = await fetchWithTimeout('https://api.deepgram.com/v1/auth/grant', {
    method: 'POST',
    headers: { Authorization: `Token ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ttl_seconds: 300 })   // 5 min — long enough to (re)establish the stream on reconnects
  }, 8000)
  if (r.ok) return await r.json()   // { access_token, expires_in }

  const remoteHosted = isHostedDeploy()
  const envAllowsFallback = process.env.MOCKMATE_DEEPGRAM_KEY_FALLBACK !== '0'
    && process.env.MOCKMATE_DEEPGRAM_KEY_FALLBACK !== 'false'
  // Route must opt in (typically after loopback check). Local managed is allowed; remote hosted is not.
  const fallbackAllowed = opts.allowApiKeyFallback === true && !remoteHosted && envAllowsFallback

  if (fallbackAllowed && (r.status === 403 || r.status === 401)) {
    return {
      access_token: key,
      expires_in: 3600,
      fallback: 'api_key',
      warning: 'byok_api_key_fallback',
      localOnly: true,
    }
  }

  const e = new Error(
    r.status === 429
      ? 'Deepgram is rate-limiting token grants. MockMate will retry the connection with backoff; if it continues, wait for the Deepgram reset and check Settings → Voice.'
      : r.status === 402
        ? 'Deepgram reports exhausted transcription usage or credits. Check Deepgram billing and audio-minute allowance in Settings → Voice; this is separate from LLM answer-generation limits.'
        : r.status === 403 || r.status === 401
          ? `Deepgram token grant failed (${r.status}). Use an Owner-scoped API key that can mint grants (Deepgram Console → API Keys), or ensure local key fallback is enabled on this machine.`
          : `Deepgram token grant failed (${r.status}). Check your Deepgram key in Settings → Voice.`
  )
  e.status = r.status
  if (r.status === 429) e.code = 'deepgram_rate_limit'
  else if (r.status === 402) e.code = 'deepgram_quota'
  else if (r.status === 401 || r.status === 403) e.code = 'deepgram_auth'
  const retryAfterMs = getRetryAfterMs({ headers: r.headers })
  if (retryAfterMs > 0) e.retryAfterMs = retryAfterMs
  throw e
}

/** True when the HTTP client is loopback (IPv4 / IPv6 / IPv4-mapped). */
export function isLoopbackAddress(ip) {
  const s = String(ip || '').replace(/^::ffff:/i, '')
  return s === '127.0.0.1' || s === '::1' || s === 'localhost'
}

// ── LiveKit room token — MockMate "Duo" ─────────────────────────────────────
// A shared room where a friend/mentor joins your interview live: shared transcript + screen +
// a PRIVATE AI co-pilot only the candidate sees (see src/Room.jsx). livekit-server-sdk is imported
// LAZILY inside the function so the shared engine still loads when Duo isn't installed/configured —
// Solo & Live must never break because an OPTIONAL feature's package is missing (same lazy pattern
// as the Mongo store). Configure LIVEKIT_URL / LIVEKIT_API_KEY / LIVEKIT_API_SECRET to enable.
export async function mintToken({ room, identity, name, role = 'candidate', requesterId = null } = {}) {
  const { LIVEKIT_API_KEY, LIVEKIT_API_SECRET, LIVEKIT_URL } = process.env
  const roomId = String(room || '').trim()
  const requestedRole = role === 'interviewer' ? 'interviewer' : role === 'candidate' ? 'candidate' : null
  if (!/^mock-[a-f0-9]{32,64}$/i.test(roomId)) { const e = new Error('A valid high-entropy MockMate room code is required'); e.status = 400; throw e }
  if (!requestedRole) { const e = new Error('role must be candidate or interviewer'); e.status = 400; throw e }
  if (!identity && !requesterId) { const e = new Error('identity is required'); e.status = 400; throw e }
  if (!LIVEKIT_API_KEY || !LIVEKIT_API_SECRET || !LIVEKIT_URL) {
    const e = new Error('Duo/rooms are not configured — set LIVEKIT_URL / LIVEKIT_API_KEY / LIVEKIT_API_SECRET.'); e.status = 501; throw e
  }
  let AccessToken
  try { ({ AccessToken } = await import('livekit-server-sdk')) }
  catch { const e = new Error('Duo needs the livekit-server-sdk package — run `npm i livekit-server-sdk`.'); e.status = 501; throw e }
  const localIdentity = String(identity || 'peer').replace(/[^a-z0-9:_-]/gi, '_').slice(0, 96)
  const accountIdentity = requesterId ? ('u_' + String(requesterId).replace(/[^a-z0-9_-]/gi, '').slice(-40) + '_' + requestedRole) : localIdentity
  const metadata = JSON.stringify({ mockmateRole: requestedRole, accountBound: !!requesterId })
  const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, { identity: accountIdentity, name: String(name || accountIdentity).slice(0, 120), metadata, ttl: '2h' })
  at.addGrant({ roomJoin: true, room: roomId, canPublish: true, canSubscribe: true, canPublishData: true })
  return { token: await at.toJwt(), url: LIVEKIT_URL, identity: accountIdentity, role: requestedRole }
}

// ── Embeddings — powers document RAG (chunk → embed → retrieve, see shared/retrieval.js) ─────
// Provider-agnostic, reusing the configured LLM keys: OpenAI text-embedding-3-small (preferred),
// else Gemini gemini-embedding-001. Returns one vector per input string. Cheap; keep the doc index
// on the client and only hit this to embed chunks (once) + each question.
export function resolveEmbeddingProvider() {
  if (process.env.OPENAI_API_KEY) return { key: process.env.OPENAI_API_KEY, baseURL: 'https://api.openai.com/v1', model: process.env.EMBED_MODEL || EMBEDDING_MODELS.openai }
  // text-embedding-004 was retired by Google on 2026-01-14. The stable text replacement is
  // gemini-embedding-001; deployments can opt into gemini-embedding-2 through EMBED_MODEL.
  if (process.env.GEMINI_API_KEY) return { key: process.env.GEMINI_API_KEY, baseURL: CATALOG.gemini.baseURL, model: process.env.EMBED_MODEL || EMBEDDING_MODELS.gemini }
  const e = new Error('Document search needs an OpenAI or Gemini key (for embeddings).'); e.status = 501; throw e
}

export async function embed(input) {
  const list = (Array.isArray(input) ? input : [input]).filter(t => t && String(t).trim())
  if (!list.length) return []
  const candidates = []
  if (process.env.OPENAI_API_KEY) candidates.push({ key: process.env.OPENAI_API_KEY, baseURL: 'https://api.openai.com/v1', model: process.env.OPENAI_EMBED_MODEL || process.env.EMBED_MODEL || EMBEDDING_MODELS.openai })
  if (process.env.GEMINI_API_KEY) candidates.push({ key: process.env.GEMINI_API_KEY, baseURL: CATALOG.gemini.baseURL, model: process.env.GEMINI_EMBED_MODEL || process.env.EMBED_MODEL || EMBEDDING_MODELS.gemini })
  if (!candidates.length) return resolveEmbeddingProvider() // throws the existing actionable 501
  let lastError
  for (const prov of candidates) {
    const llm = clientFor(prov)
    const attemptId = newProviderAttemptId()
    const startedAt = Date.now()
    const provider = /googleapis/i.test(prov.baseURL) ? 'gemini' : 'openai'
    providerDiagnostic('embedding_started', { attemptId, provider, model: prov.model, inputCount: list.length })
    try {
      const r = await llm.embeddings.create({ model: prov.model, input: list.map(t => String(t).slice(0, 8000)) })
      const vectors = r.data.map(d => d.embedding)
      Object.defineProperties(vectors, {
        provider: { value: provider, enumerable: false },
        model: { value: prov.model, enumerable: false },
        embeddingModel: { value: `${provider}:${prov.model}`, enumerable: false },
      })
      providerDiagnostic('embedding_succeeded', { attemptId, provider, model: prov.model, inputCount: list.length, vectorCount: vectors.length, dimensions: vectors[0]?.length || 0, durationMs: Date.now() - startedAt })
      return vectors
    } catch (e) {
      lastError = e
      providerDiagnostic('embedding_failed', { attemptId, provider, model: prov.model, inputCount: list.length, status: e?.status || 0, durationMs: Date.now() - startedAt }, 'warn')
    }
  }
  throw lastError
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
