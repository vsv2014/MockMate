# Document RAG — plan

**Why:** stuffing a whole resume truncated to ~1800–4000 chars into every prompt loses facts past
the cutoff. RAG chunks + embeds documents once and retrieves only chunks relevant to the *current*
question. Matches LockedIn-style documents panel (incl. the "filter document" relevance threshold).

## Built + verified (server + client — v1.5.1)

### Server & shared core
- ✅ `shared/retrieval.js` — header-inherited semantic `chunkText` (`[Section: ...]`), metric/entity
  signal extraction, `cosineSim`, diversity-aware hybrid vector + lexical `topK(minScore)` and
  `lexicalTopK`, plus `groundingBlock` with section attribution.
- ✅ `src/pdf.js` — layout-aware PDF extraction (`reconstructPageText`) using `transform[4]`/`transform[5]`
  coordinates and font-height ratios to preserve headings, bullet lists, and tables.
- ✅ `embed()` in `api/_lib/core.js` & `/api/embed` — OpenAI `text-embedding-3-small` → Gemini
  `gemini-embedding-001` (or `EMBED_MODEL` override), returning `{ vectors, provider, model, embeddingModel }`.

### Client wiring
- ✅ Documents store — `src/lib/docs.js` (+ `Documents.jsx`): persist docs with text; types include
  resume / jd / knowledge / supporting / training / document; **per-doc selection checkboxes**.
- ✅ Persistent vector cache (`mm-docs-index-v1`) — caches document embeddings across reloads bound
  to `sig`, `dimensions`, and `embeddingModel` (`provider:model`), invalidating automatically if the
  embedding provider or model changes.
- ✅ Speculative RAG pre-warm — `LiveCompanion.jsx` pre-warms retrieval during question stabilization
  (`320ms` debounce, `AbortController` cancellation, `canReuseSpeculativeRag` token-overlap reuse).
- ✅ Retrieval at question time — embed question → hybrid `topK` → `<retrieved_documents>` grounding
  block elevated alongside `<candidate_resume>`, with **Context Audit Trail** badges (`✓ RESUME`,
  `📄 Doc · §Section`, `🖥 SCREEN`, `🌐 WEB`).
- ✅ Session snapshot — `buildInterviewConfig` at Live/Solo start freezes selected IDs for the run,
  and Solo setup validates `getSelectedDocIds().length > 0`.
- ✅ Threshold control — “Filter document” slider in AI Settings (`aiSettings.js`, default 0.20).
- ✅ `shared/retrieval.test.js` & `src/lib/docs.test.js` — unit coverage for header-inherited chunking,
  diversity re-ranking, speculative reuse, and `embeddingModel` cache invalidation.

## Notes / decisions
- Keep the index **client-side** (privacy; docs never persist server-side) — server only embeds.
- Fallback: if no embedding provider → skip RAG, keep truncated-resume path.
- Onboarding resume upload is **PDF-only** (1.4.6); paste/extract paths elsewhere unchanged.
