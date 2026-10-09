// Client-side document RAG. Docs live LOCALLY (privacy); server only embeds text.
// Session selection: each doc has `selected` (default true). Live/Solo pass selected IDs into
// retrieveContext so unchecked library docs cannot pollute a new interview.
import { apiFetch } from './apiClient'
import { chunkText, topK, lexicalTopK, groundingBlock } from '../../shared/retrieval.js'
import { getDocThreshold } from './aiSettings'
import { diagnostic } from './diagnostics'
import { activeAccountScope, getScopedItem, setScopedItem } from './accountScope'

const KEY = 'mm-docs'
const INDEX_STORAGE_KEY = 'mm-docs-index-v1'
export const MAX_INDEX_CHUNKS_PER_DOC = 40
export const LONG_DOC_CHARS = 20000

export function sampleChunksForIndex(chunks, max = MAX_INDEX_CHUNKS_PER_DOC) {
  if (!Array.isArray(chunks) || chunks.length <= max) return Array.isArray(chunks) ? chunks : []
  if (max <= 1) return chunks.slice(0, Math.max(0, max))
  return Array.from({ length: max }, (_, i) => chunks[Math.round(i * (chunks.length - 1) / (max - 1))])
}

const save = d => {
  try { return setScopedItem(KEY, JSON.stringify(d)) }
  catch { return false }
}

const load = () => {
  ensureCurrentScope()
  try {
    const raw = JSON.parse(getScopedItem(KEY, '[]') || '[]')
    if (!Array.isArray(raw)) return []
    let dirty = false
    const docs = raw.map(d => {
      if (!d || typeof d !== 'object') return d
      if ((d.type === 'document' || !d.type) && inferDocType(d.name) === 'knowledge') { dirty = true; return { ...d, type: 'knowledge' } }
      if ((d.type === 'document' || !d.type) && inferDocType(d.name) === 'jd') { dirty = true; return { ...d, type: 'jd' } }
      return d
    }).filter(Boolean)
    if (dirty) save(docs)
    return docs
  } catch { return [] }
}

export const DOC_TYPES = ['resume', 'jd', 'knowledge', 'supporting', 'training', 'document']
export const DOC_TYPE_LABELS = {
  resume: 'Resume', jd: 'Job description', knowledge: 'Knowledge bank',
  supporting: 'Supporting', training: 'Training', document: 'Other',
}

export function inferDocType(name = '') {
  const n = String(name).toLowerCase()
  if (/resume|cv/.test(n)) return 'resume'
  if (/job|jd|descrip/.test(n)) return 'jd'
  if (/knowledge|knowledge[-_ ]?bank|\bkb\b|architecture|runbook|wiki|assignment/.test(n)) return 'knowledge'
  if (/train(ing)?|course|prep|study/.test(n)) return 'training'
  if (/support|supplement|extra|\bnotes?\b/.test(n)) return 'supporting'
  return 'document'
}
export function normalizeDocType(type) {
  const t = String(type || 'document').toLowerCase()
  return DOC_TYPES.includes(t) ? t : 'document'
}
function toMeta(d) {
  return {
    id: d.id, name: d.name, type: d.type, source: d.source || 'local', addedAt: d.addedAt,
    chars: (d.text || '').length,
    retrievalCoverage: (d.text || '').length > LONG_DOC_CHARS ? 'representative' : 'full',
    selected: d.selected !== false,
  }
}

export function listDocs() { return load().map(toMeta) }
export function getSelectedDocIds() { return load().filter(d => d.selected !== false).map(d => d.id) }

export function setDocSelected(id, selected) {
  const docs = load(); const i = docs.findIndex(d => d.id === id)
  if (i < 0) return null
  docs[i] = { ...docs[i], selected: !!selected }
  return save(docs) ? toMeta(docs[i]) : null
}

export function setDocType(id, type) {
  const docs = load(); const i = docs.findIndex(d => d.id === id)
  if (i < 0) return null
  docs[i] = { ...docs[i], type: normalizeDocType(type) }
  invalidateDocIndex(id)
  return save(docs) ? toMeta(docs[i]) : null
}

function inferredSource(name, source) {
  if (source) return source
  return /\(pasted\)/i.test(String(name || '')) ? 'profile' : 'upload'
}

export function addDoc({ name, type = 'document', text, selected = true, source } = {}) {
  if (!text || !String(text).trim()) return null
  const docs = load(); const body = String(text); const t = normalizeDocType(type); const src = inferredSource(name, source)
  const upsert = t === 'resume' || t === 'jd'
  if (upsert) {
    const profileIndex = docs.findIndex(d => d.type === t && (d.source || inferredSource(d.name)) === 'profile')
    const uploadedIndex = docs.findIndex(d => d.type === t && (d.source || inferredSource(d.name)) !== 'profile')
    const i = src === 'profile' ? profileIndex : (uploadedIndex >= 0 ? uploadedIndex : profileIndex)
    if (src === 'profile' && uploadedIndex >= 0 && profileIndex < 0) return toMeta(docs[uploadedIndex])
    if (i >= 0) {
      const prev = docs[i]
      if (src === 'profile' && (prev.source || inferredSource(prev.name)) !== 'profile') return toMeta(prev)
      // Replacing a resume/JD invalidates the OLD persisted vectors too (privacy),
      // including any in-flight indexing task for the old text (same doc id is reused).
      invalidateDocIndex(prev.id)
      const doc = { ...prev, name: name || prev.name || 'Untitled', text: body, type: t, source: src, selected: selected !== false, addedAt: new Date().toISOString() }
      docs[i] = doc
      return save(docs) ? toMeta(doc) : null
    }
  }
  const doc = { id: `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`, name: name || 'Untitled', type: t, text: body, source: src, selected: selected !== false, addedAt: new Date().toISOString() }
  docs.push(doc)
  return save(docs) ? toMeta(doc) : null
}

export function removeDoc(id) {
  const ok = save(load().filter(d => d.id !== id))
  if (ok) {
    // Privacy (blast-radius review fix): the persisted vector cache stores the
    // ORIGINAL chunk text; deleting the visible document must also delete its
    // persisted index entry — and invalidate any in-flight indexing task so a
    // still-running embed cannot resurrect the deleted text after we purge it.
    invalidateDocIndex(id)
  }
  return ok
}

export function documentSignature(text = '') {
  const s = String(text)
  let a = 2166136261, b = 2246822519
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    a ^= c; a = Math.imul(a, 16777619) >>> 0
    b ^= c + i; b = Math.imul(b, 3266489917) >>> 0
  }
  return `${s.length}:${a.toString(36)}:${b.toString(36)}`
}

const indexCache = new Map()
const indexInFlight = new Map()
// Privacy race guard (blast-radius review round 4): deleting/replacing a document
// cannot cancel a promise that is already awaiting /api/embed. A generation counter
// (bumped on every invalidation) plus per-task AbortControllers let stale tasks
// detect that they are obsolete and refuse to persist removed private text.
const indexGeneration = new Map()
const indexAbort = new Map()

// The underlying account-scoped localStorage is isolated, but these in-memory
// maps used to be keyed by document ID alone and survived account switching.
// A delayed /api/embed could also finish after sign-out and write a previous
// account's chunk text into the newly active account's vector-cache key.
let cacheAccountScope = activeAccountScope()
let cacheScopeEpoch = 0

function ensureCurrentScope() {
  const currentScope = activeAccountScope()
  if (currentScope !== cacheAccountScope) {
    cacheAccountScope = currentScope
    cacheScopeEpoch += 1
    for (const controller of indexAbort.values()) {
      try { controller.abort(new DOMException('Account switched during embedding', 'AbortError')) } catch {}
    }
    indexAbort.clear()
    indexCache.clear()
    indexInFlight.clear()
    indexGeneration.clear()
  }
  return { scope: cacheAccountScope, epoch: cacheScopeEpoch }
}

function assertCurrentScope(expected) {
  const current = ensureCurrentScope()
  if (expected.scope !== current.scope || expected.epoch !== current.epoch) {
    throw new DOMException('Account changed while document retrieval was running', 'AbortError')
  }
}

function invalidateDocIndex(id) {
  ensureCurrentScope()
  indexGeneration.set(id, (indexGeneration.get(id) || 0) + 1)
  const ctrl = indexAbort.get(id)
  if (ctrl) {
    try { ctrl.abort(new DOMException('Document index invalidated', 'AbortError')) } catch {}
    indexAbort.delete(id)
  }
  indexCache.delete(id)
  indexInFlight.delete(id)
  removePersistedIndexEntry(id)
}

function resolvePayloadEmbeddingModel(payload = {}) {
  if (payload?.embeddingModel) return String(payload.embeddingModel)
  if (payload?.provider && payload?.model) return `${payload.provider}:${payload.model}`
  if (payload?.model) return String(payload.model)
  return 'default'
}

function loadPersistedIndexEntry(docId, sig, expectedEmbeddingModel = null) {
  try {
    const raw = JSON.parse(getScopedItem(INDEX_STORAGE_KEY, '{}') || '{}')
    const entry = raw?.[docId]
    if (
      entry &&
      entry.sig === sig &&
      Array.isArray(entry.chunks) &&
      entry.dimensions > 0 &&
      entry.embeddingModel &&
      (!expectedEmbeddingModel || entry.embeddingModel === expectedEmbeddingModel)
    ) {
      return entry
    }
  } catch {}
  return null
}

function removePersistedIndexEntry(docId) {
  try {
    const raw = JSON.parse(getScopedItem(INDEX_STORAGE_KEY, '{}') || '{}')
    if (!(docId in raw)) return
    delete raw[docId]
    setScopedItem(INDEX_STORAGE_KEY, JSON.stringify(raw))
  } catch {}
}

// localStorage quotas are byte-based, not document-count-based; entries embed full
// chunk text + dense float vectors, so enforce an approximate serialized budget.
const PERSISTED_INDEX_BYTE_BUDGET = 4_000_000

function persistIndexEntry(docId, entry) {
  try {
    const raw = JSON.parse(getScopedItem(INDEX_STORAGE_KEY, '{}') || '{}')
    const keys = Object.keys(raw)
    if (keys.length > 24) delete raw[keys[0]]
    raw[docId] = entry
    let serialized = JSON.stringify(raw)
    const orderedKeys = Object.keys(raw)
    // Evict oldest entries until under budget (never evict the one just written).
    let i = 0
    while (serialized.length > PERSISTED_INDEX_BYTE_BUDGET && i < orderedKeys.length - 1) {
      if (orderedKeys[i] !== docId) delete raw[orderedKeys[i]]
      i += 1
      serialized = JSON.stringify(raw)
    }
    const persistedOk = setScopedItem(INDEX_STORAGE_KEY, serialized)
    if (!persistedOk) {
      // setScopedItem swallows storage errors and returns false — check the flag,
      // not an exception, so quota failures are never silent.
      console.warn('[docs] persisted vector cache write failed (storage quota or unavailable); continuing in-memory only')
      diagnostic('rag', 'persisted_cache_write_failed', { docId, bytes: serialized.length }, 'warn')
    }
  } catch {}
}

function buildLexicalItems(docs) {
  const out = []
  for (const doc of docs) {
    const chunks = sampleChunksForIndex(chunkText(doc.text, { size: 600, overlap: 100 }))
    for (const text of chunks) {
      out.push({ text, doc: doc.name, type: normalizeDocType(doc.type), docId: doc.id })
    }
  }
  return out
}

async function embed(texts, signal) {
  const startedAt = performance.now(); const inputCount = Array.isArray(texts) ? texts.length : 0
  const r = await apiFetch('/api/embed', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ input: texts }), signal,
  })
  if (!r.ok) {
    diagnostic('rag', 'embedding_failed', { status: r.status, inputCount, durationMs: Math.round(performance.now() - startedAt) }, 'warn')
    throw new Error(`embed ${r.status}`)
  }
  const payload = await r.json(); const vectors = payload.vectors || []
  const embeddingModel = resolvePayloadEmbeddingModel(payload)
  Object.defineProperty(vectors, 'embeddingModel', { value: embeddingModel, enumerable: false })
  diagnostic('rag', 'embedding_completed', { inputCount, vectorCount: vectors.length, dimensions: vectors[0]?.length || 0, embeddingModel, durationMs: Math.round(performance.now() - startedAt) })
  return vectors
}

export function warmDocs(docIds) {
  ensureCurrentScope()
  const docs = filterDocs(load(), { docIds })
  if (docs.length) ensureIndexed(docs).catch(() => {})
}
function filterDocs(docs, { docIds, types } = {}) {
  let out = docs
  if (Array.isArray(docIds)) { const allow = new Set(docIds.map(String)); out = out.filter(d => allow.has(String(d.id))) }
  if (Array.isArray(types) && types.length) { const allowT = new Set(types.map(normalizeDocType)); out = out.filter(d => allowT.has(normalizeDocType(d.type))) }
  return out
}

async function indexOne(doc, signal, force = false, expectedEmbeddingModel = null) {
  const origin = ensureCurrentScope()
  const sig = documentSignature(doc.text)
  const cached = indexCache.get(doc.id)
  if (
    !force &&
    cached?.sig === sig &&
    cached?.embeddingModel &&
    (!expectedEmbeddingModel || cached.embeddingModel === expectedEmbeddingModel)
  ) {
    return cached
  }
  if (!force) {
    const persisted = loadPersistedIndexEntry(doc.id, sig, expectedEmbeddingModel)
    if (persisted) {
      indexCache.set(doc.id, persisted)
      return persisted
    }
  }
  const existing = indexInFlight.get(doc.id)
  if (!force && existing) return existing
  const generationAtStart = indexGeneration.get(doc.id) || 0
  const ctrl = new AbortController()
  const superseded = indexAbort.get(doc.id)
  if (superseded) {
    try { superseded.abort(new DOMException('Superseded by a newer index task', 'AbortError')) } catch {}
  }
  indexAbort.set(doc.id, ctrl)
  const onExternalAbort = () => ctrl.abort(signal?.reason || new DOMException('Aborted', 'AbortError'))
  if (signal) {
    if (signal.aborted) ctrl.abort(signal.reason || new DOMException('Aborted', 'AbortError'))
    else signal.addEventListener('abort', onExternalAbort, { once: true })
  }
  const task = (async () => {
    try {
      const allChunks = chunkText(doc.text, { size: 600, overlap: 100 })
      const chunks = sampleChunksForIndex(allChunks)
      const vectors = chunks.length ? await embed(chunks, ctrl.signal) : []
      if (ctrl.signal.aborted) throw ctrl.signal.reason || new DOMException('Aborted', 'AbortError')
      assertCurrentScope(origin)
      // Stale-task guards: the document may have been deleted, replaced, or
      // account-purged while the embed request was in flight. Never write
      // removed/private text back into the cache or storage in that case.
      if ((indexGeneration.get(doc.id) || 0) !== generationAtStart) {
        throw new DOMException('Index invalidated while embedding was in flight', 'AbortError')
      }
      const current = load().find(d => d.id === doc.id)
      if (!current || documentSignature(current.text) !== sig) {
        throw new DOMException('Document removed or changed during indexing', 'AbortError')
      }
      const embeddingModel = vectors?.embeddingModel || expectedEmbeddingModel || 'default'
      const entry = {
        sig,
        dimensions: vectors[0]?.length || 0,
        embeddingModel,
        chunks: chunks.map((text, i) => ({ text, vector: vectors[i] || [] })),
      }
      assertCurrentScope(origin)
      indexCache.set(doc.id, entry)
      persistIndexEntry(doc.id, entry)
      return entry
    } finally {
      if (signal) signal.removeEventListener('abort', onExternalAbort)
      if (indexAbort.get(doc.id) === ctrl) indexAbort.delete(doc.id)
    }
  })().finally(() => { if (indexInFlight.get(doc.id) === task) indexInFlight.delete(doc.id) })
  indexInFlight.set(doc.id, task)
  return task
}

async function ensureIndexed(docs, { signal, force = false, expectedEmbeddingModel = null } = {}) {
  const all = []
  for (const doc of docs) {
    if (signal?.aborted) throw signal.reason || new DOMException('Aborted', 'AbortError')
    const entry = await indexOne(doc, signal, force, expectedEmbeddingModel)
    for (const c of entry.chunks) {
      if (c.vector?.length) {
        all.push({
          text: c.text,
          vector: c.vector,
          dimensions: entry.dimensions,
          embeddingModel: entry.embeddingModel || 'default',
          doc: doc.name,
          type: normalizeDocType(doc.type),
          docId: doc.id,
        })
      }
    }
  }
  return all
}

const SPEC_STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'your', 'you', 'are', 'was', 'were',
  'what', 'how', 'why', 'when', 'where', 'who', 'which', 'can', 'could', 'would', 'should',
  'tell', 'about', 'explain', 'describe', 'walk', 'through', 'have', 'has', 'had', 'into', 'please',
  'did', 'does', 'in', 'on', 'at', 'to', 'of', 'by', 'as', 'is', 'it', 'or', 'be', 'do', 'an', 'so',
])

function significantWords(text = '') {
  return String(text || '')
    .toLowerCase()
    .match(/[a-z0-9+#._-]{2,}/g)
    ?.filter(w => !SPEC_STOP_WORDS.has(w)) || []
}

/**
 * Determine whether a speculative RAG result pre-warmed for `specQuery` can be reused
 * for `committedQuery` without issuing a second `/api/embed` request.
 */
export function canReuseSpeculativeRag(specQuery = '', committedQuery = '') {
  const a = String(specQuery || '').trim().toLowerCase().replace(/[?.!,;:]+$/g, '')
  const b = String(committedQuery || '').trim().toLowerCase().replace(/[?.!,;:]+$/g, '')
  if (!a || !b) return false
  if (a === b) return true
  const wordsA = significantWords(a)
  const wordsB = significantWords(b)
  if (wordsA.length < 2 || wordsB.length < 2) return false
  const setA = new Set(wordsA)
  const overlap = wordsB.filter(w => setA.has(w)).length
  if (b.startsWith(a) && wordsB.length - wordsA.length <= 3) return true
  return overlap / wordsB.length >= 0.7
}

export async function retrieveContext(question, { k = 4, minScore, budgetMs = 2000, docIds, types, signal: externalSignal } = {}) {
  const origin = ensureCurrentScope()
  if (!question || !String(question).trim()) return ''
  if (externalSignal?.aborted) return ''
  if (Array.isArray(docIds) && docIds.length === 0) return ''
  const docs = filterDocs(load(), { docIds, types }); if (!docs.length) return ''
  const threshold = typeof minScore === 'number' ? minScore : getDocThreshold()
  const startedAt = performance.now(); const ac = new AbortController(); let timeoutId
  const onExternalAbort = () => {
    clearTimeout(timeoutId)
    ac.abort(externalSignal?.reason || new DOMException('Speculative RAG cancelled', 'AbortError'))
  }
  if (externalSignal) externalSignal.addEventListener('abort', onExternalAbort, { once: true })
  diagnostic('rag', 'retrieval_started', { documentCount: docs.length, requestedK: k, threshold, budgetMs })
  const timeout = new Promise(resolve => { timeoutId = setTimeout(() => { ac.abort(new DOMException('RAG deadline exceeded', 'AbortError')); diagnostic('rag', 'retrieval_timed_out', { documentCount: docs.length, budgetMs, durationMs: Math.round(performance.now() - startedAt) }, 'warn'); resolve('') }, budgetMs) })
  const work = (async () => {
    const qvList = await embed([question], ac.signal)
    assertCurrentScope(origin)
    const [qv] = qvList || []
    const queryEmbeddingModel = qvList?.embeddingModel || 'default'
    if (!qv?.length || externalSignal?.aborted) return ''
    let items = await ensureIndexed(docs, { signal: ac.signal, expectedEmbeddingModel: queryEmbeddingModel })
    assertCurrentScope(origin)
    if (items.some(item => item.vector?.length && (item.vector.length !== qv.length || item.embeddingModel !== queryEmbeddingModel))) {
      for (const doc of docs) indexCache.delete(doc.id)
      items = await ensureIndexed(docs, { signal: ac.signal, force: true, expectedEmbeddingModel: queryEmbeddingModel })
      assertCurrentScope(origin)
    }
    if (!items.length || items.some(item => item.vector?.length && (item.vector.length !== qv.length || item.embeddingModel !== queryEmbeddingModel))) {
      diagnostic('rag', 'retrieval_dimension_mismatch', { queryDimensions: qv.length, queryEmbeddingModel, documentCount: docs.length }, 'warn')
      return ''
    }
    const chunks = topK(qv, items, { k, minScore: threshold, queryText: question })
    diagnostic('rag', 'retrieval_completed', { documentCount: docs.length, indexedChunkCount: items.length, hitCount: chunks.length, maxScore: chunks.length ? Number(Math.max(...chunks.map(c => c.score)).toFixed(3)) : 0, minScore: chunks.length ? Number(Math.min(...chunks.map(c => c.score)).toFixed(3)) : 0, durationMs: Math.round(performance.now() - startedAt) })
    return groundingBlock(chunks)
  })().catch(e => {
    if (externalSignal?.aborted || activeAccountScope() !== origin.scope) return ''
    if (e?.name !== 'AbortError') diagnostic('rag', 'retrieval_failed', { reason: e?.name || 'error', durationMs: Math.round(performance.now() - startedAt) }, 'warn')
    const lexicalHits = lexicalTopK(question, buildLexicalItems(docs), { k, minScore: Math.max(0.28, threshold) })
    return groundingBlock(lexicalHits)
  })
  const result = await Promise.race([work, timeout])
  clearTimeout(timeoutId)
  if (activeAccountScope() !== origin.scope) {
    ac.abort(new DOMException('Account changed during retrieval', 'AbortError'))
    return ''
  }
  if (externalSignal) externalSignal.removeEventListener('abort', onExternalAbort)
  if (externalSignal?.aborted) return ''
  if (result) return result
  // If embedding timed out, fall back to instant lexical retrieval so live answers still stay grounded.
  if (ac.signal.aborted) {
    const lexicalHits = lexicalTopK(question, buildLexicalItems(docs), { k, minScore: Math.max(0.28, threshold) })
    if (lexicalHits.length) return groundingBlock(lexicalHits)
  }
  return result
}

export function filterDocsForRetrieve(docs, opts) { return filterDocs(docs, opts) }
