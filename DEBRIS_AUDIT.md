# MockMate Debris Audit — v1.4.x → v1.6.4

Archaeological survey of the repository at commit `24fa4de` (branch `arena/9745b96d-mockmate`).
Scope: everything except `node_modules`, `.git`. Method per category is stated inline.
Findings marked **(inferred)** could not be proven by static analysis alone.

Legend — Severity: Critical / High / Medium / Low / Cosmetic. Disposition: Delete safe / Investigate / Keep.

---

## A. Dead files

Method: import graph built from every entry point (`package.json` main → `electron/bootstrap-v153.cjs`, `electron/main.cjs`, `server.js`, `server-entry.cjs`, `backend/server.js`, `src/main.jsx` via `index.html`, `journey-preview.html`, all `api/*.js` Vercel functions, `vite.config.js`, all `scripts/`, `evals/run.mjs`, `mobile/App.tsx`, `public/*.js` workers), with relative-import resolution. Tests were traversed separately to distinguish "test-only" from "dead".

1. **Path:** `src/components/ui/Button.jsx:1`
   **Category:** A
   **What it is:** shadcn-style button component imported by nothing; its own import is broken.
   **Evidence:** zero importers in graph; line 1–3 import `../lib/cn`, which resolves to `src/components/lib/cn` — a path that does not exist (actual file is `src/lib/cn.js`). The file would throw if ever loaded.
   **Severity:** High
   **Disposition:** Delete safe

2. **Path:** `src/components/ui/Badge.jsx:1` — same as above (broken `../lib/cn` import, zero importers). **Category:** A. **Severity:** High. **Disposition:** Delete safe.

3. **Path:** `src/components/ui/Card.jsx:1` — same (broken `../lib/cn` import, zero importers). **Category:** A. **Severity:** High. **Disposition:** Delete safe.

4. **Path:** `src/components/ui/Input.jsx:1` — same (broken `../lib/cn` import, zero importers). **Category:** A. **Severity:** High. **Disposition:** Delete safe.

5. **Path:** `src/components/ui/Separator.jsx:1` — same (broken `../lib/cn` import, zero importers; sole user of `@radix-ui/react-separator`). **Category:** A. **Severity:** High. **Disposition:** Delete safe.

6. **Path:** `src/lib/cn.js:1`
   **Category:** A
   **What it is:** `clsx` + `tailwind-merge` helper with zero working importers (only the dead UI kit above tries — at the wrong path).
   **Evidence:** `grep -rn "lib/cn"` → only the five `src/components/ui/*` files, all via the unresolvable `../lib/cn` specifier.
   **Severity:** High
   **Disposition:** Delete safe

7. **Path:** `src/index.css:1-89`
   **Category:** A
   **What it is:** A full Tailwind `@theme` stylesheet that nothing imports; `src/main.jsx:3-4` imports only `fonts.css` and `styles.css`.
   **Evidence:** `grep -rn "index.css"` across the repo returns no import/link anywhere; it is also a drifted near-duplicate of `styles.css` (199 diff lines, same palette block).
   **Severity:** High
   **Disposition:** Delete safe

8. **Path:** `logs/server.log:1-1354`
   **Category:** A
   **What it is:** A committed runtime log from 2026-07-01 containing a developer's absolute home path.
   **Evidence:** line 1: `[2026-07-01T12:29:49.472Z] [log] [MockMate] server logs → /home/vishalveerannapet/Downloads/MockMate-main/logs/server.log`; `git check-ignore` reports it TRACKED.
   **Severity:** Medium (leaks local username/path; noise in every clone)
   **Disposition:** Delete safe (and add `logs/` to `.gitignore`)

9. **Path:** `journey-preview.html:1` + `src/journey/JourneyPreview.jsx:1`
   **Category:** A (reachable only via a dev flag; see also O)
   **What it is:** A standalone preview harness only reachable when `MOCKMATE_JOURNEY_PREVIEW=1` rewrites `/` in the dev server.
   **Evidence:** `vite.config.js:13-27` (`journeyPreviewEntry`, `MOCKMATE_JOURNEY_PREVIEW === '1'`); no production path serves `journey-preview.html`.
   **Severity:** Low
   **Disposition:** Keep (owner-confirmed dev/testing harness)

10. **Path:** `mobile/scripts/validate-build-env.mjs:1`
    **Category:** A (false positive candidate — documented so it is not deleted by mistake)
    **What it is:** Looks unreachable from any import, but is an EAS build hook.
    **Evidence:** `mobile/package.json:13` — `"eas-build-pre-install": "node scripts/validate-build-env.mjs"`.
    **Severity:** Cosmetic
    **Disposition:** Keep (invoked by EAS lifecycle, not by import)

No other dead code files found: every other `.js/.jsx/.cjs/.mjs` file is reachable from an entry point or a test.

---

## B. Dead exports

Method: for every `export function|const|class` in non-test files, grep the rest of the repo (prod and tests separately), counting internal same-file use.

1. **Path:** `api/_lib/playbooks.js:104-121` — `PLAYBOOKS`
   **What it is:** The "ordered legacy-compatible list for first-match fallbacks / tests" — imported by nothing, not even tests.
   **Evidence:** `grep -rn "import.*PLAYBOOKS"` → zero hits. The only other `PLAYBOOKS` symbol in the repo is `api/_lib/interview.js:282` re-exporting `PLAYBOOK_BY_KEY as PLAYBOOKS` — also imported nowhere.
   **Severity:** Medium (17-entry array rebuilt on module load, misleads readers into thinking ordering matters)
   **Disposition:** Delete safe

2. **Path:** `api/_lib/interview.js:282` — `export { PLAYBOOK_BY_KEY as PLAYBOOKS, PLAYBOOK_REGISTRY_VERSION }`
   **What it is:** Re-export alias that renames a dict to the same name as the dead array in playbooks.js; zero importers.
   **Evidence:** grep for `PLAYBOOKS` importers: none. Two different shapes (array vs object) share one exported name across two files.
   **Severity:** Medium
   **Disposition:** Delete safe

3. **Path:** `src/Dashboard.jsx:327` — `DashboardHome`
   **What it is:** A second exported dashboard component (~200 lines) imported by nothing; `App.jsx` uses only the default export.
   **Evidence:** `grep -rn "DashboardHome"` → definition only.
   **Severity:** High (largest dead export by volume)
   **Disposition:** Investigate (confirm no dynamic usage, then delete)

4. **Path:** `src/auth/api.js:130` — `completeEmailVerification`
   **What it is:** Client call for `/auth/verify` that no component invokes; `public/verify.html:42-52` implements its own inline fetch instead.
   **Evidence:** zero importers; verify.html duplicates the flow.
   **Severity:** Medium
   **Disposition:** Delete safe

5. **Path:** `src/auth/api.js:175` — `reconcileBilling`
   **What it is:** Client wrapper for `POST /billing/reconcile`; never called from any UI (the backend route `backend/src/routes/billing.js:112` is reachable only by hand).
   **Evidence:** zero importers.
   **Severity:** Medium
   **Disposition:** Investigate (either the UI lost its "refresh plan" button, or the endpoint is also debris)

6. **Path:** `src/auth/api.js:176` — `startGoogleAuth`
   **What it is:** Launches the Google OAuth flow; no button or screen calls it although the full server flow exists (`backend/src/routes/auth.js:167-221`).
   **Evidence:** zero importers.
   **Severity:** Medium
   **Disposition:** Investigate (half-finished feature: server side wired, client side never shipped — see O.3)

7. **Path:** `shared/delivery.js:109` — `fillerRating`
   **What it is:** Score-labelling helper used by nothing (prod or test).
   **Evidence:** zero references outside its definition.
   **Severity:** Low
   **Disposition:** Delete safe

8. **Path:** `src/lib/interviewKits.js:169` — `currentKitOwnerScope`
   **What it is:** One-line wrapper `() => activeAccountScope()` exported and never imported.
   **Evidence:** zero references outside definition.
   **Severity:** Low
   **Disposition:** Delete safe

9. **Path:** `backend/src/documentDraft.js` — `_clearDocumentChunkCacheForTests`
   **What it is:** A `ForTests` helper that even the tests don't use.
   **Evidence:** zero references anywhere including `*.test.js`.
   **Severity:** Low
   **Disposition:** Delete safe

10. **Path:** `api/_lib/visionPolicy.js` — `VISION_COOLDOWN_MS`, `VISION_TRANSIENT_ATTEMPTS`, `visionError`
    **What it is:** Exported symbols never imported by another module (used internally only).
    **Evidence:** export-graph scan: external import count 0 for all three.
    **Severity:** Cosmetic (needless public surface)
    **Disposition:** Investigate (de-export; same for `backend/src/arch.js` `reasoningLane`, `publicCapabilityStatus`)

11. **Test-only exports (legitimate, listed for completeness):** `api/_lib/core.js` `_setDiscoveredModelsForTests`/`_resetProviderHealthForTests`/`_getProviderHealthForTests`/`_setProviderHealthForTests`, `api/_lib/visionPolicy.js` `_resetVisionStateForTests`, `backend/src/abl.js` `_resetAblCacheForTests`, `backend/src/arch.js` `resetArch*`, `recordArchProductEvent` (but see C.4). **Disposition:** Keep (explicit `ForTests` naming convention; imported by their test files).

---

## C. Dead code within files

1. **Path:** `shared/interviewClassify.js:35` vs `:23` and `:243,355`
   **What it is:** `ROLE_RULES` maps program/project managers to family `'customer_management'`, a value absent from the `RoleFamily` typedef; meanwhile `pickPlaybookKey` (:243) and the domain rule (:355) test `roleFamily === 'program_management'`, a value `inferRoleFamily` can never return. The `operations_process` playbook is therefore unreachable for every program-manager profile.
   **Evidence:** `grep -rn "program_management\|customer_management"` — `'customer_management'` produced at :35, consumed nowhere; `'program_management'` consumed at :243/:355, produced nowhere.
   **Severity:** High (silent functional gap, not just dead code)
   **Disposition:** Investigate

2. **Path:** `shared/interviewClassify.js:222` (`case 'project'`), `:224` (`'resume'`), `:226` (`'leadership'`), `:235` (`'customer_scenario'`), `:237` (`'marketing'`)
   **What it is:** `pickPlaybookKey`/`contextNeedsFor` switch cases for questionTypes that `classifyTurn` never emits (it emits `project_walkthrough`, `experience`, `behavioral`, `sales_roleplay`, `strategy`).
   **Evidence:** full scan of `questionType =` assignments in `classifyTurn` (lines 275-388): none of these five values is ever assigned.
   **Severity:** Medium
   **Disposition:** Investigate (could matter if persisted `lastClassification` from old sessions carries legacy type names — **inferred**)

3. **Path:** `api/_lib/core.js:1062-1065`
   **What it is:** A dead conditional in the vision failover loop: `if (kind === 'quota') { /* continue failover */ }` is an empty block immediately followed by `break` for all three kinds.
   **Evidence:** lines: `if (kind === 'auth' || kind === 'bad_request' || kind === 'quota') { if (kind === 'quota') { /* continue failover */ } break }` — the inner `if` changes nothing.
   **Severity:** Low (comment says "continue failover" but the code breaks — see also H)
   **Disposition:** Investigate (comment/intent mismatch may hide a bug: quota on vision provider #1 never tries provider #2)

4. **Path:** `backend/src/arch.js:30-52` + `:251`
   **What it is:** `recordArchProductEvent`/`archProductIntelligenceSnapshot` server-side product-event buffer that is never fed in production; `archRuntimeSummary` dutifully summarizes a permanently-empty array on every `/api/arch` call.
   **Evidence:** only caller of `recordArchProductEvent` is `backend/src/arch.test.js:124-131`. No route or middleware records product events.
   **Severity:** Medium
   **Disposition:** Investigate (either wire it to the client PI store or remove the server half)

5. **Path:** `src/Dashboard.jsx:327-` (`DashboardHome`) — ~200 lines of unreferenced component code inside a live file (same finding as B.3, counted once in totals).
   **Severity:** High. **Disposition:** Investigate.

6. **Path:** `shared/modelRegistry.js:29-30`
   **What it is:** `MODEL_PRIORITIES` contains bare string literals `"gpt-6-sol"` and `"gemini-3.7-flash"` — model ids that exist in no `MODEL_CATALOG` entry; they are only ever matched if live discovery happens to return them.
   **Evidence:** `"gpt-6-sol"` vs catalog default `gpt-6.1-sol` (line 3); `gemini-3.7-flash` appears only in `CURRENT_MODELS` regex (:121) and these two arrays.
   **Severity:** Low (harmless unless discovery returns stale ids)
   **Disposition:** Keep (deliberate discovery-time fallback per comment at :19-20) — but flag as drift-prone

7. **Path:** `src/LiveCompanion.jsx:586`
   **What it is:** State named `buyTimePhrase` that, per its own comment, no longer holds buy-time phrases — every setter writes either `''` or `thinkingLabel(...)`.
   **Evidence:** `:586` comment "holds thinkingLabel only (never a scripted 'Say:' line)"; all 12 `setBuyTimePhrase` calls pass `''` or `thinkingLabel(...)` (`:1207`, `:1649`).
   **Severity:** Low (vestigial naming from a removed feature)
   **Disposition:** Investigate (rename or collapse into the loading state)

---

## D. Duplicate implementations

1. **Path:** `api/_lib/apiRoutes.js:232-294` vs `api/hint-stream.js:1-48`
   **What it is:** The SSE hint-stream endpoint implemented twice — once for Express (local/managed) and once for Vercel serverless — with near-identical body and already-divergent behavior.
   **Evidence:** both set the same 3 SSE headers, same `send(event,data)` helper, same `recordArchMetric('llm_ttft_ms'/'turn_latency_ms:hint'/'empty_output_count')` calls; the Express copy additionally handles STT/LLM reservation release (`:245-254`) and `flushHeaders`, the serverless copy does not. Not guaranteed identical results.
   **Severity:** High
   **Disposition:** Investigate (known instance; consolidating requires the serverless wrapper to grow stream support)

2. **Path:** `api/_handler.js:13-17`, `api/hint-stream.js:7-9`, `api/providers.js:4-11`, `api/deepgram-token.js:7-11`, `api/token.js:8-12`
   **What it is:** The "public Vercel deploy disabled" guard copy-pasted five times with three different user-facing error strings.
   **Evidence:** all five test `process.env.VERCEL && process.env.MOCKMATE_ALLOW_PUBLIC_API !== '1'`; messages differ ("Use the managed auth backend." / "…or set MOCKMATE_ALLOW_PUBLIC_API=1 (not recommended)." / "…explicitly enable … for local/private testing.").
   **Severity:** Medium
   **Disposition:** Investigate

3. **Path:** `electron/bootstrap.cjs:19-35` vs `electron/main.cjs:326-332`
   **What it is:** Two generators for the per-install `.jwt-secret`: bootstrap writes it atomically and quits the app on failure; `getJwtSecret()` in main.cjs retains the pre-bootstrap logic that swallows the write error and silently falls back to an ephemeral secret — the exact failure mode the bootstrap comment says it exists to prevent.
   **Evidence:** bootstrap `:18` comment "a failed disk write can never silently turn into a one-run ephemeral JWT secret"; main.cjs `:330` `try { ...writeFileSync(f, secret...) } catch {}` then `return secret`.
   **Severity:** High
   **Disposition:** Investigate (main.cjs copy should become read-only consumer)

4. **Path:** `api/_lib/interview.js:684-690` (`evaluateSolo`) vs `api/_lib/core.js:1462-1470` (`makeReport`)
   **What it is:** Two feedback-report prompt templates maintaining the identical JSON contract (`overallScore`, `verdict` enum, `dimensions[{name,score,comment}]`, `strengths`, `improvements`, `summary`) in two files.
   **Evidence:** both contain the literal line `{ "overallScore": <0-100 integer>, "verdict": "Strong Hire" | "Hire" | "Lean Hire" | "Lean No Hire" | "No Hire",`.
   **Severity:** Medium (schema drift between Solo and Duo reports is one edit away)
   **Disposition:** Investigate

5. **Path:** `src/useDeepgram.js:302-330` vs `src/useSystemAudio.js:528-560`
   **What it is:** Two parallel Deepgram hook state machines (mic vs system audio) with duplicated suspend/wake/reconnect logic that has already drifted.
   **Evidence:** the `afterWake`/`onSuspend` handlers are line-for-line copies except `useSystemAudio` adds `attemptsAtSuspend` bookkeeping (`:540`, `:553`) that `useDeepgram` lacks; both also hard-code the same 400 ms wake delay instead of `computeReconnectDelayMs` used elsewhere in the same files (`useDeepgram.js:322`, `useSystemAudio.js:548`).
   **Severity:** High (bug fixed in one hook will not fix the other)
   **Disposition:** Investigate

6. **Path:** `src/index.css:3-48` vs `src/styles.css:3-40`
   **What it is:** The Tailwind `@theme` brand palette duplicated in a live and a dead stylesheet.
   **Evidence:** identical `--color-*` block; diff is 199 lines of extras in the dead copy.
   **Severity:** Medium (resolved by A.7)
   **Disposition:** Delete safe (the index.css copy)

7. **Path:** `src/styles.css:5` vs `src/auth/tokens.js:5`
   **What it is:** Two sources of truth for the brand palette with different values.
   **Evidence:** `--color-bg: #0a0a0e` (styles.css) vs `T.bg: '#0B0D12'` (tokens.js); `--color-accent: #14b8a6` vs `T.accent: 'linear-gradient(135deg, #14B8A6 0%, #10B981 100%)'`.
   **Severity:** Medium
   **Disposition:** Investigate (which palette is canonical?)

8. **Path:** `api/_lib/core.js:617-626` (`AI_ERRORS.vision_rate/vision_none`) vs `api/_lib/visionPolicy.js:95-112`
   **What it is:** The vision rate-limit / unavailable user-facing strings maintained twice, already word-for-word duplicated.
   **Evidence:** `'Screen analysis is temporarily rate-limited upstream. Please try again after the provider reset.'` appears at `core.js:625` and `visionPolicy.js:100`.
   **Severity:** Low
   **Disposition:** Investigate

9. **Path:** `api/_lib/apiRoutes.js:112-115` (Express `GET /api/models`) vs `vercel.json:17` + `api/providers.js:16-19`
   **What it is:** `/api/models` implemented as a real route locally and as a rewrite to `/api/providers?only=models` on Vercel — two code paths for one endpoint.
   **Evidence:** cited lines.
   **Severity:** Low
   **Disposition:** Keep (platform constraint: fewer serverless functions) — document it

10. **Path:** `shared/id.js:4` vs `src/lib/diagnostics.js:50` vs `api/_lib/core.js:38-39`
    **What it is:** Three copies of the same `Date.now().toString(36) + random/counter` id-generation idiom (`nid`, `createDiagnosticRequestId`, `newProviderAttemptId`).
    **Evidence:** cited lines; shared/id.js exists precisely to be the shared one.
    **Severity:** Low
    **Disposition:** Investigate

11. **Path:** `public/verify.html:42-52` vs `src/auth/api.js:130-140`
    **What it is:** Email-verification completion implemented twice — inline in the static page and as a never-used client function.
    **Evidence:** see B.4.
    **Severity:** Low
    **Disposition:** Investigate

Checked and NOT duplicated (for the record): cost calculator (`src/cost.js` is the only one), redaction (3 distinct layers — `shared/productIntelligence.js:94`, `electron/diagnostics.cjs:14`, `src/lib/diagnostics.js:7` — are different stages by design, though the three BLOCKED/SECRET regexes are sibling lists worth one shared constant), model registry (single `shared/modelRegistry.js`).

---

## E. Vibe-coding residue

Method: pattern grep for TODO/FIXME/HACK, "for now/temporar*/stub/placeholder", `_old/_v2/_tmp` names, and 3+-line commented-out code.

> **Owner note (post-audit):** the owner confirmed the session/planning markers below (round-N, PR #45, Phase N, M1/M2, P0-A) were added deliberately as development breadcrumbs. Items E.2–E.9 are reclassified **Keep (owner-confirmed dev aid)**. Only E.1 (user-visible "TODO" pill text) remains flagged, since it ships to end users.

1. **Path:** `src/journey/JourneyScreens.jsx:863-866`
   **What it is:** The literal string `'TODO'` rendered to end users as a status pill in the Ready Room checklist.
   **Evidence:** `<Pill tone={contextReady ? 'teal' : 'red'}>{contextReady ? 'OK' : 'TODO'}</Pill>` (×4).
   **Severity:** Medium (placeholder text in shipped UI)
   **Disposition:** Investigate (rename to "Pending"/"Not checked" — wording change, not code removal)

2. **Path:** `backend/src/arch.js:10-14`
   **What it is:** Comment addressed to a code-review conversation that is not in the repo: "NOTE (PR #45 review): … acceptable for the current single-digit-user deployment, must be scoped … before hosted scale-out."
   **Evidence:** quoted.
   **Severity:** Low (un-actionable deferred-work marker)
   **Disposition:** Keep (owner-confirmed dev aid)

3. **Path:** `electron/main.cjs:56`, `:572`, `:640`
   **What it is:** Three "PR #45 review fix:" comments narrating a review thread instead of the invariant.
   **Evidence:** e.g. `:640` "Display selection precedence (PR #45 review fix):".
   **Severity:** Cosmetic
   **Disposition:** Keep (owner-confirmed dev aid)

4. **Path:** `src/auth/api.js:112`, `src/auth/AuthGate.jsx:80`, `backend/src/hostedConfig.js:82`
   **What it is:** "round-5 review P1" markers — session-planning jargon from an AI-assisted review cycle.
   **Evidence:** `api.js:112` " * Signup response is an EXPLICIT UNION (round-5 review P1):".
   **Severity:** Cosmetic
   **Disposition:** Keep (owner-confirmed dev aid)

5. **Path:** `backend/src/middleware/meter.js:16`, `backend/src/store.js:128`, `:214`, `backend/server.js:123`, `api/_lib/apiRoutes.js:84`
   **What it is:** "round-5/6 review" markers, same residue family.
   **Severity:** Cosmetic
   **Disposition:** Keep (owner-confirmed dev aid)

6. **Path:** `shared/hintLayers.js:154`
   **What it is:** "LP-20 (LockedIn autopsy):" — ticket id + competitor post-mortem reference with no corresponding tracker in-repo.
   **Evidence:** quoted; the code beneath (PLACEHOLDER_RE) is live and good — only the marker is residue.
   **Severity:** Cosmetic
   **Disposition:** Keep code; the comment context is actually useful — Keep

7. **Path:** `shared/interviewState.js:2`, `shared/contextSelection.js:2,89`, `shared/interviewClassify.js:59`, `src/LiveCompanion.jsx:726`
   **What it is:** "M1"/"M2" milestone jargon in doc comments ("M1 observability + contamination guards", "M2 question capture pipeline") — meaningless without the private planning doc.
   **Severity:** Cosmetic
   **Disposition:** Keep (owner-confirmed dev aid)

8. **Path:** `src/lib/sessionMetrics.js:1` ("Phase 6"), `electron/main.cjs:967` ("Phase 3"), `:1189` ("Phase 6"), `:1269` ("Phase 4"), `src/auth/Login.jsx:15` ("Phase 2"), `src/useSystemAudio.js:91` ("P0-A")
   **What it is:** Phase-number labels from a roadmap that is not in the repo.
   **Severity:** Cosmetic
   **Disposition:** Keep (owner-confirmed dev aid)

9. **Path:** `shared/questionCapture.js:451`
   **What it is:** Comment "// Temporarily evaluate flushed text" above permanent (not temporary) logic.
   **Evidence:** the flushed-lane assessment below it is the standing behavior.
   **Severity:** Cosmetic
   **Disposition:** Keep (owner-confirmed dev aid)

10. **Path:** `api/_lib/core.js:663`
    **What it is:** "(the v1.4.9 log tried four Claude aliases)" — debugging-session reference as justification comment, three minor versions old.
    **Severity:** Cosmetic
    **Disposition:** Keep (documents a real regression the code guards against) — flag only

Commented-out code blocks: none found (the candidates flagged by scan — `electron/main.cjs:145-147,641-643,969-971`, `src/useSystemAudio.js:128-131`, `src/auth/Login.jsx:13-15` — are prose/doc comments, verified manually). `debugger` statements: none. `_old/_v2/_tmp/_backup` function names: none (the `*_v1/_v2` strings in playbooks are data version tags, not functions).

---

## F. Inconsistent patterns

1. **Styling — 5 coexisting systems.**
   - Inline `style={{...}}` with `T` tokens from `src/auth/tokens.js:4`: dominant — 870 `style={{` occurrences across 12 JSX files (`src/LiveCompanion.jsx` 180, `src/App.jsx` 152, `src/journey/JourneyScreens.jsx` 151, `src/Dashboard.jsx` 108, `src/Solo.jsx` 90, `src/Career.jsx` 82, `src/ApiKeys.jsx` 75, `src/Jobs.jsx` 61, `src/SoloFeedback.jsx` 54, `src/components/ProductIntelligencePanel.jsx` 39, `src/Room.jsx` 34, `src/Duo.jsx` 34).
   - Tailwind 4 via `@tailwindcss/vite` + `src/styles.css:1` `@import "tailwindcss"` + `@theme`: effectively unused — only 2 utility-class `className`s in the entire `src/` tree (39 `className=` total, mostly ids/hooks).
   - Custom `.mm-*` classes: `src/ApiKeys.jsx:100,104,307` (3 sites, 1 file) with an inline `<style>` tag at `:307`.
   - Dead shadcn/cva kit: `src/components/ui/*` (5 files, 0 users).
   - Raw `cssText` strings for PiP windows: `src/LiveCompanion.jsx:886`, `src/Room.jsx:179`, `src/lib/clipboard.js:16`.
   **Severity:** High (Tailwind + cva + 4 radix packages are build/dep weight carried for 2 class names). **Disposition:** Investigate.

2. **Logging — 5 systems.**
   - `console.*`: 100 non-test call sites across `src/ shared/ api/ backend/src electron/`.
   - `providerDiagnostic()` (server → IPC): `api/_lib/core.js:29-36`, 13 event names.
   - `diagnostic()` (renderer → IPC JSONL): `src/lib/diagnostics.js:24`, 53 call sites, 39 event names.
   - `recordArchMetric()` (in-process percentiles): `backend/src/arch.js:59`, 20 call sites.
   - `DiagnosticStore`/`logDiag` (electron main): `electron/main.cjs:33-35`.
   **Severity:** Medium (deliberate layering, but console.* leaks through all of it — see M). **Disposition:** Keep architecture; Investigate console.* sites.

3. **Fetch wrappers — 3 styles.**
   - `apiFetch` (auth/base-aware): 13 renderer files via `src/lib/apiClient.js`.
   - `fetchWithTimeout`: `api/_lib/http.js:2`, used by `core.js`, `search.js`, `jobs.js`.
   - Raw `fetch`: `api/_lib/core.js:158` (Deepgram provider test — in the same file that imports `fetchWithTimeout`, so this one call has no timeout wrapper beyond its manual AbortController), `src/lib/deepgramTransport.js` token path.
   **Severity:** Low. **Disposition:** Investigate `core.js:158` only.

4. **Env-flag parsing — 4 idioms.**
   - `=== '1'` : `api/_lib/core.js:34` (`MOCKMATE_HOSTED === '1'`), `electron/main.cjs` several.
   - `['1','true'].includes(...)`: `backend/src/arch.js:23`, `api/_lib/apiRoutes.js:119`.
   - `!== '0' && !== 'false'`: `api/_lib/core.js` deepgram fallback block.
   - `envFlag()` helper: `backend/src/hostedConfig.js:66`.
   Consequence: `MOCKMATE_HOSTED=true` is hosted in arch.js/apiRoutes but NOT in core.js:34 (console-log branch) — same variable, different truth tables.
   **Severity:** Medium. **Disposition:** Investigate.

5. **Error payload shapes — 4 variants.**
   - `{ error, code?, retryAfterMs? }` via `errorPayload()` — `api/_lib/apiRoutes.js:20-26`.
   - bare `{ error: e.message }` — `api/_handler.js:28`, `api/token.js`, `api/deepgram-token.js`.
   - `{ ok: false, error }` — `api/_lib/apiRoutes.js:106-110` (provider test).
   - `{ error, code }` with different code vocabulary — `backend/src/middleware/meter.js:47,85`.
   **Severity:** Medium (client branching on error shape must handle all four). **Disposition:** Investigate.

6. **Express rate-limit option naming** — `server.js:79` uses deprecated `max:` while `backend/server.js:104-106` and `backend/src/routes/auth.js:25` use the current `limit:` (express-rate-limit v8). Same library, two option generations (also an N finding).
   **Severity:** Low. **Disposition:** Investigate.

---

## G. Unused dependencies

Method: grep every `package.json` dependency name in import/require position across the repo (excluding `mobile/`, which has its own manifest).

1. **`@radix-ui/react-label`** — 0 imports anywhere. `package.json:169`. **Severity:** Medium. **Disposition:** Delete safe.
2. **`@radix-ui/react-scroll-area`** — 0 imports. `package.json:170`. **Severity:** Medium. **Disposition:** Delete safe.
3. **`@radix-ui/react-select`** — 0 imports. `package.json:171`. **Severity:** Medium. **Disposition:** Delete safe.
4. **`lucide-react`** — 0 imports (every icon in the app is a hand-rolled inline `<svg>`, e.g. `src/App.jsx:1299`). **Severity:** Medium. **Disposition:** Delete safe.
5. **`@radix-ui/react-separator`** — imported only by dead `src/components/ui/Separator.jsx`. **Severity:** Medium. **Disposition:** Delete safe (with A.5).
6. **`@radix-ui/react-slot`** — only dead `src/components/ui/Button.jsx`. **Disposition:** Delete safe (with A.1).
7. **`class-variance-authority`** — only dead `Badge.jsx`/`Button.jsx`. **Disposition:** Delete safe.
8. **`clsx`** — only dead `src/lib/cn.js`. **Disposition:** Delete safe.
9. **`tailwind-merge`** — only dead `src/lib/cn.js`. **Disposition:** Delete safe.
10. **`vite.config.js:44`** — chunk-split rule `vendor-html2canvas` matches a package (`html2canvas`) that is not a dependency at all (nothing imports it; it is not in package.json). Dead build config. **Severity:** Low. **Disposition:** Delete safe.
11. **`package.json:202-205` `overrides`** (`proxy-addr: 2.0.8`, `shell-quote: 1.12.0`) — security pins from the Oct-2026 dependency audit (`docs/DEPENDENCY_AUDIT_2026-10.md:19`); whether upstream has released fixed versions making the pins obsolete is not determinable offline. **Severity:** Low. **Disposition:** Investigate.
12. **Single-call-site packages (flag only, all justified):** `helmet` (`server.js:44`), `jsonwebtoken` (`backend/src/middleware/auth.js`), `bcryptjs` (`backend/src/routes/auth.js`), `jspdf` (`src/lib/resumePdf.js`), `pdfjs-dist` (`src/pdf.js`) — each is real functionality; none trivially inlinable. **Disposition:** Keep.
13. **`tailwindcss` + `@tailwindcss/vite`** (dev) — carried for the `@theme` variable block and 2 utility class usages (see F.1). Technically used; practically a styling system that never got adopted. **Severity:** Medium. **Disposition:** Investigate.

---

## H. Comment-reality drift

1. **Path:** `api/_lib/core.js:789-795`
   **What it is:** Comments explain behavior in terms of "Gemini 2.5 models THINK by default" and "Gemini 2.5 (OpenAI-compat) 400s on response_format"; the catalog has shipped Gemini 3.5/3.6/3.8 since (`shared/modelRegistry.js:6-8`), and `CURRENT_MODELS.gemini` (:121) rejects 2.5 ids outright — the comment describes models the code can no longer select.
   **Severity:** Low (logic still correct for 3.x, rationale is stale)
   **Disposition:** Investigate

2. **Path:** `api/_lib/core.js:1062-1065`
   **What it is:** `/* continue failover */` above a `break` that prevents failover (same lines as C.3 — the comment is the drift half).
   **Severity:** Medium
   **Disposition:** Investigate

3. **Path:** `.env.example:44-49`
   **What it is:** Anthropic section headline says "Fable 5 / Opus 5 / Sonnet 5 / Haiku 4.5" and suggests `ANTHROPIC_SONNET5_MODEL=claude-sonnet-5`, `ANTHROPIC_HAIKU_MODEL=claude-haiku-4-5-20251001`, but the registry's current defaults are Sonnet 5.5 and Haiku 5.5 (`shared/modelRegistry.js:14-15`); the documented overrides would pin users to the previous generation.
   **Severity:** Medium (actively misleading config documentation)
   **Disposition:** Investigate

4. **Path:** `electron/bootstrap-v153.cjs:1-8` (+ `package.json:5` `"main"`)
   **What it is:** The app's entry file is named after v1.5.3 and its header narrates v1.5.1/v1.5.2 bug history, two minor versions after the fact; the filename implies version-scoped code that is actually permanent.
   **Severity:** Medium
   **Disposition:** Investigate (rename requires builder/test updates — `electron/bootstrap-v153.test.js` pins the name)

5. **Path:** `api/_lib/interview.js:21-25` vs `api/_lib/search.js:18`
   **What it is:** Comment says the search time-box protects against "the search engine's 10s timeout"; `searchWeb`'s actual default is 8000 ms.
   **Severity:** Cosmetic
   **Disposition:** Investigate

6. **Path:** `api/_handler.js:1-2`
   **What it is:** "the api/*.js routes were 9× identical boilerplate" — there are now 12 route files and two of them (`hint-stream`, `providers`) do NOT use this handler.
   **Severity:** Cosmetic
   **Disposition:** Investigate

7. **Path:** `shared/screenContext.js:57`
   **What it is:** "Legacy vision enum for analyzeScreen JSON schema (backward compatible)" — `toLegacyContentType` is not a dormant compatibility shim; it is on the hot path of every analyze-screen response (`api/_lib/interview.js:887`, `shared/screenContext.js:272`). The comment misstates its status.
   **Severity:** Low
   **Disposition:** Investigate

8. **Path:** `src/LiveCompanion.jsx:151-153`
   **What it is:** Comment "legacy Fast/Maximum Quality preferences must not pin sessions" describes a removed UI; the code force-overwrites any stored `modelStrategy` with `'balanced'` on every mount, which also makes the persisted field in old profiles permanently inert (see K).
   **Severity:** Low
   **Disposition:** Investigate

---

## I. Swallowed errors

Method: grep for empty `catch {}`/`catch (e) {}` and `.catch(() => null|{}|undefined)`. Totals: **243** empty-catch sites (incl. tests), **37** silent promise catches in prod code. The dominant population — ~120 `try { win.webContents.send(...) } catch {}`-style guards in `electron/main.cjs`/`bootstrap.cjs` and the `onProviderEvent`/`providerDiagnostic` guards in `api/_lib/core.js` — is deliberate best-effort IPC and is **Keep**. The ones that hide correctness failures:

1. **Path:** `backend/src/routes/auth.js:53` and `:104`
   **What it is:** `await sendVerificationEmail(...).catch(() => {})` — if the email provider fails during signup/resend, the API still returns success; with `REQUIRE_EMAIL_VERIFICATION=1` the user is permanently locked out with no error anywhere (mailer logs only the domain, `mailer.js:29`).
   **Caller distinguish success/failure?** No.
   **Severity:** High
   **Disposition:** Investigate

2. **Path:** `backend/src/store.js:125` and `:145` (plus `:52`, `:66`, `:76` writeChain)
   **What it is:** File-store `persist()` failures swallowed after user mutations — account/plan/usage writes can silently never reach disk (data loss on restart).
   **Caller distinguish?** No — mutation APIs resolve successfully.
   **Severity:** High
   **Disposition:** Investigate

3. **Path:** `electron/main.cjs:330`
   **What it is:** JWT-secret write failure swallowed, returning an in-memory secret → every user session invalidates on next launch. Partially mitigated by the bootstrap guard (D.3) which quits first — but only if bootstrap's own `app.whenReady()` chain (which ends in `.catch(() => {})`, `bootstrap.cjs:35`) didn't itself swallow the failure.
   **Severity:** Medium
   **Disposition:** Investigate

4. **Path:** `api/_lib/apiRoutes.js:144,162,170,185,188,212,215,248,253`
   **What it is:** Managed-mode metering callbacks (`onLlm`, `onLlmFailure`, `onSttRelease`) wrapped in `try {} catch {}` — a failing meter means usage is silently not recorded/released; quota enforcement degrades without trace.
   **Severity:** Medium (availability-over-accounting is plausibly intended, but it is undistinguishable from a bug)
   **Disposition:** Investigate

5. **Path:** `backend/src/routes/billing.js:141`
   **What it is:** Stripe webhook: `findUserById(...).catch(() => null)` — a DB blip during `checkout.session.completed` silently drops the plan upgrade (Stripe will retry the webhook, which masks it — **inferred**).
   **Severity:** Medium
   **Disposition:** Investigate

6. **Path:** `backend/src/routes/billing.js:77`
   **What it is:** `await s.customers.del(customerId).catch {}` — orphaned Stripe customers accumulate silently on account deletion.
   **Severity:** Low
   **Disposition:** Investigate

7. **Path:** `src/main.jsx:16`
   **What it is:** Sentry renderer init `.catch(() => {})` — error reporting itself failing is unreported (acceptable; the alternative is a crash loop).
   **Severity:** Cosmetic
   **Disposition:** Keep

8. **Path:** `src/lib/docs.js:338`
   **What it is:** `ensureIndexed(docs).catch(() => {})` — background embedding indexing failures vanish; RAG silently returns nothing later (downstream `retrieval_timed_out` diagnostics partially cover it).
   **Severity:** Medium
   **Disposition:** Investigate

9. **Path:** `src/auth/AuthGate.jsx:66`
   **What it is:** 12-hourly `refreshSession().catch(() => {})` — token refresh failures surface only when a later API call 401s. Acceptable-by-design pattern.
   **Severity:** Low
   **Disposition:** Keep

10. **Path:** `electron/main.cjs:763`
    **What it is:** `autoUpdater.checkForUpdates().catch(() => {})` on a 6-h interval — update checks can fail forever with no signal (the startup check has telemetry; the interval one does not).
    **Severity:** Low
    **Disposition:** Investigate

---

## J. Magic numbers and arbitrary timings

The repo is better than average here (`shared/liveTiming.js` names the four core streaming deadlines). Remaining unexplained literals:

1. `api/_lib/interview.js:54-55` — history budget `remaining = 24000` chars and window `slice(-13)` turns; no constant, no unit note; nothing else references these values. **Severity:** Medium. **Disposition:** Investigate.
2. `api/_lib/core.js:841` — retry backoff `sleep(800 * (attempt + 1))` vs vision retry `sleep(400 * (attempt + 1))` (`core.js:1078`) — two different backoff bases in one file, neither named. **Severity:** Low. **Disposition:** Investigate.
3. `api/_lib/core.js:1259` — OpenAI SDK `timeout: 9000` sits between the named `LIVE_PROVIDER_ATTEMPT_TIMEOUT_MS` (11 000) and `LIVE_STREAM_STALL_TIMEOUT_MS` (8 000) without a named relationship; if liveTiming changes, 9000 silently stops fitting. **Severity:** Medium. **Disposition:** Investigate.
4. `api/_lib/core.js:156` & `:185` — provider-test aborts at `8_000`; `deepgramToken` fetch at `8000` (`core.js` grant call); `searchWeb` default `8000` (`search.js:18`); `fetchWithTimeout` default `10000` (`http.js:2`). Four adjacent "about 8–10s" timeouts, maintained independently. **Severity:** Low. **Disposition:** Investigate.
5. `src/useDeepgram.js:322` / `src/useSystemAudio.js:548` — fixed 400 ms wake-reconnect delay bypassing the shared `computeReconnectDelayMs` both files import. **Severity:** Medium (drift between declared and actual policy). **Disposition:** Investigate.
6. `electron/bootstrap.cjs:266` — SIGKILL escalation after `1800` ms, unnamed. **Severity:** Low. **Disposition:** Investigate.
7. `src/LiveCompanion.jsx:722` — RAG prefetch debounce `320` ms; `:896` — `100` ms "let the OS register the window". **Severity:** Low. **Disposition:** Keep (`:896` is commented); Investigate `:722`.
8. `src/ApiKeys.jsx:181` — provider test `timeoutMs: 12_000` (server side aborts at 8 000 — a 4 s dead zone where the client waits for a server that already gave up); `:201`/`:219` — 1 200 ms cosmetic sleeps. **Severity:** Medium (the 12s/8s mismatch). **Disposition:** Investigate.
9. `src/auth/AuthGate.jsx:66` — `12 * 60 * 60 * 1000` refresh interval inline; `electron/main.cjs:763` — `6 * 60 * 60 * 1000` update interval inline. **Severity:** Cosmetic. **Disposition:** Keep.
10. `electron/main.cjs:1203` — session-metrics rotation at `2 * 1024 * 1024` vs diagnostics rotation `MAX_FILE_BYTES = 5 * 1024 * 1024` (`electron/diagnostics.cjs:5`) — two JSONL rotation policies, one named, one not. **Severity:** Cosmetic. **Disposition:** Keep (different files); name the 2 MB.
11. `src/lib/docs.js:281` — `PERSISTED_INDEX_BYTE_BUDGET = 4_000_000` (named — good) but `:473` RAG `budgetMs = 2000` default is a bare literal that callers override inconsistently. **Severity:** Low. **Disposition:** Investigate.
12. `api/_lib/core.js` deepgram grant `ttl_seconds: 300` (commented) vs BYOK fallback `expires_in: 3600` — the fallback lies about its lifetime relative to the grant path by 12×. **Severity:** Low. **Disposition:** Investigate.

---

## K. Version and feature-flag debris

1. **Path:** `electron/bootstrap-v153.cjs` (whole file, referenced by `package.json:5`)
   **What it is:** Version-stamped entry filename for permanent code (see H.4).
   **Severity:** Medium. **Disposition:** Investigate.
2. **Path:** `src/lib/accountScope.js:4-14` (`LEGACY_KEYS`) and `:38-70`
   **What it is:** One-time localStorage migration from pre-account-scoping keys (`mm-profile`, `mm-docs-v1`, …) that runs on every app start forever.
   **Evidence:** cited; no sunset mechanism.
   **Severity:** Low. **Disposition:** Keep for now (still migrating v1.4-era installs) — flag for sunset.
3. **Path:** `src/lib/productIntelligence.js:15-30` (`LEGACY_STORAGE_KEYS = ['mm-product-intel-v1']`)
   **What it is:** Same pattern for the PI ring buffer.
   **Severity:** Low. **Disposition:** Keep — flag for sunset.
4. **Path:** `shared/modelRegistry.js:19-20` (`CLAUDE_PREVIOUS`) + `:28-30` literals
   **What it is:** Previous-generation Claude fallbacks and superseded id strings (`gpt-6-sol`, `gemini-3.7-flash`) kept in the priority lists.
   **Severity:** Low. **Disposition:** Keep (explicitly justified for keys that can't reach 5.5) — flag.
5. **Path:** `shared/screenContext.js:57-70` (`toLegacyContentType`) and `shared/retrieval.js:237` (legacy `RELEVANT FROM YOUR DOCUMENTS` format)
   **What it is:** Output/format compatibility shims for prior client versions; the legacy enum is still the primary wire format (H.7), the retrieval legacy format's producers are gone.
   **Severity:** Low. **Disposition:** Investigate (retrieval legacy branch may be removable; screen enum is live).
6. **Path:** `api/_lib/interview.js:98-103`
   **What it is:** "Legacy callers (Solo interviewer, old tests): keep prior dump behavior when no intent passed" — a documented permanent fork on absent classification.
   **Severity:** Low. **Disposition:** Keep (Solo still uses it) — verify Solo now always passes classification.
7. **Path:** `electron/bootstrap.cjs:220-240`
   **What it is:** Updater-handoff ENOENT wait loop for a Windows installer bug observed in v1.5.x.
   **Severity:** Low. **Disposition:** Keep (regression guard with tests).
8. **Path:** `api/_lib/core.js` (deepgramToken tail) — `MOCKMATE_DEEPGRAM_KEY_FALLBACK` BYOK raw-key fallback with triple-condition gating and a "Tighten for production hosted only" DEV NOTE.
   **Severity:** Medium (a raw provider key handed to the client is a standing compat crutch).
   **Disposition:** Investigate.
9. **Path:** `src/lib/aiMode.js:4` — `MANAGED_AVAILABLE` compile-time gate: default `false`, controlled only by release CI (`.github/workflows/release.yml:138`); all managed-mode UI branches are dead code in every local/dev build.
   **Severity:** Low. **Disposition:** Keep (release mechanism) — document.
10. **Path:** `.github/release-request.json:2` (`"tag": "v1.6.2"`), `.github/unsigned-release-request.json:2` (`v1.6.3`)
    **What it is:** Stale release-trigger payloads two versions behind `package.json` 1.6.4.
    **Severity:** Cosmetic. **Disposition:** Keep (they are the workflow trigger mechanism; being "stale" is their resting state).
11. **Path:** `shared/interviewClassify.js:10` — `CLASSIFIER_VERSION = 'classify_v3_live_followups'` / `api/_lib/playbooks.js:5` — `'playbooks_v2'` / `shared/screenContext.js` `SCREEN_CONTEXT_VERSION` — version strings are fine, but nothing anywhere compares versions; they are emitted into diagnostics only. **Severity:** Cosmetic. **Disposition:** Keep.
12. Playbooks not in `PLAYBOOK_BY_KEY` but present in tests: **none found** (all 16 keys are in the dict; the dead artifact is the ordering array, B.1).

---

## L. Test debris

`.skip` / `.only` / `xit` / `xdescribe`: **none found.** Commented-out tests: **none found.** Tests that assert nothing: none found (sampled).

1. **Path:** `src/lib/deepgramTokenCache.test.js:3`
   **What it is:** Test file named after a module (`deepgramTokenCache`) that does not exist; it tests `./deepgramTransport`.
   **Evidence:** `import { clearDeepgramTokenCache, requestDeepgramToken } from './deepgramTransport'`.
   **Severity:** Low. **Disposition:** Investigate (rename).
2. **Path:** `src/lib/managedSttGateway.test.js:2-3`
   **What it is:** Same-name collision with `backend/src/managedSttGateway.test.js` while testing a *different* module (`deepgramTransport`, client side) — two files named `managedSttGateway.test.js` covering different code.
   **Severity:** Low. **Disposition:** Investigate (rename).
3. **Path:** `shared/classificationAuthority.test.js:3-9`
   **What it is:** By its own comment a "thin re-test of the shared rule" — overlapping coverage with `shared/interviewClassify.test.js` under a different name.
   **Severity:** Cosmetic. **Disposition:** Investigate (fold into interviewClassify tests).
4. **Path:** `electron/pill-window-geometry.test.js:11-25` (pattern also in `update-signing.test.js`, `updater-feed-suppression.test.js`, `bootstrap-v153.test.js`)
   **What it is:** Tests that grep the production source for literal strings/comments (`expect(main).toContain('A pill remains a pill while it is repositioned')`) — a comment edit breaks the suite; deleting debris comments (category E) will trip these.
   **Severity:** Medium (this is why some debris can't be deleted blindly)
   **Disposition:** Keep (they are intentional regression pins) — but they must be updated in lockstep with any cleanup.
5. **Path:** `src/ApiKeys.render.test.js`
   **What it is:** The only test using a `.render.test.js` double-suffix; every other file is `*.test.js`.
   **Severity:** Cosmetic. **Disposition:** Keep.
6. Fixture files: `evals/questions.json` is consumed by `evals/run.mjs`; `arch/mockmate.abl.json` by `backend/src/abl.js`. **No orphan fixtures found.**

---

## M. Debug and logging leftovers

1. **Path:** (repo-wide) — 22 `// eslint-disable-*` comments (list: `src/ApiKeys.jsx:166`, `src/App.jsx:354,825`, `src/Jobs.jsx:274`, `src/LiveCompanion.jsx:241,776,879,1238,1310,1651,1697,1771,1823`, `src/Room.jsx:168,189,257,288`, `src/Solo.jsx:128,264`, `src/WhatsNew.jsx:64`, `src/useDeepgram.js:218`, `src/useSystemAudio.js:412`)
   **What it is:** Directives for a linter that does not exist — there is no `.eslintrc*`/`eslint.config.*` anywhere in the repo and no eslint devDependency.
   **Evidence:** `ls .eslintrc* eslint.config.*` → nothing; `package.json` devDependencies contain no eslint.
   **Severity:** Low (22 inert comments; or the real finding is the missing linter)
   **Disposition:** Keep (owner-confirmed dev aid — likely serves an editor-level linter)
2. **Path:** `src/LiveCompanion.jsx:909` and `:1796`
   **What it is:** `console.log('[MockMate] Screen protection confirmed on hints window', result.id)` — debug confirmation shipped in the production renderer (behind an eslint-disable for a linter that isn't there).
   **Severity:** Low. **Disposition:** Keep (owner-confirmed dev aid).
3. **Path:** `electron/main.cjs:290` / `:360`
   **What it is:** Child-process stdout piped wholesale to `console.log('[API]', ...)` / `('[backend]', ...)` — every server log line duplicated into the Electron main console in production.
   **Severity:** Low. **Disposition:** Keep (owner-confirmed dev aid).
4. **Path:** `backend/src/mailer.js:24`
   **What it is:** `console.log(`[${tag}] link for ${to}: ${link}`)` — prints live verification/reset links to stdout when RESEND is not configured. Owner-confirmed dev aid for local testing. Residual caveat: nothing restricts it to dev, so a hosted deploy that loses its RESEND key starts logging auth tokens.
   **Severity:** Low in dev (High only if hosted without RESEND)
   **Disposition:** Keep (owner-confirmed dev aid) — optionally gate on NODE_ENV for hosted
5. **Path:** `api/_lib/core.js:34`
   **What it is:** Hosted-mode diagnostics printed as raw JSON to stdout only when `MOCKMATE_HOSTED === '1'` — but the backend's own `.env.example` sets `MOCKMATE_HOSTED=1` while other code accepts `'true'` (F.4), so a `MOCKMATE_HOSTED=true` deploy silently loses all provider diagnostics.
   **Severity:** Medium. **Disposition:** Investigate.
6. **Path:** emitted-but-unconsumed diagnostics
   **What it is:** Of ~52 distinct diagnostic event names (39 renderer + 13 provider), the only programmatic consumers are `scripts/session-report.mjs` (~12 names: `attempt_*`, `request_usage`, `question_committed`, `stt_*`, …) and `scripts/soak-metrics.mjs`; events such as `embedding_started/succeeded/failed`, `model_discovery_completed`, `all_providers_cooling`, `thinking_setting_rejected`, `model_quarantined` are written to JSONL and read by no tool — human-export-only.
   **Evidence:** grep of event names across `scripts/` and `src/`.
   **Severity:** Low (export-for-support is a stated goal in `docs/DIAGNOSTICS.md`)
   **Disposition:** Keep — but the unconsumed set should be the first candidates when trimming event volume.
7. **Path:** `src/App.jsx:941` — `<ProductIntelligencePanel />` and its `/api/arch` fetch (`src/components/ProductIntelligencePanel.jsx:22`)
   **What it is:** The only consumer of the entire arch-metrics surface (`recordArchMetric` → `performanceSnapshot` → `/api/arch`); a settings-panel dashboard for a single-user app.
   **Severity:** Low. **Disposition:** Keep (functional) — noted because it is the sole reader of ~20 metric call sites.
8. `debugger` statements: **none found.** `MOCKMATE_DEBUG_VISION` (`core.js:1008,1094`): has live log lines — not debris.

---

## N. Deprecated API usage

1. **Path:** `server.js:79`
   **What it is:** `rateLimit({ ..., max: 120, ... })` — `max` is the deprecated option name in express-rate-limit ≥ v7 (dependency is `^8.7.0`); the backend already migrated to `limit` (`backend/server.js:104`).
   **Evidence:** express-rate-limit v7 changelog deprecates `max` in favor of `limit`; both spellings in the same repo.
   **Severity:** Low
   **Disposition:** Investigate (one-word change)
2. **Path:** `src/ErrorBoundary.jsx:5`
   **What it is:** The one class component (`extends React.Component`) in a hooks codebase.
   **Evidence:** React still requires class components for error boundaries (no hook API as of React 19).
   **Severity:** Cosmetic
   **Disposition:** Keep (platform requirement)
3. Node legacy APIs (`new Buffer`, `fs.exists`, `String.prototype.substr`, callback-only fs): **none found** (repo-wide grep).
4. `useEffect` cleanup on subscriptions: sampled the subscription-heavy files (`useDeepgram.js`, `useSystemAudio.js`, `AuthGate.jsx:66` interval, `Dashboard.jsx:574`); all intervals/listeners observed have cleanups except the fire-and-forget one-shot promises already covered in I. No concrete missing-cleanup finding provable by grep — **none found** (static-analysis limit noted).

---

## O. Leftover experimentation

1. **Path:** `vite.config.js:13-27` + `journey-preview.html` + `src/journey/JourneyPreview.jsx`
   **What it is:** `MOCKMATE_JOURNEY_PREVIEW=1` dev-middleware that rewrites `/` to a design-review harness; its flag is documented nowhere.
   **Severity:** Low. **Disposition:** Keep (owner-confirmed dev/testing harness).
2. **Path:** `backend/src/abl.js` + `arch/mockmate.abl.json` + `backend/src/arch.js` (lanes/funnels/adaptivePolicies)
   **What it is:** An "architecture-by-language" runtime (ABL) that compiles a JSON spec into reasoning-lane routing, circuit cooldowns, telemetry allowlists and PI funnels. It IS wired (`server.js:11` `reasoningPolicy`, `apiRoutes.js:70-80`), but half its surface (server-side product events C.4, `reasoningLane` export, funnels) has no production producer/consumer — scaffolding for an adaptive system that only partially shipped.
   **Severity:** Medium
   **Disposition:** Investigate (decide: finish the loop or prune to the used subset)
3. **Path:** `backend/src/routes/auth.js:167-221` (Google OAuth) + `src/auth/api.js:176` (`startGoogleAuth`, unused)
   **What it is:** Complete server-side Google sign-in flow (4 env vars, redirect handling, audience check) whose client entry point is exported but never rendered — a feature that shipped exactly half-way.
   **Severity:** Medium
   **Disposition:** Investigate
4. **Path:** `src/lib/aiMode.js:4` (`VITE_MANAGED_AI_AVAILABLE`)
   **What it is:** Feature gate defaulting off with no runtime toggle — only release CI can flip it (see K.9). In-dev, every managed-mode branch is an untestable variant.
   **Severity:** Low. **Disposition:** Keep — document.
5. **Path:** `backend/src/routes/billing.js` + `backend/src/plans.js` + `src/Account.jsx` upgrade UI
   **What it is:** Full Stripe billing stack in a repo whose README positions it as BYOK; functional, env-gated, not debris per se — but `reconcileBilling` (B.5) shows the client-side loop was never closed.
   **Severity:** Low. **Disposition:** Keep.
6. A/B scaffolding with one variant: **none found.** Old prompt variants alongside current ones: the only one is the dead `PLAYBOOKS` ordering array (B.1); playbook `*_v1/_v2` version tags are data, not alternates.

---

## P. Prompt/config junk (MockMate-specific)

1. **Path:** `api/_lib/playbooks.js:85-89` — `PLAYBOOK_BY_KEY.customer_scenario`
   **What it is:** Playbook reachable only via `pickPlaybookKey('customer_scenario', …)`, but `classifyTurn` never emits questionType `customer_scenario` (it emits `sales_roleplay`); the CS/CSM playbook is unreachable through live routing.
   **Evidence:** `shared/interviewClassify.js` — `'customer_scenario'` appears only in anchor checks (:111), contextNeeds (:200), and the pickPlaybookKey case (:235); never assigned.
   **Severity:** Medium
   **Disposition:** Investigate (either add an emitting rule or delete the playbook)
2. **Path:** `shared/interviewClassify.js:243` — `operations_process` unreachable for program managers (C.1 cross-ref). **Severity:** High. **Disposition:** Investigate.
3. **Path:** `api/_lib/playbooks.js:104-121` — dead `PLAYBOOKS` array (B.1 cross-ref). **Disposition:** Delete safe.
4. **Env vars read by code, documented nowhere** (not in `.env.example`, `backend/.env.example`, or any `docs/*.md`): `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `DESKTOP_REDIRECT` (`backend/src/routes/auth.js:167`), `JWT_EXPIRES`, `RESET_FROM`, `RESET_URL_BASE` (`auth.js:142`), `PASSWORD_RESET_ENABLED` (`hostedConfig.js:66`), `SENTRY_DSN` (`server.js:15`), `EVAL_JUDGE_MODEL` (`evals/run.mjs`), `MOCKMATE_ABL_PATH` (`backend/src/abl.js`), `MOCKMATE_BACKEND_PORT`, `MOCKMATE_DATA_DIR` (`backend/server.js:25`), `MOCKMATE_MANAGED` (`core.js:566`), `MOCKMATE_JOURNEY_PREVIEW` (`vite.config.js:12`), `MOCKMATE_DEBUG_VISION`, `MOCKMATE_DEEPGRAM_KEY_FALLBACK`, `LLM_STREAM_TIMEOUT_MS`, `LLM_STREAM_STALL_TIMEOUT_MS` (`core.js:1236-1237`), `VISION_API_KEY`/`VISION_BASE_URL`/`VISION_MODEL`, `GROQ_VISION_MODEL` (`core.js:920-935`), `EMBED_MODEL`/`OPENAI_EMBED_MODEL`/`GEMINI_EMBED_MODEL` (`core.js:1420-1427`), `MOCKMATE_REQUIRE_DRY_RUN`, `MOCKMATE_SMOKE_CDP_URL`, `TRUST_PROXY_HOPS` (documented in backend example only), `SOAK_MS`, `PROVIDER` (scripts).
   **Count:** 29 undocumented-but-read variables.
   **Severity:** Medium (the vision-override trio and the stream-timeout pair are user-serviceable knobs nobody can discover)
   **Disposition:** Investigate (document or delete the knob)
5. **Env vars documented but never read:** none found — every uncommented key in both `.env.example`s has a reader (the `X_MODEL` overrides are read indirectly via `modelRegistry.js` `envOverrides` + `configuredModel`, verified).
6. **Path:** `shared/modelRegistry.js:121-127` — `CURRENT_MODELS` regexes allow ids absent from the catalog (`gemini-3.7-flash`, `qwen/qwen3.8-27b`, `zai-glm-4.7`) while `MODEL_PRIORITIES` omits `groq`/`cerebras` entirely (they route via `pickFastProvider` hardcodes `core.js:224-225` and the fallback order list `core.js:666`). Three partially-overlapping model-eligibility surfaces.
   **Severity:** Medium. **Disposition:** Investigate.
7. **Prompt templates > 500 chars with no call sites:** none — all large prompt blocks in `interview.js`/`core.js`/`evals/run.mjs` are reachable; the unreachable prompt content is exactly the `customer_scenario` playbook (P.1).
8. **Classifier regexes matching nothing:** not statically determinable except via P.1/C.2 (types never emitted); regex-level liveness **not determinable** — stated per rules.

---

## Q. Redundant abstractions

1. **Path:** `shared/id.js:8-10` — `createSessionId(prefix = 's')` is `nid(prefix, 6)` with `nid`'s own default; a wrapper that only renames.
   **Severity:** Cosmetic. **Disposition:** Investigate.
2. **Path:** `backend/src/arch.js:238` — `publicCapabilityStatus(options) { return resolveCapabilities(options) }` — exported alias wrapper.
   **CORRECTION (post-audit verification):** the alias IS used — `backend/server.js:18,115` imports it for `GET /arch/capabilities`. The original "zero external callers" claim was wrong. The residual finding is only that two names exist for one function.
   **Severity:** Cosmetic. **Disposition:** Keep.
3. **Path:** `src/lib/interviewConfig.js:5-7` — imports `CUSTOM_INSTRUCTIONS_PACK_MAX/STORE_MAX` from `shared/interviewConfig.js` and immediately re-exports them, so two module paths serve the same constants (`shared/customInstructions.js` imports from one, UI files from the other).
   **Severity:** Low. **Disposition:** Investigate.
4. **Path:** `server-entry.cjs:1-10` and `backend/server-entry.cjs:1-10` — twin 10-line CJS→ESM trampolines.
   **Severity:** Cosmetic. **Disposition:** Keep (Electron `fork()` requires CJS entries; comment explains it).
5. **Path:** `api/_lib/playbooks.js:123-125` — `getPlaybook(key)` = dictionary lookup with default; borderline, but it is the single entrenchment point for the fallback rule. **Disposition:** Keep.
6. **Path:** `src/lib/keyStatus.js` (17 lines) — micro-module used by `ApiKeys.jsx` only; candidate to live in its consumer. **Severity:** Cosmetic. **Disposition:** Keep (pairs with `keyStatus.test.js`).

---

## R. File-level inconsistency

1. **Path:** `shared/interviewConfig.js` vs `src/lib/interviewConfig.js`
   **What it is:** Two files with identical names, different contents (budget constants vs config builder), both imported by the same consumers (`LiveCompanion.jsx`, `Solo.jsx`, `history.js`).
   **Severity:** Medium (every import site must be read carefully to know which one is in play)
   **Disposition:** Investigate
2. **Path:** `shared/productIntelligence.js` vs `src/lib/productIntelligence.js` — same name, different roles (pure summarizer vs localStorage ring buffer). **Severity:** Low. **Disposition:** Investigate (rename client one e.g. `productIntelligenceStore`).
3. **Path:** `backend/src/managedSttGateway.test.js` vs `src/lib/managedSttGateway.test.js` — same test filename, different subjects (L.2 cross-ref). **Disposition:** Investigate.
4. **Path:** `server.js` + `server-entry.cjs` (root) vs `backend/server.js` + `backend/server-entry.cjs` — two servers with identical filenames in a repo where "the server" is ambiguous by design (local BYOK vs managed). **Severity:** Low. **Disposition:** Keep (documented split) — naming only.
5. **Path:** `arch/` — a folder containing exactly one file (`mockmate.abl.json`), name-colliding with `backend/src/arch.js`. **Severity:** Cosmetic. **Disposition:** Investigate (move the spec next to `abl.js`).
6. **Path:** `src/components/ui/` — a folder whose entire contents are dead (A.1-5). **Disposition:** Delete safe.
7. **Path:** `src/lib/ui.js` vs `src/lib/secondaryUi.jsx` vs `src/auth/ui.jsx` — three "ui" modules with unrelated contents (score colors / secondary widgets / auth form primitives). **Severity:** Cosmetic. **Disposition:** Investigate.
8. **Path:** `electron/bootstrap.cjs` vs `electron/bootstrap-v153.cjs` — two "bootstrap" files where the versioned one is the real entry and the unversioned one is a library it loads; reverse of the naming a reader expects. **Severity:** Low. **Disposition:** Investigate (pairs with H.4).
9. **Path:** `logs/` — a tracked folder existing only to hold one stale log (A.8). **Disposition:** Delete safe.
10. **Path:** `PLAYBOOKS` name collision across `api/_lib/playbooks.js:104` (array) and `api/_lib/interview.js:282` (re-exported dict) — same exported identifier, two shapes, zero importers of either. **Disposition:** Delete safe (both, per B.1/B.2).

---
---

# Summary

## 1. Total counts per category

| Cat | Name | Findings |
|-----|------|----------|
| A | Dead files | 10 (8 deletable files + 2 keep/investigate) |
| B | Dead exports | 11 (plus ~20 test-only exports noted as Keep) |
| C | Dead code within files | 7 |
| D | Duplicate implementations | 11 |
| E | Vibe-coding residue | 10 (≈25 individual comment sites) |
| F | Inconsistent patterns | 6 pattern families (≈1,000 affected sites for styling alone) |
| G | Unused dependencies | 13 (9 removable packages) |
| H | Comment-reality drift | 8 |
| I | Swallowed errors | 10 highlighted of 243 empty-catch / 37 silent-catch sites |
| J | Magic numbers / timings | 12 |
| K | Version & flag debris | 12 |
| L | Test debris | 6 |
| M | Debug/logging leftovers | 8 |
| N | Deprecated API usage | 2 (2 categories verified clean) |
| O | Leftover experimentation | 6 |
| P | Prompt/config junk | 8 (incl. 29 undocumented env vars) |
| Q | Redundant abstractions | 6 |
| R | File-level inconsistency | 10 |
| **Total** | | **≈156 findings** |

## 2. Top 20 by severity

1. **I.1** `backend/src/routes/auth.js:53,104` — verification email failures swallowed; users silently locked out. (High)
2. **M.4** `backend/src/mailer.js:24` — auth links printed to stdout when RESEND is unset. (Owner-confirmed dev aid; High only for a hosted deploy without RESEND)
3. **I.2** `backend/src/store.js:125,145` — file-store persistence failures swallowed; silent data loss. (High)
4. **D.3 / I.3** `electron/bootstrap.cjs:19` vs `electron/main.cjs:326` — duplicated JWT-secret logic; the surviving legacy copy reintroduces the exact ephemeral-secret bug the new copy exists to prevent. (High)
5. **C.1 / P.2** `shared/interviewClassify.js:35/243/355` — `customer_management` vs `program_management` mismatch; ops playbook unreachable for PM roles. (High)
6. **D.1** `api/_lib/apiRoutes.js:232` vs `api/hint-stream.js:1` — hint-stream endpoint implemented twice, already divergent. (High)
7. **D.5 / J.5** `src/useDeepgram.js` vs `src/useSystemAudio.js` — duplicated reconnect/suspend state machines, drifted. (High)
8. **A.1-6** `src/components/ui/*` + `src/lib/cn.js` — dead UI kit with broken imports anchoring 5 unused dependencies. (High)
9. **A.7 / D.6** `src/index.css` — dead, drifted duplicate of the live stylesheet. (High)
10. **B.3 / C.5** `src/Dashboard.jsx:327` — ~200-line exported component with zero importers. (High)
11. **F.1** Styling: 5 coexisting systems; Tailwind stack carried for 2 class names. (High)
12. **G.1-9** 9 removable npm packages (4 with zero imports, 5 anchored only by dead files). (Medium→High in aggregate)
13. **H.3** `.env.example:44-49` — documented Anthropic overrides pin users to a superseded model generation. (Medium)
14. **P.1** `api/_lib/playbooks.js:85` — `customer_scenario` playbook unreachable via routing. (Medium)
15. **C.3 / H.2** `api/_lib/core.js:1062` — `/* continue failover */` above a `break`; vision quota never fails over. (Medium)
16. **I.4** `api/_lib/apiRoutes.js:144-253` — metering callbacks swallowed; managed quota enforcement can silently degrade. (Medium)
17. **M.5 / F.4** `MOCKMATE_HOSTED` parsed with different truth tables (`'1'` vs `'1'|'true'`) across core.js/arch.js/apiRoutes.js. (Medium)
18. **J.8** `src/ApiKeys.jsx:181` client 12 s timeout vs server 8 s abort for the same provider test. (Medium)
19. **O.3 / B.6** Google OAuth: server flow complete, client entry (`startGoogleAuth`) never wired. (Medium)
20. **A.8** `logs/server.log` — committed runtime log with developer's absolute path. (Medium)

## 3. Delete now (disposition: Delete safe)

- `src/components/ui/Badge.jsx`, `Button.jsx`, `Card.jsx`, `Input.jsx`, `Separator.jsx` (A.1-5)
- `src/lib/cn.js` (A.6)
- `src/index.css` (A.7)
- `logs/server.log` (+ ignore `logs/`) (A.8)
- `api/_lib/playbooks.js:104-121` `PLAYBOOKS` array (B.1)
- `api/_lib/interview.js:282` `PLAYBOOK_BY_KEY as PLAYBOOKS` re-export (B.2)
- `src/auth/api.js:130` `completeEmailVerification` (B.4)
- `shared/delivery.js:109` `fillerRating` (B.7)
- `src/lib/interviewKits.js:169` `currentKitOwnerScope` (B.8)
- `backend/src/documentDraft.js` `_clearDocumentChunkCacheForTests` (B.9)
- npm: `@radix-ui/react-label`, `@radix-ui/react-scroll-area`, `@radix-ui/react-select`, `lucide-react`, `@radix-ui/react-separator`, `@radix-ui/react-slot`, `class-variance-authority`, `clsx`, `tailwind-merge` (G.1-9)
- `vite.config.js:44` `vendor-html2canvas` chunk rule (G.10)
- ~~`backend/src/arch.js:238` `publicCapabilityStatus` alias (Q.2)~~ — RETRACTED: used by `backend/server.js:115`

## 4. Investigate first (unclear blast radius)

- Hint-stream duplication and the 5× public-deploy guard (D.1, D.2)
- JWT-secret duplicate in `main.cjs` (D.3) — touch order with bootstrap matters
- `useDeepgram`/`useSystemAudio` unification (D.5) — live-audio hot path
- `DashboardHome` (B.3) — large, verify no dynamic reference
- `reconcileBilling`/`startGoogleAuth` + server halves (B.5, B.6, O.3) — delete or finish
- Classifier dead branches & role-family mismatch (C.1, C.2, P.1, P.2) — behavior-affecting
- Vision quota failover no-op (C.3/H.2) — possible live bug
- Server-side product-event buffer (C.4/O.2) and ABL surface pruning
- All swallowed-error entries I.1-I.6, I.8, I.10
- Timeout/magic-number alignments (J.1, J.3, J.5, J.8)
- Env-flag parsing unification (F.4/M.5); error-shape unification (F.5); `max`→`limit` (N.1)
- 29 undocumented env vars (P.4); `.env.example` Anthropic drift (H.3)
- Styling-system decision (F.1/G.13); palette source of truth (D.7)
- Renames: `bootstrap-v153.cjs` (H.4 — string-pinned by tests L.4), misnamed test files (L.1-2), same-name module pairs (R.1-3), `arch/` folder (R.5)
- E.1 only: user-visible 'TODO' pill text (JourneyScreens.jsx:863-866)
- `package.json` overrides pins (G.11); legacy localStorage migrations sunset (K.2, K.3); retrieval legacy format (K.5); Deepgram raw-key fallback (K.8)

## 5. Leave alone (looks like debris, has a reason)

- `mobile/scripts/validate-build-env.mjs` — EAS lifecycle hook (A.10)
- `_*ForTests` exports — explicit test seams (B.11)
- `CLAUDE_PREVIOUS` + superseded-id fallbacks — documented discovery-time safety net (C.6/K.4)
- `server-entry.cjs` twins — Electron fork() requires CJS (Q.4)
- `GET /api/models` rewrite on Vercel — function-count constraint (D.9)
- Electron best-effort `catch {}` around IPC/window calls — deliberate pattern (I preamble)
- `.github/*release-request.json` staleness — that is how the trigger mechanism rests (K.10)
- String-pinning electron tests — intentional regression pins, but they couple cleanup to test edits (L.4)
- `ErrorBoundary` class component — React requires it (N.2)
- `VITE_MANAGED_AI_AVAILABLE` CI-only gate — release mechanism (K.9/O.4)
- `LP-20` autopsy comment — documents a real guarded regression (E.6)
- Diagnostics events without tool consumers — support-export is their stated purpose (M.6)
- `updater-handoff` ENOENT wait (K.7) and `bootstrap-v153` guards — tested Windows regression armor
- **Owner-confirmed dev/testing aids (reclassified post-audit):** eslint-disable comments (M.1), debug console.logs (M.2, M.3), mailer link logging (M.4, dev mode), planning-marker comments (E.2–E.9), journey preview harness (A.9/O.1), MOCKMATE_DEBUG_VISION, verify-* scripts

## 6. Codebase metrics

**Files by type** (excluding `node_modules`, `.git`; 394 files total):
js 222 · md 40 · jsx 33 · mjs 22 · json 14 · cjs 9 · yml 7 · html 7 · woff2 6 · png 5 · ts 4 · tsx 3 · css 3 · txt 3 · srt 2 · ps1 2 · misc 12

**Lines by type** (excluding package-locks):
js 25,407 · jsx 12,312 · md 7,769 · cjs 2,171 · mjs 1,513 · tsx 684 · html 543 · json 523 · ts 380 · css 339 — **≈51,600 total**

**Dependencies:** 30 production / 9 dev (root `package.json`); plus separate `backend/` and `mobile/` manifests. 9 of 30 prod deps are removable (G).

**Tests:** 104 test files; ≈668 `it()/test()` cases (desktop suite; mobile adds 1 more file). 0 skipped, 0 focused.

**Environment variables referenced:** 67 distinct `process.env.*` reads in non-test code, plus ~18 reached indirectly (`envOverrides` in `modelRegistry.js`, `envFlag()` in `hostedConfig.js`) → **≈85 total; 29 undocumented** (P.4).

**Diagnostic events emitted:** ≈52 distinct named events (39 renderer `diagnostic()` + 13 server `providerDiagnostic()`), plus electron-main lifecycle events and ~20 `recordArchMetric` series.

**Diagnostic events actually consumed by tooling:** ≈12-15 event names (`scripts/session-report.mjs`, `scripts/soak-metrics.mjs`) plus the arch metric series read solely by `/api/arch` → `ProductIntelligencePanel`. Everything else is write-only until a human exports the JSONL.
Diagnostic events actually consumed by tooling:** ≈12-15 event names (`scripts/session-report.mjs`, `scripts/soak-metrics.mjs`) plus the arch metric series read solely by `/api/arch` → `ProductIntelligencePanel`. Everything else is write-only until a human exports the JSONL.
