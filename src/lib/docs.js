// Client-side document RAG. Docs live LOCALLY (privacy); server only embeds text.
// Session selection: each doc has `selected` (default true). Live/Solo pass selected IDs into
// retrieveContext so unchecked library docs cannot pollute a new interview.
import { apiFetch } from './apiClient'
import { chunkText, topK, groundingBlock } from '../../shared/retrieval.js'
import { getDocThreshold } from './aiSettings'
import { diagnostic } from './diagnostics'

const KEY = 'mm-docs'
export const MAX_INDEX_CHUNKS_PER_DOC = 40
export const LONG_DOC_CHARS = 20000

export function sampleChunksForIndex(chunks, max = MAX_INDEX_CHUNKS_PER_DOC) {
  if (!Array.isArray(chunks) || chunks.length <= max) return Array.isArray(chunks) ? chunks : []
  if (max <= 1) return chunks.slice(0, Math.max(0, max))
  return Array.from({ length: max }, (_, i) => chunks[Math.round(i * (chunks.length - 1) / (max - 1))])
}

const save = d => {
  try { localStorage.setItem(KEY, JSON.stringify(d)); return true }
  catch { return false }
}

const load = () => {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '[]')
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
export function hasDocs() { return load().length > 0 }
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
  // Reclassification must never silently delete another resume/JD. Multiple versions are allowed;
  // callers can explicitly remove the old one after reviewing both.
  docs[i] = { ...docs[i], type: normalizeDocType(type) }
  indexCache.delete(id)
  return save(docs) ? toMeta(docs[i]) : null
}

function inferredSource(name, source) {
  if (source) return source
  return /\(pasted\)/i.test(String(name || '')) ? 'profile' : 'upload'
}

// Resume/JD profile sync is intentionally conservative: it may update a previous profile-derived
// entry, but it never overwrites a separately uploaded resume/JD. This prevents Start from replacing
// a newer library file with stale profile text.
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
      indexCache.delete(prev.id)
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
  if (ok) { indexCache.delete(id); indexInFlight.delete(id) }
  return ok
}

// Full-content rolling hash. Unlike the previous length + three-sample signature, any edit anywhere
// in a document invalidates its vector cache.
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

const indexCache = new Map()   // docId → { sig, dimensions, chunks:[{text,vector}] }
const indexInFlight = new Map() // docId → Promise, avoids duplicate embedding spend on concurrent warm/retrieve

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
  diagnostic('rag', 'embedding_completed', { inputCount, vectorCount: vectors.length, dimensions: vectors[0]?.length || 0, durationMs: Math.round(performance.now() - startedAt) })
  return vectors
}

export function warmDocs(docIds) {
  const docs = filterDocs(load(), { docIds })
  if (docs.length) ensureIndexed(docs).catch(() => {})
}
function filterDocs(docs, { docIds, types } = {}) {
  let out = docs
  if (Array.isArray(docIds)) { const allow = new Set(docIds.map(String)); out = out.filter(d => allow.has(String(d.id))) }
  if (Array.isArray(types) && types.length) { const allowT = new Set(types.map(normalizeDocType)); out = out.filter(d => allowT.has(normalizeDocType(d.type))) }
  return out
}

async function indexOne(doc, signal, force = false) {
  const sig = documentSignature(doc.text)
  const cached = indexCache.get(doc.id)
  if (!force && cached?.sig === sig) return cached
  const existing = indexInFlight.get(doc.id)
  if (!force && existing) return existing
  const task = (async () => {
    const allChunks = chunkText(doc.text, { size: 600, overlap: 100 })
    const chunks = sampleChunksForIndex(allChunks)
    const vectors = chunks.length ? await embed(chunks, signal) : []
    if (signal?.aborted) throw signal.reason || new DOMException('Aborted', 'AbortError')
    const entry = { sig, dimensions: vectors[0]?.length || 0, chunks: chunks.map((text, i) => ({ text, vector: vectors[i] || [] })) }
    indexCache.set(doc.id, entry)
    return entry
  })().finally(() => { if (indexInFlight.get(doc.id) === task) indexInFlight.delete(doc.id) })
  indexInFlight.set(doc.id, task)
  return task
}

async function ensureIndexed(docs, { signal, force = false } = {}) {
  const all = []
  for (const doc of docs) {
    if (signal?.aborted) throw signal.reason || new DOMException('Aborted', 'AbortError')
    const entry = await indexOne(doc, signal, force)
    for (const c of entry.chunks) if (c.vector?.length) all.push({ text: c.text, vector: c.vector, dimensions: entry.dimensions, doc: doc.name, type: normalizeDocType(doc.type), docId: doc.id })
  }
  return all
}

export async function retrieveContext(question, { k = 4, minScore, budgetMs = 2000, docIds, types } = {}) {
  if (!question || !String(question).trim()) return ''
  if (Array.isArray(docIds) && docIds.length === 0) return ''
  const docs = filterDocs(load(), { docIds, types }); if (!docs.length) return ''
  const threshold = typeof minScore === 'number' ? minScore : getDocThreshold()
  const startedAt = performance.now(); const ac = new AbortController(); let timeoutId
  diagnostic('rag', 'retrieval_started', { documentCount: docs.length, requestedK: k, threshold, budgetMs })
  const timeout = new Promise(resolve => { timeoutId = setTimeout(() => { ac.abort(new DOMException('RAG deadline exceeded', 'AbortError')); diagnostic('rag', 'retrieval_timed_out', { documentCount: docs.length, budgetMs, durationMs: Math.round(performance.now() - startedAt) }, 'warn'); resolve('') }, budgetMs) })
  const work = (async () => {
    // Embed the query first; if an old cache has another vector dimension, rebuild it once before scoring.
    const [qv] = await embed([question], ac.signal)
    if (!qv?.length) return ''
    let items = await ensureIndexed(docs, { signal: ac.signal })
    if (items.some(item => item.vector?.length && item.vector.length !== qv.length)) {
      for (const doc of docs) indexCache.delete(doc.id)
      items = await ensureIndexed(docs, { signal: ac.signal, force: true })
    }
    if (!items.length || items.some(item => item.vector?.length && item.vector.length !== qv.length)) {
      diagnostic('rag', 'retrieval_dimension_mismatch', { queryDimensions: qv.length, documentCount: docs.length }, 'warn')
      return ''
    }
    const chunks = topK(qv, items, { k, minScore: threshold })
    diagnostic('rag', 'retrieval_completed', { documentCount: docs.length, indexedChunkCount: items.length, hitCount: chunks.length, maxScore: chunks.length ? Number(Math.max(...chunks.map(c => c.score)).toFixed(3)) : 0, minScore: chunks.length ? Number(Math.min(...chunks.map(c => c.score)).toFixed(3)) : 0, durationMs: Math.round(performance.now() - startedAt) })
    return groundingBlock(chunks)
  })().catch(e => {
    if (e?.name !== 'AbortError') diagnostic('rag', 'retrieval_failed', { reason: e?.name || 'error', durationMs: Math.round(performance.now() - startedAt) }, 'warn')
    return ''
  })
  const result = await Promise.race([work, timeout])
  clearTimeout(timeoutId)
  return result
}

export function filterDocsForRetrieve(docs, opts) { return filterDocs(docs, opts) }
