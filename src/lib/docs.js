// Client-side document RAG. Docs (resume, JD, extras) live LOCALLY (privacy — never persisted
// server-side); the server only embeds text. We store just the doc TEXT in localStorage (small),
// embed chunks lazily into an in-memory index (once per session / on change), and per question
// retrieve the top-K relevant chunks to ground the answer — replacing the old truncated-resume stuff.
import { apiFetch } from './apiClient'
import { chunkText, topK, groundingBlock } from '../../shared/retrieval.js'
import { getDocThreshold } from './aiSettings'

const KEY = 'mm-docs'
const load = () => { try { return JSON.parse(localStorage.getItem(KEY) || '[]') } catch { return [] } }
const save = d => { try { localStorage.setItem(KEY, JSON.stringify(d)) } catch {} }

// Public metadata (no vectors/text bulk) — for the Documents UI.
export function listDocs() {
  return load().map(d => ({ id: d.id, name: d.name, type: d.type, addedAt: d.addedAt, chars: (d.text || '').length }))
}
export function hasDocs() { return load().length > 0 }
export function addDoc({ name, type = 'document', text }) {
  if (!text || !String(text).trim()) return null
  const docs = load()
  const doc = { id: 'd' + Math.random().toString(36).slice(2, 9), name: name || 'Untitled', type, text: String(text), addedAt: new Date().toISOString() }
  docs.push(doc); save(docs)
  return { id: doc.id, name: doc.name, type: doc.type, addedAt: doc.addedAt, chars: doc.text.length }
}
export function removeDoc(id) { save(load().filter(d => d.id !== id)); indexCache.delete(id) }

// ── Embedded index (in-memory, rebuilt on change) ──
const indexCache = new Map()   // docId → { sig, chunks:[{text,vector}] }
async function embed(texts) {
  const r = await apiFetch('/api/embed', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ input: texts }) })
  if (!r.ok) throw new Error(`embed ${r.status}`)
  return (await r.json()).vectors || []
}
async function ensureIndexed(docs) {
  const all = []
  for (const doc of docs) {
    const sig = `${doc.text.length}:${doc.text.slice(0, 48)}:${doc.text.slice(-48)}`   // cheap change-detector (head+tail catches same-length edits)
    let entry = indexCache.get(doc.id)
    if (!entry || entry.sig !== sig) {
      const chunks = chunkText(doc.text, { size: 600, overlap: 100 }).slice(0, 40)   // cap per doc
      const vectors = chunks.length ? await embed(chunks) : []
      entry = { sig, chunks: chunks.map((text, i) => ({ text, vector: vectors[i] || [] })) }
      indexCache.set(doc.id, entry)
    }
    for (const c of entry.chunks) if (c.vector?.length) all.push({ text: c.text, vector: c.vector, doc: doc.name })
  }
  return all
}

// Retrieve a grounding block for `question`, or '' if no docs / embeddings unavailable / too slow.
// Time-boxed so a slow embed can NEVER stall a live answer (same rule as web search).
export async function retrieveContext(question, { k = 4, minScore, budgetMs = 2000 } = {}) {
  const docs = load()
  if (!docs.length || !question || !String(question).trim()) return ''
  const threshold = typeof minScore === 'number' ? minScore : getDocThreshold()
  const work = (async () => {
    const items = await ensureIndexed(docs)
    if (!items.length) return ''
    const [qv] = await embed([question])
    if (!qv?.length) return ''
    return groundingBlock(topK(qv, items, { k, minScore: threshold }))
  })().catch(() => '')                                   // RAG is best-effort — never throw into a hint
  const timeout = new Promise(res => setTimeout(() => res(''), budgetMs))
  return Promise.race([work, timeout])
}
