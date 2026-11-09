// Selected interview context only; never record or upload a global personal dictionary.
// Deepgram Nova-3 keyterms aid recognition of domain jargon but do not prove
// ASR correctness. All terms are a hint, not a post-hoc transcript replacement.
const KW_STOP = new Set('and the for with you your are was were our their from this that have has had will would over into per via team teams work working experience years year using used use built build led role responsibilities including based across also able strong excellent'.split(' '))
const GENERATIVE_AI_TERMS = [
  'RAG', 'retrieval augmented generation', 'LLM', 'LangChain', 'LangGraph',
  'reranker', 'fine-tuning', 'vector database', 'embeddings', 'hallucination',
]

export function buildLiveSttKeyterms(profile = {}) {
  const context = [profile.targetRole, profile.resume, profile.jobDescription, profile.focus]
    .filter(x => typeof x === 'string').join(' ')
  const isGenerativeAi = /\b(?:generative\s+ai|genai|llms?|rag|retrieval\s+augmented|langchain|langgraph|embeddings?|fine[ -]?tuning|large\s+language\s+models?)\b/i.test(context)
  const freq = new Map()
  for (const tok of context.match(/[A-Za-z][A-Za-z0-9+#.]{1,30}/g) || []) {
    const low = tok.toLowerCase()
    if (KW_STOP.has(low) || low.length < 2) continue
    const proper = /^[A-Z]/.test(tok) || /[A-Z0-9+#.]/.test(tok.slice(1))
    const w = freq.get(low) || { token: tok, n: 0, proper }
    w.n += 1
    w.proper = w.proper || proper
    if (proper && !/^[A-Z]/.test(w.token)) w.token = tok
    freq.set(low, w)
  }
  const selected = [...freq.values()]
    .sort((a, b) => (b.proper - a.proper) || (b.n - a.n))
    .map(x => x.token)
  const ordered = isGenerativeAi
    ? [...GENERATIVE_AI_TERMS, ...selected]
    : selected
  const unique = new Set()
  return ordered.filter(term => {
    const normalized = term.toLowerCase()
    if (unique.has(normalized)) return false
    unique.add(normalized)
    return true
  }).slice(0, 40)
}
