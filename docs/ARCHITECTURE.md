# MockMate — Full-Fledged Architecture (v1.5.2, 2026-10-03)

> Desktop-first interview preparation **and** live-performance companion.
> This document is the single source of truth for system structure: ARCH, the Product
> Intelligence subsystem, the Electron desktop shell, the React SPA, the live pipeline,
> the backend (Express + Vercel serverless), the shared module layer, and the mobile
> foundation. See also `docs/ROADMAP.md`, `docs/DUO_PLAN.md`, `docs/audit-remediation.md`.

---

## 1. Layer map

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  CLIENT SURFACES                                                             │
│  Electron shell (Win/macOS overlay + teleprompter) │ React SPA │ Mobile (RN) │
├──────────────────────────────────────────────────────────────────────────────┤
│  FEATURE LAYER (src/)                                                        │
│  Solo practice │ Live Companion │ Duo Room │ Skills/Resume Studio │ Jobs     │
│  Career page │ Documents/RAG │ Custom Prompt Studio │ ARCH PI Panel          │
├──────────────────────────────────────────────────────────────────────────────┤
│  ARCH — Adaptive Runtime Core (arch/ + backend/src/arch.js + abl.js)         │
│  ABL spec → capability resolve → lane routing → executeWithFallback          │
│  (circuit breakers, timeouts, retries) → performance metrics → closed loop   │
├──────────────────────────────────────────────────────────────────────────────┤
│  SHARED LOGIC (shared/) — isomorphic: browser + Node, fully unit-tested      │
│  questionCapture │ hintLayers │ retrieval │ interviewState/Classify │        │
│  resumeFacts │ skillsMatrix │ jobLocation/companyBoards │ productIntel │ …   │
├──────────────────────────────────────────────────────────────────────────────┤
│  BACKENDS                                                                    │
│  Express shim (server.js + backend/src) — local dev & self-host              │
│  Vercel serverless (api/) — hosted production                               │
│  Optional Mongo (sessions/documents) │ Deepgram STT │ LLM providers ×6       │
└──────────────────────────────────────────────────────────────────────────────┘
```

Design laws: (1) **ARCH first** — MockMate is the first consumer of the ARCH runtime,
not the other way round; (2) **privacy by default** — resumes/transcripts/keys never enter
telemetry; (3) **provider portability** — every AI capability degrades gracefully through
BYOK → managed → local fallback; (4) **shared logic isomorphic** — the same modules run in
the renderer, the Express shim, and Vercel functions.

---

## 2. ARCH — Adaptive Runtime Core

ARCH is MockMate's product/runtime intelligence: a declarative behavior specification plus a
runtime that resolves capabilities, routes work to reasoning lanes, executes with resilience
patterns, measures hot paths, and feeds measurements back into routing decisions.

### 2.1 ABL (Architectural Behavior Language) — `arch/mockmate.abl.json`

Declarative contract, validated at load (`backend/src/abl.js#validateAblSpec`):
- `persona` — interview_coach, adaptive, concise/grounded/supportive/evidence_based.
- `capabilities.reasoning.lanes` — `fast | balanced | strong | vision`.
- `capabilities.speech` — STT live/batch modes with `typed-input` fallback; TTS optional
  (local/browser preferred); turn detection = VAD with barge-in; hot path = media-adapter-direct.
- `routing.reasoning` — operation→lane map: `hint/live_hint/autocomplete → fast`,
  `interview → balanced`, `evaluate/report/resume/career → strong`, `screen/vision/coding_screen → vision`.
- `telemetry.metrics` — the only hot-path timings recorded (stt_first_partial_ms, llm_ttft_ms, …).
- `performance.reportPercentiles = [50, 95]`; `asyncOffHotPath` lists work that must never
  block a live turn (persistence, analytics, non-critical RAG updates).
- `policies.credentials = "never_in_abl"` — `rejectSecrets()` fails validation if any key
  even *looks like* a credential.
- Spec is cached by mtime; `MOCKMATE_ABL_PATH` overrides location for tests/embedding.

### 2.2 Runtime (`backend/src/arch.js`)

- `resolveCapabilities()` — inspects env (6 LLM providers, Deepgram, Mongo) and ABL, returns
  capability matrix (`byok` vs `managed` vs `unavailable`) consumed by `/api/arch` and the UI.
- `reasoningPolicy(operation, { adaptive })` — base lane from ABL routing; **adaptive mode
  promotes `balanced → fast` when p95 TTFT ≥ 3.2 s or turn latency p95 ≥ 6 s**
  (`high_latency_guardrail`).
- `executeWithFallback()` — per-provider loop with: circuit breaker (30 s cooldown),
  per-attempt timeout (AbortController race), bounded retries, outer-signal relay,
  provider failover, optional local fallback, and success/failure telemetry. Used today for
  transcription (`executeTranscription`) and available to any capability.
- `recordArchMetric` / `performanceSnapshot()` — bounded (500-sample) percentiles per metric,
  capped to ABL-declared names.
- `archRuntimeSummary()` — the `/api/arch` payload; **hosted mode strips performance +
  product-intelligence sections** so remote deployments expose capability status only.

### 2.3 Product Intelligence subsystem (ARCH · behavioral loop)

Privacy-first behavioral & funnel engine. **Contract: structured, redacted UI flows only —
never resumes, transcripts, prompts, answers, API keys, screenshots, or raw audio.**

```
UI interactions ──► trackProductEvent (src/lib/productIntelligence.js)
                     │ redactInteractionEvent: FORBIDDEN_KEY_RE drops content-like keys,
                     │ allowlists (string/numeric/boolean) keep structural keys,
                     │ sanitizeSlug strips secrets/emails, values slugified+truncated
                     ▼
              localStorage ring buffer  mm-product-intel-v1 (600 events, account-scoped)
                     │ rage-click observer (3 clicks/1.5 s on same control → rage_click)
                     ▼
        summarizeProductIntelligence (shared/productIntelligence.js)
                     │ partitionSessions (explicit sessionId or 30-min gap)
                     │ 3 funnels: live_interview (6 steps), solo_practice (4), screen_solve (3)
                     │ friction: rage targets, retries, error reasons
                     │ feature adoption counters
                     │ headline insights + adaptive actions
                     ▼
        ProductIntelligencePanel.jsx (Dashboard)           backend/src/arch.js
        insights, funnels, opt-in replay switch            archProductIntelligenceSnapshot
        "Apply Fast Mode" → aiSettings + event             (server-side events; see §2.3.1)
```

Key behaviors:
- **Funnels** compute reach/drop-off per session; `login` step auto-fills when any later
  step was reached.
- **Correlations** implemented: preflight stall rate, resize-before-teleprompter,
  slow-TTFT → early abandon (or no session end), playbook-before-Live adoption.
- **Adaptive actions** emitted to the UI: `promote_fast_lane` (actionable — one click applies
  Concise style and records `adaptive_action_applied`), `preflight_guided_unblock`,
  `teleprompter_auto_geometry`, `preferred_coding_tab`.
- `sessionMetrics.js` bridges: `createSessionMetrics('live'|'solo')` emits
  `live_started/live_ended/solo_started/solo_ended` + `first_hint_rendered` (with TTFT) into
  the PI stream while raw timings go to the Electron JSONL store — never transcript text
  (`sanitizeMetric` blocks content-like keys there too).

#### 2.3.1 Known limitations (honest, 2026-10-03 audit)

| # | Item | Status |
|---|---|---|
| PI-1 | Backend `recordArchProductEvent` has no production callers — server-side PI store is dormant; PI is desktop/local-only (consistent with the ZERO-PII · LOCAL posture) | by design / dormant |
| PI-2 | Question dedupe compares only against the **last** committed question — Q1→Q2→Q1 repeats slip through | open, small fix candidate |
| PI-3 | Rage-click target falls back to `title`/`aria-label`, which can carry dynamic values (e.g. company names) — slugified, but meaning survives | accepted risk; prefer `data-pi-target`/`id` for sensitive screens |
| PI-4 | `highTtft` abandon metric counts no-end sessions as abandons; insight wording now says so explicitly | fixed (wording) |
| PI-5 | `startNewProductSession` was dead code | removed 2026-10-03 |

---

## 3. Electron desktop shell (`electron/`)

- `main.cjs` — app lifecycle, dashboard window, **overlay window** (frameless, always-on-top,
  click-through option), **teleprompter window** (Alt+T; camera-anchored geometry), F7 screen
  capture, global shortcuts (Alt+R answer-now, Alt+T teleprompter), session-metrics JSONL
  appender, diagnostics store, auto-update handoff (v1.5.1 ENOENT hotfix).
- `preload.cjs` — minimal `electronAPI` surface: window controls, capture, metrics append,
  diagnostics, update status. No raw IPC leaking into the renderer.
- `bootstrap.cjs` — single-instance lock, path fixups for packaged builds.
- **Screen protection** (Windows/macOS): OS content-protection flags exclude the overlay from
  common screen-share/recording paths. Documented honestly as *partial / verify per meeting
  app*; Linux unsupported. Public builds keep the full safety gate — `shareVerified`,
  `linuxAck`, `protectionTest`, `inElectron` — dev/local-only frictionless paths exist for
  `?app=1` dev flows (PR #45 review correction).
- Builds: electron-builder → NSIS installer (Windows), dmg (macOS arm64/x64), AppImage (Linux).

---

## 4. Frontend SPA (`src/`)

React 18 + Vite, dark neon UI (`src/auth/tokens.js` design tokens), desktop-first layouts.

| Surface | Files | Responsibility |
|---|---|---|
| Dashboard | `Dashboard.jsx`, `WhatsNew.jsx` | hub; hosts ARCH · Product Intelligence panel |
| Solo | `Solo.jsx`, `SoloFeedback.jsx`, `src/lib/sessionGen.js` | practice interviews; strong-lane evaluation reports |
| Live | `LiveCompanion.jsx`, `src/live/*` | overlay/inline live assistance (§5) |
| Duo Room | `Duo.jsx`, `Room.jsx` | paired practice room (see `docs/DUO_PLAN.md`) |
| Skills / Resume Studio | `shared/skillsMatrix.js`, resume views | skill gap matrix, resume editing, LaTeX export |
| Jobs | `Jobs.jsx`, `src/savedJobs.js`, `src/lib/jobsHandoff.js` | 4-source search + seniority/recency-aware ranking (§8) |
| Career | `Career.jsx`, `src/lib/careerDraft.js` | career-page aggregation via Greenhouse/Lever board APIs |
| Documents/RAG | `Documents.jsx`, `src/lib/docs.js` | doc upload, chunking, embeddings, Context Audit Trail |
| Auth | `src/auth/*` | hosted sign-up/sign-in, guest mode, onboarding, JWT session |
| Settings | `ApiKeys.jsx`, `src/lib/aiSettings.js`, `modelPicker.js` | BYOK keys (local), live model discovery, answer style |
| Custom Prompt Studio | `src/components/CustomPromptStudio.jsx` | 6 playbook templates incl. 🛡 Anti-Fail Guardrails (16 forensic rules from `docs/lockedin-failure-patterns.md`), quick snippets |

Client infra: `apiClient.js` (base resolution + dev proxy), `accountScope.js`
(per-account storage namespacing), `diagnostics.js` (structured local log),
`ErrorBoundary.jsx`, `useDeepgram.js` + `deepgramTransport.js` (STT socket lifecycle).

---

## 5. Live interview pipeline (the hot path)

```
Meeting audio (system/loopback mic)
  → Deepgram Nova streaming STT (useDeepgram / deepgramTransport; reconnect + fallback to
    typed input per ABL)
  → shared/questionCapture.js — debounce/stabilize candidate questions, correction marks
    ("actually…"), revision signals, duplicate rejection vs last committed question
  → shared/interviewClassify.js — technical / behavioral / coding / logistical / dsa
  → shared/retrieval.js — RAG over selected documents (mm-docs-index-v1 vectors with
    embedding-provider+model identity validation; stale-vector guard per PR #45 blocker fix)
  → api/hint-stream.js — LLM via ARCH lane (fast for hints), streaming SSE
  → shared/hintLayers.js — stripHintMeta (JSON/META leaks), ensureCodingCodeBlock,
    sanitizeSpokenProse (AI-preamble strip, jargon rewrite, LP-20 placeholder/coach-prefix
    strip), glanceLayers (opener → bullets → full)
  → delivery (shared/delivery.js / generationManager.js) — teleprompter text, optional TTS,
    Alt+R answer-now, skip/retry
  → sessionMetrics + PI events (TTFT, fallbacks, errors — no content)
```

Resilience: transport reconnects, provider fallback counters, per-hint cancellation,
`liveGate.js` preflight (share verification, OS checks, mic tests) before Live can start.

## 6. Solo & Screen-Solve pipelines

- **Solo**: question generation (role/seniority-aware) → candidate answer (voice or typed) →
  `api/evaluate.js` strong-lane evaluation → `SoloFeedback.jsx` report (STAR coverage,
  metrics, follow-ups). Session metrics recorded end-to-end.
- **F7 Screen Solve**: capture screen region → `api/analyze-screen.js` (vision lane) →
  `codingTab` UX with Code/Steps tabs (`codingTab` stuck-state bug fixed per PR #45 review),
  `shared/screenContext.js` + `codingSessionContext.js` keep code-block continuity,
  `codeRunner.js` + `codeRunnerPolicy.js` for safe local execution.

## 7. Jobs & Career intelligence (`api/jobs.js` + `api/_lib/jobs.js`)

- 4 sources: Adzuna (city-level `where` via `shared/jobLocation.js#cityFor`), JSearch-style
  aggregation, Greenhouse boards, Lever boards (`shared/companyBoards.js`), plus YC startup
  pipeline (`shared/ycJobs.js`).
- **Ranking**: exported `rankHeuristic` — title-token overlap (+7/token, cap 18), seniority
  distance (d≥2 → −25 + "Seniority mismatch" gap; d=1 → −8), recency boost (<14 d +4,
  <45 d +2); candidate band from `shared/resumeFacts.js` (`effYears`, auto-filled into the
  optional LLM ranker with a 45-cap). Bands: intern/junior→0 … staff/principal/lead/
  architect/director/head/vp/chief/fellow→3.
- Career page: company ATS aggregation over public boards only — no scraping, no auth.

## 8. Backend

Two deployment shapes share one logic layer:

- **Express shim** — `server.js` + `backend/src`: auth (JWT, rate-limited), sessions,
  documents, uploads, transcribe, billing/metering middleware, `/api/arch`, Mongo-optional
  (falls back to local stores). Used by `npm run dev` (Vite proxies `/api/*`) and self-host.
- **Vercel serverless** — `api/*.js` + `api/_lib/apiRoutes.js` route registry:
  `hint-stream`, `hint`, `interview`, `evaluate`, `report`, `jobs`, `ats-score`,
  `tailor-resume`, `resume-latex`, `analyze-screen`, `embed`, `deepgram-token`,
  `providers`, `token`, `referral`. `api/_handler.js` wraps every call with
  `recordArchMetric`.
- **Hosted vs BYOK**: `MOCKMATE_HOSTED=1` → managed proxy mode (MockMate AI, no user keys);
  otherwise BYOK with keys stored client-local. `resolveCapabilities()` exposes which mode
  is live; `/api/arch` hides perf/PI when hosted.
- Deployment targets: Vercel (`vercel.json`), Railway (`railway.toml`), local Electron
  bundling with optional local Express.

## 9. Mobile foundation (`mobile/`)

Expo/React Native (TypeScript): hosted auth, Prepare/History/Duo/Account tabs,
`InterviewSession.tsx` (Live/Mock/Coding attempts), `DocumentSetup.tsx` (explicit hosted
document selection), `domain/session.ts` (+ tests), secure token storage, transcript sync.
**Status: private-beta foundation**, not store-released. Milestones: mic transcription,
file extraction, real Duo pairing. Mobile tests cannot run in CI here (no `mobile/node_modules`).

## 10. Security, privacy & safety

- **Storage**: BYOK keys and PI events in account-scoped localStorage/Electron userData only;
  Mongo strictly optional for sessions/documents.
- **PI redaction** is double-layered (`redactInteractionEvent` key allowlists + value
  slugification; `sanitizeMetric` for session metrics) with an explicit excluded-data list
  enforced in ABL validation.
- **RAG cache integrity**: `mm-docs-index-v1` entries record embedding provider+model;
  dimension match alone is insufficient — prevents stale vectors after model failover.
- **Live safety gate** preserved on public builds (shareVerified/linuxAck/protectionTest/
  inElectron); never bypassed for production hostnames.
- Secrets never in ABL (validator rejects), never in telemetry, never in logs
  (`SECRET_VALUE_RE` redaction in slug paths).

## 11. Quality engineering

- **Vitest**: 60 files / 440 tests (2026-10-03), covering shared logic, client libs,
  backend routes, ARCH/ABL/PI, interview simulation & state-authority suites.
- Conventions: every Custom Prompt template must compile with `VOICE:` + `TRUTH:` (meta-test);
  anti_fail template asserts all 16 forensic rule keys.
- Pipelines: `npm test` → `npm run smoke:api` → `npm run build`; `npm run doctor` for
  environment checks; `scripts/soak-metrics.mjs` for soak evidence; dry-run evidence checker
  (`check:dry-run-evidence.mjs`) guards release claims.
- Release discipline: features land only with tests + honest validation notes
  (see `docs/audit-remediation.md` — 195/198 remediated; AUD-016/074/090 intentionally
  deferred: local-key/security items blocking the owner's Windows testing workflow).

## 12. Version & lineage

Current: **v1.5.2** (branch `arena/01a102d3-mockmate`, PR #45).
Recent lineage: 1.5.1 Windows update-handoff hotfix → PR #45 architectural remediation
(Artemis-inspired RAG/guardrails, Context Audit Trail, Custom Prompt Studio, ARCH adoption,
brand icon) → Skills/Resume Studio + Job Matching + Duo full-fledged pass → career ATS
aggregation + YC pipeline → resumeFacts + seniority/recency ranking → LockedIn transcript
autopsy (LP-01…LP-20 ledger, Anti-Fail Guardrails, spoken-prose placeholder/coach-prefix
guardrail).
