// Client-side document RAG. Docs live LOCALLY (privacy); server only embeds text.
// Session selection: each doc has `selected` (default true). Live/Solo pass selected IDs into
// retrieveContext so unchecked library docs cannot pollute a new interview.
import { apiFetch } from './apiClient'
import { chunkText, topK, groundingBlock } from '../../shared/retrieval.js'
import { getDocThreshold } from './aiSettings'
import { diagnostic } from './diagnostics'

const KEY = 'mm-docs'
const load = () => {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '[]')
    if (!Array.isArray(raw)) return []
    let dirty = false
    const docs = raw.map(d => {
      if (!d || typeof d !== 'object') return d
      // Heal mis-typed knowledge banks (filename says Knowledge-Bank but type stayed "document").
      if ((d.type === 'document' || !d.type) && inferDocType(d.name) === 'knowledge') {
        dirty = true
        return { ...d, type: 'knowledge' }
      }
      if ((d.type === 'document' || !d.type) && inferDocType(d.name) === 'jd') {
        dirty = true
        return { ...d, type: 'jd' }
      }
      return d
    })
    if (dirty) save(docs)
    return docs
  } catch { return [] }
}

const save = d => { try { localStorage.setItem(KEY, JSON.stringify(d)) } catch {} }

/** Canonical doc types for UI + retrieval policy. */
export const DOC_TYPES = ['resume', 'jd', 'knowledge', 'supporting', 'training', 'document']

export const DOC_TYPE_LABELS = {
  resume: 'Resume',
  jd: 'Job description',
  knowledge: 'Knowledge bank',
  supporting: 'Supporting',
  training: 'Training',
  document: 'Other',
}

/** Map a filename to a stored doc type. Must use 'jd' (not "job description") for upsert. */
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
    id: d.id,
    name: d.name,
    type: d.type,
    addedAt: d.addedAt,
    chars: (d.text || '').length,
    selected: d.selected !== false,
  }
}

// Public metadata (no vectors/text bulk) — for the Documents UI.
export function listDocs() {
  return load().map(toMeta)
}
export function hasDocs() { return load().length > 0 }

/** IDs marked selected for the next interview (default: all). */
export function getSelectedDocIds() {
  return load().filter(d => d.selected !== false).map(d => d.id)
}

export function setDocSelected(id, selected) {
  const docs = load()
  const i = docs.findIndex(d => d.id === id)
  if (i < 0) return null
  docs[i] = { ...docs[i], selected: !!selected }
  save(docs)
  return toMeta(docs[i])
}

export function setDocType(id, type) {
  const docs = load()
  const i = docs.findIndex(d => d.id === id)
  if (i < 0) return null
  const nextType = normalizeDocType(type)
  const prev = docs[i]
  // Moving onto resume/jd upsert slot: drop other of that type to keep single bio source.
  if ((nextType === 'resume' || nextType === 'jd') && prev.type !== nextType) {
    for (let j = docs.length - 1; j >= 0; j--) {
      if (j !== i && docs[j].type === nextType) {
        indexCache.delete(docs[j].id)
        docs.splice(j, 1)
      }
    }
  }
  docs[i] = { ...docs[i], type: nextType }
  save(docs)
  return toMeta(docs[i])
}

// Resume/JD are profile-derived materials: upsert by type so Begin/Start never stacks stale copies.
// Other uploads still append — the user may keep multiple notes/files.
export function addDoc({ name, type = 'document', text, selected = true }) {
  if (!text || !String(text).trim()) return null
  const docs = load()
  const body = String(text)
  const t = normalizeDocType(type)
  const upsert = t === 'resume' || t === 'jd'
  if (upsert) {
    const i = docs.findIndex(d => d.type === t)
    if (i >= 0) {
      const prev = docs[i]
      indexCache.delete(prev.id)
      const doc = {
        ...prev,
        name: name || prev.name || 'Untitled',
        text: body,
        type: t,
        selected: selected !== false,
        addedAt: new Date().toISOString(),
      }
      docs[i] = doc
      save(docs)
      return toMeta(doc)
    }
  }
  const doc = {
    id: 'd' + Math.random().toString(36).slice(2, 9),
    name: name || 'Untitled',
    type: t,
    text: body,
    selected: selected !== false,
    addedAt: new Date().toISOString(),
  }
  docs.push(doc); save(docs)
  return toMeta(doc)
}
export function removeDoc(id) { save(load().filter(d => d.id !== id)); indexCache.delete(id) }

// ── Embedded index (in-memory, rebuilt on change) ──
const indexCache = new Map()   // docId → { sig, chunks:[{text,vector}] }
async function embed(texts) {
  const startedAt = performance.now()
  const inputCount = Array.isArray(texts) ? texts.length : 0
  const r = await apiFetch('/api/embed', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ input: texts }) })
  if (!r.ok) {
    diagnostic('rag', 'embedding_failed', { status: r.status, inputCount, durationMs: Math.round(performance.now() - startedAt) }, 'warn')
    throw new Error(`embed ${r.status}`)
  }
  const vectors = (await r.json()).vectors || []
  diagnostic('rag', 'embedding_completed', {
    inputCount, vectorCount: vectors.length, dimensions: vectors[0]?.length || 0,
    durationMs: Math.round(performance.now() - startedAt),
  })
  return vectors
}

export function warmDocs(docIds) {
  const docs = filterDocs(load(), { docIds })
  if (docs.length) ensureIndexed(docs).catch(() => {})
}

function filterDocs(docs, { docIds, types } = {}) {
  let out = docs
  if (Array.isArray(docIds)) {
    const allow = new Set(docIds.map(String))
    out = out.filter(d => allow.has(String(d.id)))
  }
  if (Array.isArray(types) && types.length) {
    const allowT = new Set(types.map(normalizeDocType))
    const typed = out.filter(d => allowT.has(normalizeDocType(d.type)))
    // Soft: type filter must not wipe the user's selected library to empty.
    if (typed.length) out = typed
  }
  return out
}

async function ensureIndexed(docs) {
  const all = []
  for (const doc of docs) {
    const t = doc.text
    const mid = Math.max(0, Math.floor(t.length / 2) - 24)
    const sig = `${t.length}:${t.slice(0, 48)}:${t.slice(mid, mid + 48)}:${t.slice(-48)}`
    let entry = indexCache.get(doc.id)
    if (!entry || entry.sig !== sig) {
      const chunks = chunkText(doc.text, { size: 600, overlap: 100 }).slice(0, 40)
      const vectors = chunks.length ? await embed(chunks) : []
      entry = { sig, chunks: chunks.map((text, i) => ({ text, vector: vectors[i] || [] })) }
      indexCache.set(doc.id, entry)
    }
    for (const c of entry.chunks) {
      if (c.vector?.length) {
        all.push({
          text: c.text,
          vector: c.vector,
          doc: doc.name,
          type: normalizeDocType(doc.type),
          docId: doc.id,
        })
      }
    }
  }
  return all
}

/**
 * Retrieve a grounding block for `question`, or '' if none / slow / unavailable.
 * @param {object} [opts]
 * @param {string[]} [opts.docIds] — only these docs (session selection). Empty array → no retrieval.
 * @param {string[]} [opts.types] — optional type filter (Live soft policy omits this; selection is the gate).
 */
export async function retrieveContext(question, { k = 4, minScore, budgetMs = 2000, docIds, types } = {}) {
  if (!question || !String(question).trim()) return ''
  // Explicit empty selection = user unchecked everything — do not fall back to all docs.
  if (Array.isArray(docIds) && docIds.length === 0) return ''
  const docs = filterDocs(load(), { docIds, types })
  if (!docs.length) return ''
  const threshold = typeof minScore === 'number' ? minScore : getDocThreshold()
  const startedAt = performance.now()
  let deadlineExceeded = false
  diagnostic('rag', 'retrieval_started', { documentCount: docs.length, requestedK: k, threshold, budgetMs })
  const work = (async () => {
    const items = await ensureIndexed(docs)
    if (!items.length) {
      diagnostic('rag', deadlineExceeded ? 'retrieval_completed_after_timeout' : 'retrieval_completed', { documentCount: docs.length, indexedChunkCount: 0, hitCount: 0, durationMs: Math.round(performance.now() - startedAt) })
      return ''
    }
    const [qv] = await embed([question])
    if (!qv?.length) {
      diagnostic('rag', deadlineExceeded ? 'retrieval_completed_after_timeout' : 'retrieval_completed', { documentCount: docs.length, indexedChunkCount: items.length, hitCount: 0, durationMs: Math.round(performance.now() - startedAt) })
      return ''
    }
    let chunks = topK(qv, items, { k, minScore: threshold })
    // Soft: if threshold empties the pack, keep the best 1–2 chunks rather than silence.
    if (!chunks.length) chunks = topK(qv, items, { k: Math.min(2, k), minScore: 0 })
    diagnostic('rag', deadlineExceeded ? 'retrieval_completed_after_timeout' : 'retrieval_completed', {
      documentCount: docs.length, indexedChunkCount: items.length, hitCount: chunks.length,
      maxScore: chunks.length ? Number(Math.max(...chunks.map(c => c.score)).toFixed(3)) : 0,
      minScore: chunks.length ? Number(Math.min(...chunks.map(c => c.score)).toFixed(3)) : 0,
      durationMs: Math.round(performance.now() - startedAt),
    })
    return groundingBlock(chunks)
  })().catch(e => {
    diagnostic('rag', deadlineExceeded ? 'retrieval_failed_after_timeout' : 'retrieval_failed', { reason: e?.name || 'error', durationMs: Math.round(performance.now() - startedAt) }, 'warn')
    return ''
  })
  let timeoutId
  const timeout = new Promise(res => { timeoutId = setTimeout(() => {
    deadlineExceeded = true
    diagnostic('rag', 'retrieval_timed_out', { documentCount: docs.length, budgetMs, durationMs: Math.round(performance.now() - startedAt) }, 'warn')
    res('')
  }, budgetMs) })
  const result = await Promise.race([work, timeout])
  clearTimeout(timeoutId)
  return result
}

/** Pure helper for tests — filter without I/O. */
export function filterDocsForRetrieve(docs, opts) {
  return filterDocs(docs, opts)
}
