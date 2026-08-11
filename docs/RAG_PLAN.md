# Document RAG — plan

**Why:** stuffing a whole resume truncated to ~1800–4000 chars into every prompt loses facts past
the cutoff. RAG chunks + embeds documents once and retrieves only chunks relevant to the *current*
question. Matches LockedIn-style documents panel (incl. the "filter document" relevance threshold).

## Built + verified (server + client — v1.4.3+)

### Server core
- ✅ `shared/retrieval.js` — `chunkText`, `cosineSim`, `topK(minScore)`, `groundingBlock`.
  *(No dedicated `retrieval.test.js` yet — do not claim suite coverage until added.)*
- ✅ `embed()` in `api/_lib/core.js` — OpenAI `text-embedding-3-small` → Gemini `text-embedding-004`;
  optional `EMBED_MODEL` override.
- ✅ `/api/embed` on local + auth backends (auth-gated where applicable, not cap-metered as an “AI response”).

### Client wiring
- ✅ Documents store — `src/lib/docs.js` (+ `Documents.jsx`): persist docs with text; types include
  resume / jd / knowledge / supporting / training / document; **per-doc selection checkboxes**.
- ✅ Retrieval at question time — embed question → `topK` → grounding block with **source attribution**;
  filter by **selectedDocumentIds** only (soft policy — classifier must not hard-filter doc types).
- ✅ Session snapshot — `buildInterviewConfig` at Live/Solo start freezes selected IDs for the run.
- ✅ Threshold control — “Filter document” slider in AI Settings (`aiSettings.js`, default 0.20).
- ✅ `shared/retrieval.test.js` — chunk / topK / groundingBlock citation tests.

## Still open (product quality, not missing wiring)
- Packaged soak: prove RAG improves answer grounding on real Solo/Live sessions (evidence, not code).
- Re-embed / cache edge cases under managed-vs-BYOK key switches.
- Optional: move large indexes off `localStorage` to `userData` if users hit quota.

## Notes / decisions
- Keep the index **client-side** (privacy; docs never persist server-side) — server only embeds.
- Fallback: if no embedding provider → skip RAG, keep truncated-resume path.
- Onboarding resume upload is **PDF-only** (1.4.6); paste/extract paths elsewhere unchanged.
