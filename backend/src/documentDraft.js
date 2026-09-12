export const DOCUMENT_TYPES = ['resume', 'jd', 'knowledge', 'supporting', 'training', 'document']
export const DOCUMENT_TEXT_LIMIT = 300_000
export const DOCUMENT_CONTEXT_LIMIT = 6_000

const clean = value => typeof value === 'string' ? value.trim() : ''

export function normalizeDocumentPayload(input = {}) {
  return {
    name: clean(input.name).slice(0, 180),
    type: DOCUMENT_TYPES.includes(input.type) ? input.type : 'document',
    text: clean(input.text).slice(0, DOCUMENT_TEXT_LIMIT),
  }
}

export function validateDocumentPayload(input = {}) {
  const value = normalizeDocumentPayload(input)
  if (!value.name) return { value, error: 'Add a document name.' }
  if (!value.text) return { value, error: 'Paste document text before saving.' }
  return { value, error: '' }
}

const words = value => new Set(clean(value).toLowerCase().match(/[a-z0-9][a-z0-9+#.-]{1,}/g) || [])

export function buildDocumentContext(question, documents = [], limit = DOCUMENT_CONTEXT_LIMIT) {
  const query = words(question)
  if (!query.size || !Array.isArray(documents) || !documents.length) return ''
  const chunks = []
  for (const document of documents) {
    const body = clean(document?.text)
    for (let offset = 0; offset < body.length; offset += 1_100) {
      const text = body.slice(offset, offset + 1_300)
      const tokens = words(text)
      let score = 0
      for (const token of query) if (tokens.has(token)) score += token.length > 5 ? 2 : 1
      if (score) chunks.push({ score, text, name: clean(document?.name) || 'Document', type: document?.type || 'document' })
    }
  }
  chunks.sort((a, b) => b.score - a.score)
  const chosen = []
  let used = 0
  for (const chunk of chunks.slice(0, 6)) {
    const block = `[${chunk.type}: ${chunk.name}]\n${chunk.text}`
    if (used + block.length > limit && chosen.length) break
    chosen.push(block.slice(0, Math.max(0, limit - used)))
    used += block.length + 2
    if (used >= limit) break
  }
  return chosen.length ? `RELEVANT FROM THE USER'S SELECTED DOCUMENTS:\n\n${chosen.join('\n\n')}` : ''
}
