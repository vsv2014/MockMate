import { describe, expect, it } from 'vitest'
import { buildLiveSttKeyterms } from './liveSttKeyterms.js'
describe('Live context-specific Deepgram terms', () => {
  it('includes GenAI vocabulary for a RAG-oriented interview', () => {
    const terms = buildLiveSttKeyterms({ targetRole: 'LLM Engineer', jobDescription: 'Build RAG applications at scale' })
    for (const term of ['RAG','LangChain','LangGraph','reranker','fine-tuning']) expect(terms).toContain(term)
    expect(terms.length).toBeLessThanOrEqual(40)
  })
  it('does not inject AI terms in a non-AI interview', () => {
    const terms = buildLiveSttKeyterms({ targetRole: 'Frontend Developer', jobDescription: 'React TypeScript rendering' })
    expect(terms).not.toContain('LangGraph')
  })
  it('uses JD terms even when the resume is empty and deduplicates case-insensitively', () => {
    const terms = buildLiveSttKeyterms({ targetRole: 'AI Engineer', jobDescription: 'RAG rag RAG LangChain' })
    expect(terms.filter(x => x.toLowerCase() === 'rag')).toHaveLength(1)
    expect(terms).toContain('LangGraph')
  })
})
