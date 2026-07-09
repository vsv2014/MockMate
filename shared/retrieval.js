// Lightweight RAG retrieval — chunk documents, embed once, and per-question retrieve only the most
// relevant chunks (cosine similarity) instead of stuffing a whole truncated resume into every prompt.
// Pure math + string helpers (no deps), so it's testable in isolation; embeddings come from core.js.

// Split text into overlapping chunks on sentence/paragraph-ish boundaries. ~size chars each with
// `overlap` carried over so a fact split across a boundary is still retrievable from either chunk.
export function chunkText(text, { size = 600, overlap = 100 } = {}) {
  const clean = String(text || '').replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').trim()
  if (!clean) return []
  if (clean.length <= size) return [clean]
  // Prefer to break on paragraph/sentence boundaries near the target size.
  const chunks = []
  let i = 0
  while (i < clean.length) {
    let end = Math.min(i + size, clean.length)
    if (end < clean.length) {
      const slice = clean.slice(i, end)
      const brk = Math.max(slice.lastIndexOf('\n\n'), slice.lastIndexOf('. '), slice.lastIndexOf('\n'))
      if (brk > size * 0.5) end = i + brk + 1   // only honor a boundary in the back half
    }
    chunks.push(clean.slice(i, end).trim())
    if (end >= clean.length) break
    i = Math.max(end - overlap, i + 1)
  }
  return chunks.filter(Boolean)
}

export function cosineSim(a, b) {
  if (!a || !b || a.length !== b.length) return 0
  let dot = 0, na = 0, nb = 0
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i] }
  const d = Math.sqrt(na) * Math.sqrt(nb)
  return d ? dot / d : 0
}

// items: [{ text, vector }]. Returns the top-k by similarity to queryVec, keeping only those at or
// above minScore (the "filter document" threshold — default 0.2, matching the competitor's knob).
export function topK(queryVec, items, { k = 4, minScore = 0.2 } = {}) {
  return items
    .map(it => ({ ...it, score: cosineSim(queryVec, it.vector) }))
    .filter(it => it.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
}

// Build a grounding block from retrieved chunks (what gets injected into the hint prompt).
export function groundingBlock(chunks) {
  if (!chunks?.length) return ''
  return '\n\nRELEVANT FROM YOUR DOCUMENTS (ground the answer in these — they were retrieved for THIS question):\n'
    + chunks.map((c, i) => `[${i + 1}] ${c.text}`).join('\n\n')
}
