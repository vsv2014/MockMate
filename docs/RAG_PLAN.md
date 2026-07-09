# Document RAG — plan

**Why:** today MockMate stuffs the whole resume, **truncated to 1800–4000 chars**, into every prompt
(`api/_lib/interview.js`) — one doc, no retrieval, facts past the cutoff are lost. RAG chunks +
embeds documents once and retrieves only the chunks relevant to the *current* question. Matches
LockedIn's documents panel (incl. the "filter document" 0.20 relevance threshold).

## Built + verified (server core)
- ✅ `shared/retrieval.js` — `chunkText`, `cosineSim`, `topK(minScore)`, `groundingBlock`. Pure,
  unit-tested live (chunking, cosine 1.0/0.0, top-K retrieval, threshold filtering).
- ✅ `embed()` in `api/_lib/core.js` — provider-agnostic (OpenAI `text-embedding-3-small` → Gemini
  `text-embedding-004`), reuses existing keys. Optional `EMBED_MODEL` override.
- ✅ `/api/embed` on both servers (`server.js` + `apiRoutes.js`, auth-gated, NOT cap-metered).

## Remaining (client wiring — needs a build to verify)
1. **Documents store** — `src/lib/docs.js`: persist `[{ id, name, type, text, chunks:[{text,vector}] }]`
   in localStorage/userData. On add: `chunkText` → `POST /api/embed(chunks)` → store vectors (once).
2. **Retrieval at question time** — new helper `retrieveContext(question)`:
   `POST /api/embed(question)` → `topK(qVec, allChunks, {k:4, minScore})` → `groundingBlock(hits)`.
   Feed the block into the hint as `extraContext` (Live) / into `profile`-grounding, REPLACING the
   `slice(0,4000)` resume stuffing when docs exist.
3. **Documents UI** — a "Documents" section (Live setup + Solo setup, and/or Settings): upload
   (reuse `extractPdfText`), list (name/type/time), delete, "N documents indexed" — the LockedIn panel.
4. **Threshold control** — expose `minScore` as the "Filter document" slider in AI Settings (default 0.20),
   persisted via `aiSettings.js`.
5. **Multi-doc** — resume + JD + extras all indexed together; retrieval spans all of them.

## Notes / decisions
- Keep the index CLIENT-side (privacy; docs never persist server-side) — server only embeds.
- Managed mode: `/api/embed` is auth-gated and uncapped (embeddings are cheap, not an AI "response").
- Re-embed only on doc change (cache vectors); question embedding is one small call per question.
- Fallback: if no embedding provider (no OpenAI/Gemini key) → skip RAG, keep today's truncated-resume path.

## Order
Build core (done) → docs store + retrieve helper → wire into Live/Solo hint context → Documents UI →
threshold slider. Verify after `npm install` + build.
