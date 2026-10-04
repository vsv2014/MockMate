# PR #45 Blast-Radius Review

**Audit provenance (explicit):**
- Audit code snapshots: `17f80bc` (first full pass) and `4d3f0e3` (document audit pass).
- Reviewer findings BR-3…BR-10 raised against `4d3f0e3`; fixed in `6542071`.
- Reviewer re-review of `6542071` confirmed those fixes, found the RAG stale-index race
  (BR-11) and the dead cache-warning path; both fixed in `99fbb34`, which also hardened
  BR-1's regression test to derive from production modules.
- Reviewer re-review of `98b14fc` raised BR-12 (email-verification signup contract),
  BR-13 (managed STT quota enforcement) and BR-14 (PiP capture-protection confirmation);
  all three fixed in `def4f02`, together with the missing `verify.html` page and the
  fail-fast hosted-config guard.
- Reviewer re-audit of `1a6adbe` found BR-13's lease accounting was not atomic
  (concurrent overrun + swallowed usage-write errors) and that the new test harness
  broke Node HTTP teardown in CI; fixed in `8a2b89f` — atomic
  `reserveSttUsage`/`releaseSttUsage` mirroring the LLM reserve/release pattern,
  lease reserved BEFORE minting and released on mint failure, and the
  fabricated-request test helpers replaced with real ephemeral HTTP servers.
- Repo-owner follow-ups `b6494a9` + `b187d8a` closed the remaining upload-path gap:
  `/transcribe` now reserves the **server-probed** media duration atomically before
  Deepgram spend (with release/top-up settlement), covered by dedicated tests; the
  read-only `checkSttQuota` gate was deleted as dead code in `ec4f95d`.
- Final full-branch review (all 131 files against `main`) raised BR-15: the release
  workflow's stale v1.5.1 wiring. Fixed in the commit shipping with this revision by
  making `release.yml` version-generic, together with the Mongo release-clamp fix and
  watchlist items BR-W6 (pre-existing freePort debt) and BR-W7 (unverified Vercel
  failure cause).
- PR snapshot at last revision: 38 commits, 115+ files, +7,212/−1,593 and growing.

**Method:** enumerate every changed surface → map dependents (fan-in) → check deleted-file
references, export-contract stability, storage/env contracts, failure swallowing, and
test coverage of changed code. Findings are rated by how far a failure would travel.

---

## 1. Subsystem blast-radius map

| Subsystem | Changed | Fan-in / exposure | Failure mode if it breaks | Radius | Rating |
|---|---|---|---|---|---|
| `shared/*` logic (22 files) | questionCapture, hintLayers, retrieval, transcriptBuffer, interviewState, generationManager, PI analyzer, +9 new modules | 1–11 importers each; run in browser + Express + Vercel | wrong answers / dead pipelines everywhere at once | **HIGH** | ✅ contracts backward-compatible, tested |
| `electron/main.cjs` + `bootstrap.cjs` | shortcuts, modes, capture, teleprompter, **global navigation policy** | single desktop shell; navigation policy is cross-subsystem (auth OAuth, Jobs links, billing) | overlay/shortcut/capture misbehavior; blocked OAuth/job URLs | **HIGH** | fixed BR-3; packaged smoke required (BR-8) |
| `api/_lib/*` (shared Express+Vercel) | apiRoutes registry, core RAG, interview, jobs | BOTH server shapes consume the same files | a bug ships to local AND hosted simultaneously | **HIGH** | ✅ smoke-tested; public-API default-deny intact |
| Billing/metering (`meter.js`, `plans.js`, `billing.js`, `store.js`) | unit-based metering, 413 input guard, reconcile endpoint, **STT lease enforcement** | every authenticated paid-path request incl. streaming STT grants | over/under-charging quota; unbilled provider cost | **HIGH** (money path) | fixed BR-1 + BR-13; single source of truth |
| STT transport (`deepgramTransport` new, `useSystemAudio`, `useDeepgram` refactored onto it) | reconnect, PCM queue, Turn-1 Finalize | both mic and system Live; **first seconds of every system-audio interview** | transcription loss; false Turn-1 commits | **HIGH** | fixed BR-5 (opener-only boost, negative tests) |
| RAG/embeddings (`src/lib/docs.js`, `api/embed.js`, retrieval) | fingerprint-bound cache, speculative pre-warm, **persistent chunk-text cache** | Solo + Live grounding; **privacy lifecycle: deleted/replaced/account-purged docs must never be re-persisted** | stale vectors; deleted resume text resurrected in localStorage | **HIGH (privacy lifecycle)** | fixed BR-4 + BR-9 + **BR-11** (stale-index race), all tested |
| Desktop auth token persistence | `auth-set-token` IPC + renderer `setToken` | signup/login/refresh/OAuth → all authenticated desktop APIs | disk failure misread as successful login | **HIGH** | fixed BR-6 (`{ok:false}` surfaced) |
| Auth signup contract (desktop + mobile + hosted config) | verification-required response union, Check-your-email state, `verify.html`, boot-time prerequisite guard | every new hosted account | broken signup / locked-out accounts / undefined-token sessions | **HIGH** | fixed BR-12 (union + tests + fail-fast config) |
| Jobs/Career | new source adapters + ranker | Jobs/Career pages + **crosses into global navigation policy** for listing links | bad rankings; blocked listing URLs (see BR-3) | MEDIUM→HIGH at the navigation boundary | ✅ after BR-3 fix |
| Custom Prompt Studio + PI panel | templates, presets | additive UI | isolated to feature | LOW | ✅ tested |
| Mobile (6 files) | session domain + UI | private-beta foundation | isolated from desktop release | LOW code-radius | ⚠ was not PR-gated; now gated (BR-7) |
| `vite.config.js` | manual chunk splitting | build only | bundle layout | LOW | ✅ verified by build |
| Docs (10 files) | architecture/release/autopsy | none runtime | n/a | NONE | ✅ (BR-2, BR-10 fixed) |

## 2. Structural containment — verified, not assumed

1. **Deleted files leave zero dangling references.** `src/useSpeech.js`, `backend/src/db.js`,
   `electron/copilot.html`, `electron/preload-copilot.cjs` — grep-verified. Copilot
   mini-window survives via inline data-URL; both BrowserWindow creations use the live
   `preload.cjs`.
2. **Changed export surfaces are backward-compatible.** `retrieval.js` adds optional params
   only; `hintLayers.js` adds `sanitizeSpokenProse`; `questionCapture` adds an optional
   `source` param + `getAudioSource` opt. High-fan-in modules (`interviewClassify` 11
   importers, `screenContext` 6, `interviewState` 5) had **no export-line changes**.
3. **Storage scoping — precise statement.** New user-bound storage keys are namespaced
   through account scope (`mm-*::account`), **and** account deletion purges all scoped
   local artifacts (`purgeScopedStorage()` in `deleteAccount()` — BR-4). Scoping alone is
   not lifecycle safety: the purge path plus the stale-index guard (BR-11) is what makes
   it safe, and all three are unit-tested.
4. **New env vars have safe defaults.** `MOCKMATE_HOSTED` off by default; mail URL vars
   affect hosted auth only; Vercel serverless stays default-deny without
   `MOCKMATE_ALLOW_PUBLIC_API=1`.
5. **`api/_lib` dual-consumption is intentional and smoke-covered.** Express shim and
   Vercel functions share the route registry; `smoke:api` exercises it locally.
6. **External navigation is one policy** (BR-3 fix): an audited `KNOWN_SAFE_HOSTS` tier
   plus a **validated general HTTPS policy** (https-only; http restricted to loopback; no
   credentials; length/hostname sanity). The IPC open-external handler and the
   `shell.openExternal` guard share one validator so they cannot diverge. Non-audited
   destinations are logged for review.

## 3. Findings register

| ID | Finding | Severity | State |
|---|---|---|---|
| BR-1 | Metering ghost route `/api/match-jobs` (never existed → bonus silently never applied); logic also duplicated across `plans.js`/`meter.js` | P1 money-path | ✅ Fixed; deduplicated to single source of truth (`plans.js`); test now derives both sides from production modules (`MULTI_CALL_PATHS` × `OPERATION_BY_PATH`) so the bug class cannot recur silently |
| BR-2 | RELEASE_NOTES described unscoped Finalize + "Closed-Loop" ARCH | P3 docs | ✅ Fixed |
| BR-3 | Global Electron navigation allowlist broke Google OAuth (configured API base) and Jobs listing links (ATS domains unenumerable) | **P1 cross-subsystem** | ✅ Fixed — one shared validator: audited safe-host tier + validated general HTTPS policy |
| BR-4 | Persistent RAG cache retained **original chunk text** of deleted/replaced documents; account deletion did not purge scoped artifacts | **P1 privacy/lifecycle** | ✅ Fixed — purge on remove/replace, `purgeScopedStorage()` on Delete Account, all tested |
| BR-5 | Turn-1 system boost relaxed ALL 2+ word utterances → greetings/pleasantries could commit as questions | **P1 Live** | ✅ Fixed — opener-only predicate (`SYSTEM_TURN1_OPENERS`); 6 negative tests + positive controls |
| BR-6 | Renderer treated `auth-set-token → {ok:false}` as success → fake login on disk/keychain failure | **P1/P2 auth** | ✅ Fixed — result shape validated, `ApiError` thrown |
| BR-7 | Mobile changes not PR-gated (Desktop CI ignores `mobile/**`; mobile workflow dispatch-only) | P2 coverage | ✅ Fixed — PR-triggered secret-free verify job; build job stays dispatch-only |
| BR-8 | No Windows runtime validation in PR CI despite a Windows-dominated change set | P2 release gate | ✅ Partially fixed — `windows-latest` PR job runs the full suite; **packaged-Windows smoke remains a mandatory release gate for THIS PR** (not a future trigger) |
| BR-9 | RAG cache had doc-count eviction only; localStorage quota is byte-based; write failures silent | P2 perf/cost | ✅ Fixed — ~4 MB serialized budget, oldest-first eviction, visible warning + diagnostic on write failure (checks `setScopedItem`'s boolean; its internal catch means the exception path never fired for quota errors) |
| BR-10 | `.env.example` instructed maintainers to embed provider secrets into installers (stale, dangerous) | P2 security/docs | ✅ Fixed — guidance deleted, explicit prohibition added |
| BR-11 | **Stale in-flight indexing race**: `removeDoc`/replace/purge deleted the persisted entry, but an `indexOne()` task already awaiting `/api/embed` later re-persisted the deleted private text | **P1 privacy (merge blocker)** | ✅ Fixed in `99fbb34` — per-doc generation counter + per-task AbortController (cancels the embed request) + post-embed re-validation of generation and document existence/signature before persisting. Regression tests cover delete-before-resolve and replace-before-resolve |
| BR-12 | **Hosted email-verification signup broken**: with `REQUIRE_EMAIL_VERIFICATION=1` the backend returns `{verificationRequired, user}` with **no token**, but desktop/mobile assumed a token and proceeded into session loading; `verify.html` did not exist; hosted mode never required delivery prerequisites | **P1 auth (merge blocker)** | ✅ Fixed — explicit response union in desktop (`signup()` branches, never stores a token on the verification branch, new Check-your-email view + resend) and mobile (`SignupResult` union, `saveAuth` only with a real token); backend contract tests for both branches; `public/verify.html` added; hosted boot **refuses to start** with verification enabled unless `RESEND_API_KEY` + HTTPS `VERIFY_URL_BASE` are configured |
| BR-13 | **Managed STT plan limits advertised but not enforced**: `/api/deepgram-token` used auth-only guarding; streaming audio bypasses the backend, so free-tier `sttSeconds` was effectively unlimited (provider-cost/abuse exposure). Round-6 follow-up: the first lease implementation was not atomic (concurrent overrun + swallowed usage-write errors), and `/transcribe` still used a read-only gate ("1s remaining → upload a long clip" overrun) | **P1 billing (merge blocker)** | ✅ Fixed — both paths now reserve **atomically before provider spend**, mirroring the LLM reserve/release pattern. Streaming: `reserveSttLease` middleware reserves the 300s lease before minting the grant and releases it if mint fails. Uploads (`b6494a9`): the server probes the media duration itself (MP4 `moov`→`mvhd` box walk, RIFF chunk walk — client-supplied durations are never trusted; unprobeable formats get 415) and reserves duration + 2s margin; unused margin is released on success, provider failure, or abort; if provider duration exceeds the reservation the difference is topped up atomically (fail-closed 402, cap never exceeded). The now-dead read-only `checkSttQuota` gate was removed |
| BR-14 | **PiP capture-protection confirmation could target the wrong window**: `bootstrap.cjs`'s hardened `ipcMain.handle` wrapper intercepted `exclude-from-capture` before `main.cjs`'s PiP-aware handler could register, so the confirmation protected the *sender* window while the UI claimed the PiP was protected | **P1/P2 capture protection** | ✅ Fixed — the hardened handler now implements the focused-window-first policy itself and returns both the protected window id and the sender id; the dead `main.cjs` handler is removed; LiveCompanion only confirms PiP protection when the protected window is not the opener, otherwise it shows the honest warning banner |
| BR-15 | **Release automation stale-version dependency**: `package.json` bumped to 1.5.2 but `release.yml` still triggered on `release/v1.5.1` branches, defaulted `workflow_dispatch` to `v1.5.1`, and special-cased that branch in `RELEASE_TAG` — while enforcing `tag === pkg.version`. Default/branch releases of a merged v1.5.2 would have failed (fail-safe, but knowingly broken automation for this release) | **P1 release (merge blocker)** | ✅ Fixed — workflow is now version-generic: tag-push trigger `v*.*.*` only, dispatch tag input required with no default, `RELEASE_TAG = inputs.tag || ref_name`, zero hardcoded versions; the provenance step still enforces tag↔`package.json` equality and main-ancestry. Also fixed while in billing hardening: Mongo `releaseSttUsage`/`releaseLlmUsage` now clamp at zero atomically (the old `$gt:0 + $inc` could drive counters negative = silent free quota; file store already clamped) |

## 4. Watchlist (not blockers)

| # | Item | Contained today by | Revisit when |
|---|---|---|---|
| BR-W1 | 46 new swallow-catches, concentrated in IPC/telemetry glue (`LiveCompanion`, `main.cjs`, `productIntelligence`, `deepgramTransport`) | all wrap optional/telemetry paths; diagnostics breadcrumbs cover the important ones | any "nothing happened" bug report |
| BR-W2 | `src/lib/productIntelligence.js`, `src/lib/windowDrag.js` lack direct tests | logic lives in tested `shared/` modules; collectors are thin glue | before adding non-trivial collector logic |
| BR-W3 | RAG vectors serialized as JSON in localStorage — workable, not ideal | byte budget + re-embed fallback + stale-index guard keep correctness and privacy | storage pressure → IndexedDB |
| BR-W4 | Unit-based metering is user-visible behavior change | intended hardening, tested | announce in support copy |
| BR-W5 | STT lease accounting bills in ≤5-minute grant increments (a user who requests a grant and never streams still spends up to one grant's seconds; failed mints release their lease) | conservative by design; atomic reservation makes the ≤300s overrun bound a guarantee, not an aspiration | per-second client usage reporting if complaints appear |
| BR-W6 | **Pre-existing on `main` (not introduced by this PR)**: dev-server `freePort()` force-kills whatever process owns ports 3002/4000 (`taskkill /F` / `fuser -k` / SIGKILL) without verifying the PID belongs to MockMate, despite the "orphan MockMate child" comment | out of scope for PR #45 — recorded here so it is not lost; dev-machine impact only | separate fix: verify process identity before killing |
| BR-W7 | Vercel: the latest deploy at the reviewed head failed with a generic "Deployment has failed — run `npx vercel inspect`" message; the earlier assumption that all failures were Hobby build-quota is no longer provable from GitHub | Vercel is not the desktop release path; inspection requires repo-owner dashboard/log access | inspect logs (or get one clean deploy) before any hosted release |

## 5. Bottom line

The branch is structurally coherent: deletions are reference-clean, shared export
contracts are additive-only, the dual-shape API layer is smoke-covered, and every
finding in the register above — including the stale-index race (BR-11) and the
round-5 boundary contracts for auth signup, STT billing, and capture-protection
confirmation (BR-12…BR-14) — has a fix with tests.

This document does **not** claim there is no remaining code risk. What it certifies is
narrower: the cross-cutting privacy/lifecycle, navigation, capture, billing, and
auth-state risks identified by five review rounds are resolved in code, and the fixes
are regression-tested. Whether that resolution holds up is for the reviewer's re-pass
to confirm.

After that confirmation, the remaining risk is **release validation**, not architecture:
the packaged-Windows smoke (Alt+T → drag → Alt+T, mic/system first question, F7
monitor repeat), the soak-evidence round, and one verified Vercel deployment (current
deploy failures are flagged in the PR; logs are only visible to the repo owner).
Watchlist item BR-W5: STT lease accounting bills in ≤5-minute grant increments —
deliberately conservative for v1.5.2; per-second client usage reporting is a future
refinement, not a correctness gap.
