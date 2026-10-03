# PR #45 Blast-Radius Review (branch `arena/01a102d3-mockmate`, head `17f80bc`+)

**Scope:** 114 files, +7,118/−1,593 vs `main` (26 added, 84 modified, 4 deleted).
**Method:** enumerate every changed surface → map dependents (fan-in) → check deleted-file
references, export-contract stability, storage/env contracts, failure swallowing, and
test coverage of changed code. Findings are rated by how far a failure would travel.

---

## 1. Subsystem blast-radius map

| Subsystem | Changed | Fan-in / exposure | Failure mode if it breaks | Radius | Rating |
|---|---|---|---|---|---|
| `shared/*` logic (22 files) | questionCapture, hintLayers, retrieval, transcriptBuffer, interviewState, generationManager, PI analyzer, +9 new modules | 1–11 importers each; run in browser + Express + Vercel | wrong answers / dead pipelines everywhere at once | **HIGH** | ✅ contracts backward-compatible, all tested |
| `electron/main.cjs` (+preload) | shortcuts, modes, capture, teleprompter | single desktop shell | overlay/shortcut/capture misbehavior on Windows | **HIGH** (user-visible, hard to unit test) | ✅ review-fixed; packaged smoke required |
| `api/_lib/*` (shared Express+Vercel) | apiRoutes registry, core RAG, interview, jobs | BOTH server shapes consume the same files | a bug ships to local AND hosted simultaneously | **HIGH** | ✅ smoke-tested; public-API default-deny intact |
| Billing/metering (`meter.js`, `plans.js`, `billing.js`, `store.js`) | unit-based metering, 413 input guard, reconcile endpoint | every authenticated paid-path request | over/under-charging quota | **HIGH** (money path) | ⚠ fixed 1 real mismatch (§3), tests updated |
| STT transport (`deepgramTransport` new, `useSystemAudio`, `useDeepgram` both refactored onto it) | reconnect, PCM queue, Finalize | both mic and system Live | transcription loss mid-interview | **HIGH** | ✅ degraded fallback + reconnect tests; Finalize scope review-fixed |
| RAG/embeddings (`src/lib/docs.js`, `api/embed.js`, retrieval) | fingerprint-bound cache, speculative pre-warm | Solo + Live grounding | silent re-embed cost or stale vectors | MEDIUM | ✅ fingerprint guard; byte-budget gap on watchlist |
| Jobs/Career (`api/_lib/jobs.js`, companyBoards, jobLocation, ycJobs, resumeFacts) | new source adapters + ranker | Jobs/Career pages only | bad rankings, isolated to feature | MEDIUM | ✅ isolated, tested |
| Custom Prompt Studio + PI panel (new components) | templates, presets | additive UI | isolated to feature | LOW | ✅ tested |
| Mobile (6 files) | session domain + UI | private-beta foundation | isolated; not in desktop release | LOW | ✅ domain tests added |
| `vite.config.js` | manual chunk splitting | build only | bundle layout | LOW | ✅ verified by build |
| Docs (10 files) | architecture/release/autopsy | none runtime | n/a | NONE | ✅ |

## 2. Structural containment — verified, not assumed

1. **Deleted files leave zero dangling references.** `src/useSpeech.js`, `backend/src/db.js`,
   `electron/copilot.html`, `electron/preload-copilot.cjs` — grep-verified no remaining
   importers. Copilot mini-window survives via an inline data-URL; both BrowserWindow
   creations use the live `preload.cjs`.
2. **Changed export surfaces are backward-compatible.** `retrieval.js` signature changes add
   optional params only; `hintLayers.js` adds `sanitizeSpokenProse`; `questionCapture` adds
   an optional `source` param and `getAudioSource` controller opt. High-fan-in modules
   (`interviewClassify` 11 importers, `screenContext` 6, `interviewState` 5) had **no
   export-line changes**.
3. **Storage keys are namespaced and account-scoped.** All new keys are `mm-*`
   (`mm-product-intel-v1`, `mm-saved-playbooks-v1`, `mm-jobs-*`, `mm-duo-recent-v1`,
   replay opt-in) and go through `accountScope` where user-bound.
4. **New env vars have safe defaults.** `MOCKMATE_HOSTED` off by default;
   `REQUIRE_EMAIL_VERIFICATION` / `VERIFY_URL_BASE` / `RESET_URL_BASE` affect only the
   hosted mail path. Vercel serverless stays default-deny without
   `MOCKMATE_ALLOW_PUBLIC_API=1`.
5. **`api/_lib` dual-consumption is intentional and smoke-covered** — the Express shim and
   Vercel functions share the route registry; `smoke:api` exercises it locally.

## 3. Findings FIXED by this review

| # | Finding | Severity | Fix |
|---|---|---|---|
| BR-1 | **Metering contract mismatch:** `MULTI_CALL_PATHS` contained `/api/match-jobs`, a route that does not exist (real route: `/api/jobs`) — job operations silently never received their +1 unit bonus (under-metering) | real, money path | path corrected in `backend/src/plans.js` + `backend/src/middleware/meter.js` |
| BR-2 | `docs/RELEASE_NOTES_v1.5.2.md` still described the unscoped Finalize mechanism and "Closed-Loop" ARCH with global-bucket promotion | doc drift | synced to implemented semantics (system/loopback-only, session-authoritative disable; operation-scoped promotion) |

## 4. Watchlist (not blockers; tracked)

| # | Item | Why it's contained today | Trigger to revisit |
|---|---|---|---|
| BR-W1 | 46 new swallow-catches, concentrated in IPC/telemetry glue (`LiveCompanion`, `main.cjs`, `productIntelligence`, `deepgramTransport`) | all wrap optional/telemetry paths; diagnostics breadcrumbs cover the important ones | any "nothing happened" bug report → check these first |
| BR-W2 | `src/lib/productIntelligence.js` and `src/lib/windowDrag.js` have no direct tests | logic lives in tested `shared/productIntelligence.js`; collector is thin storage glue | before adding non-trivial collector logic |
| BR-W3 | RAG vector cache has a document-count bound but no byte/LRU budget; write failures swallowed | retrieval falls back to re-embedding, so correctness survives | storage-pressure complaints → IndexedDB or byte budget |
| BR-W4 | Billing behavior change is user-visible: large requests now cost 1–5 units and >80k/320k-char requests 413 | intended hardening, tested in `meter.test.js` | announce in release notes/support copy |
| BR-W5 | `electron/main.cjs` has no automated coverage (inherent) | Desktop CI + packaged smoke list (Alt+T→drag→Alt+T, mic/system first question, F7 repeat) | before every Windows release |
| BR-W6 | Mobile suite cannot run in this CI (no `mobile/node_modules`) | mobile is private-beta, isolated | when mobile leaves beta |

## 5. Bottom line

The branch's blast radius is **structurally contained**: deletions are reference-clean,
modified shared contracts are additive-only, the dual-shape API layer is smoke-covered,
and the genuinely wide-radius items (Electron shell, STT transport, billing, ARCH routing)
each went through targeted review fixes with tests. What remains is release validation,
not code risk: the packaged-Windows smoke (BR-W5) and the soak-evidence round.
