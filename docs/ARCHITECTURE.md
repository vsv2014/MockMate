# MockMate — Architecture

> How the system is structured and why. This document describes the **current**
> architecture; future direction lives in §16. Release history, validation status,
> and remediation counts are deliberately NOT tracked here — see §17 links.

---

## 1. Scope & architecture principles

MockMate is a desktop-first interview preparation **and** live-performance companion:
a dashboard workspace (Solo practice, Resume Studio, Job matching, Documents, Career)
plus a live overlay that listens to the interviewer and renders resume-grounded answers.

Principles:

1. **ARCH-first.** MockMate is the first consumer of the ARCH runtime intelligence layer;
   ARCH is designed to outlive MockMate as a reusable policy engine.
2. **Privacy by default.** Telemetry is structured and redacted; resumes, transcripts,
   prompts, keys, screenshots, and raw audio never enter it (§11.2, §14).
3. **Provider portability.** AI capabilities use provider-independent routing with
   capability-specific fallback paths; a local fallback exists only where explicitly
   supported. There is no universal local model.
4. **Isomorphic shared logic.** `shared/` modules run unchanged in the browser, the
   Express shim, and serverless functions, with broad unit-test coverage.
5. **Honest capability reporting.** What the system does today is documented separately
   from what it targets (§10.5, §16).

## 2. System context

Actors: the candidate (user), the meeting application whose audio/screen is consumed,
AI providers (LLM ×6, Deepgram STT), optional hosted services (Mongo, hosted proxy),
and ATS job boards (Greenhouse/Lever public APIs, Adzuna, YC public listings).

MockMate never injects into the meeting application; it passively observes audio/screen
and produces guidance in its own windows.

## 3. Deployment topology

| Shape | Where | Components |
|---|---|---|
| Desktop (primary) | Windows installer, macOS dmg, Linux AppImage | Electron shell + bundled SPA; AI via BYOK keys stored locally or managed proxy |
| Local server | `npm run dev` / self-host | `server.js` Express shim over `backend/src` (auth, sessions, documents, uploads, transcribe, billing/metering) |
| Hosted API | Vercel | `api/*` serverless functions + optional Mongo; `MOCKMATE_HOSTED=1` switches capability mode to managed |
| Mobile foundation | Expo/React Native (`mobile/`) | private-beta; see §13 |

The SPA talks to whichever backend is present via `src/lib/apiClient.js` (dev proxy for
`/api/*`; absolute base only when `VITE_API_BASE` is set).

## 4. Electron desktop runtime (`electron/`)

- `main.cjs` — lifecycle, single window reconfigured across modes: `app` (dashboard),
  `overlay` (compact always-on-top HUD), `teleprompter` (top-center camera anchor),
  `pill` (badge). Mode transitions drive geometry, always-on-top level, and —
  importantly — **mode-scoped global shortcut registration**.
- **Shortcut ownership.** `Alt+T/R/Up/Down` are registered only while in
  overlay/teleprompter mode and unregistered on every mode change
  (`syncOverlayShortcuts`), so the OS never reserves those accelerators outside those
  modes. App-level hotkeys (`Alt+H` stealth, `Alt+C` click-through rescue,
  `Ctrl+Shift+U` / `F7` capture) stay global by design.
- **Screen capture.** `desktopCapturer` over `types: ['screen']` captures the
  **entire selected display** as a bounded/resized JPEG (1440→1280 wide, ≤210 KB).
  Display precedence: explicit picker choice → last chosen/captured display →
  display containing the MockMate window → first source. There is no foreground-window
  detection (not portable across Win/macOS) and no region cropping.
- **Screen protection.** OS content-protection flags exclude protected windows from
  common capture paths on Windows/macOS; documented as *partial / verify per meeting
  app*, unsupported on Linux. Public builds keep the full safety gate
  (`shareVerified`, `linuxAck`, `protectionTest`, `inElectron`).
- `preload.cjs` — minimal `electronAPI` surface (window control, capture, display list,
  audio sources, metrics append, diagnostics, power events).
- Session metrics JSONL appender + diagnostics store persist locally in userData.

## 5. React application (`src/`)

React 18 + Vite, dark design tokens (`src/auth/tokens.js`), desktop-first layouts.

| Surface | Responsibility |
|---|---|
| Dashboard (`Dashboard.jsx`) | hub; hosts ARCH · Product Intelligence panel |
| Solo (`Solo.jsx`, `SoloFeedback.jsx`) | practice interviews, strong-lane evaluation reports |
| Live (`LiveCompanion.jsx`, `src/live/*`) | overlay/inline live assistance (§6) |
| Duo Room (`Duo.jsx`, `Room.jsx`) | paired practice room |
| Skills / Resume Studio | skill-gap matrix (`shared/skillsMatrix.js`), resume editing, LaTeX export |
| Jobs (`Jobs.jsx`) | job search + ranking (§12 ranking details) |
| Career (`Career.jsx`) | career-page aggregation over public ATS board APIs |
| Documents (`Documents.jsx`) | document upload, chunking, embeddings, context selection |
| Custom Prompt Studio | playbook templates incl. Anti-Fail Guardrails (forensic rules distilled from competitor transcript autopsies), quick snippets |
| Auth (`src/auth/*`) | hosted sign-up/sign-in, guest mode, onboarding |
| Settings (`ApiKeys.jsx`, `aiSettings.js`, `modelPicker.js`) | BYOK keys (local), live model discovery, answer style |

Client infra: `apiClient.js`, `accountScope.js` (per-account storage namespacing),
`diagnostics.js`, `ErrorBoundary.jsx`, `useDeepgram.js` + `lib/deepgramTransport.js`
(STT socket lifecycle, reconnects, PCM queueing).

## 6. Live interview pipeline (the hot path)

```
Meeting audio (loopback/system source or mic)
  → Deepgram streaming STT (nova-3, nova-2 degraded fallback; reconnect + typed-input
    fallback per ABL; Finalize-on-pause flushes held-open utterances)
  → shared/questionCapture.js — candidate stabilization, correction/revision/refinement
    signals, speaker-role gating, duplicate rejection, Turn-1 system-audio boost
  → shared/interviewClassify.js — technical / behavioral / coding / logistical / dsa
  → shared/retrieval.js — RAG over explicitly selected documents (embedding cache
    validates provider+model identity, not just dimensions)
  → api/hint-stream.js — LLM streaming on the ARCH hint lane (fast)
  → shared/hintLayers.js — meta/JSON leak stripping, code-block normalization,
    spoken-prose sanitization, glance layers (opener → bullets → full)
  → delivery (shared/delivery.js, generationManager.js) — teleprompter text, optional
    TTS, answer-now, skip/retry
  → session metrics + PI events (timings/counters only, §14)
```

**Known limitations (live capture):**
- Question dedupe compares only against the *last* committed question — a
  Q1→Q2→Q1 repeat slips through.
- Finalize-on-pause is a timer heuristic; extreme pause patterns can still over- or
  under-flush.

## 7. Solo pipeline

Question generation (role/seniority-aware) → candidate answer (voice or typed) →
`api/evaluate.js` on the strong lane → structured feedback report. Same metrics
discipline as Live; no STT required for typed flow.

## 8. Screen Solve pipeline

F7 / Ctrl+Shift+U / in-app button → capture the selected display (§4) →
`api/analyze-screen.js` on the vision lane → Code/Steps tab UX with
coding-session continuity (`shared/screenContext.js`, `shared/codingSessionContext.js`)
and sandboxed local execution (`src/lib/codeRunner.js`, `shared/codeRunnerPolicy.js`).
Linux is explicitly unsupported (Wayland portal hang risk) — the UI says so.

## 9. Documents / RAG

Upload → parse → chunk → embed (`api/embed.js`) → persist in
`mm-docs-index-v1` with embedding **provider + model identity recorded**; cache entries
from a different provider/model are never served even at equal dimensionality.
Context selection (`shared/contextSelection.js`) gates which sources may feed which
question types; the Context Audit Trail records what grounded each answer.

## 10. ARCH — runtime intelligence

ARCH is MockMate's declarative behavior contract plus a policy engine. It is split into
a **policy plane** (what should happen) and an **execution plane** (what runs today):

```
POLICY PLANE (implemented)
  arch/mockmate.abl.json ──validate──► compileAblRuntime()
      capabilities, lanes, routing, telemetry contract, PI spec
                │
                ▼
      resolveCapabilities()          reasoningPolicy(operation, {adaptive})
      (env × ABL → capability        (lane selection; adaptive promotion on
       matrix: byok/managed/          p95 TTFT/turn-latency thresholds)
       unavailable)                          │
                                             ▼
      performanceSnapshot() ◄── recordArchMetric()  (bounded percentiles)

EXECUTION PLANE (implemented where noted)
  STT transcription ──► executeWithFallback()   ← circuit breakers, timeouts,
                                                 retries, provider failover
  LLM reasoning     ──► existing resilient core adapter (NOT executeWithFallback)
  Everything else   ──► direct capability implementations
```

### 10.1 ABL (`arch/mockmate.abl.json`)

Declarative, validated at load (`backend/src/abl.js`): persona, reasoning lanes
(`fast|balanced|strong|vision`), operation→lane routing, speech modes with typed-input
fallback, telemetry metric allowlist, hot-path percentiles, and
`policies.credentials = never_in_abl` enforced by a validator that rejects any
secret-looking key. Cached by mtime; overridable path for tests.

### 10.2 Policy & routing

`reasoningPolicy()` returns the lane per operation; adaptive mode promotes
`balanced → fast` only on **operation-scoped** evidence: the p95 of
`turn_latency_ms:<operation>` for that very operation (TTFT feeds only the streaming
hint domain). A slow vision/evaluate/career episode can therefore no longer downgrade
a healthy interview — cross-operation contamination is structurally excluded. The
underlying perf maps remain process-local (§15 scoping limitation).

### 10.3 Runtime resilience

`executeWithFallback()` — per-provider circuit breaker (30 s cooldown), per-attempt
timeout raced with AbortController, bounded retries, outer-signal relay, provider
failover, optional fallback callback, success/failure telemetry. `noDoubleRetry` policy
prevents retry stacking across layers.

### 10.4 Telemetry

Only ABL-declared hot-path metrics are recorded (stt timings, llm_ttft_ms, tts_ttfa_ms,
turn_latency_ms, fallback/failure counts), bounded at 500 samples per metric,
reported at ABL percentiles. Hosted mode hides performance + PI from `/api/arch`.

### 10.5 What ARCH does NOT yet control

- **LLM reasoning execution.** Hint/interview/evaluate/report/vision calls run through
  the existing resilient core adapter (`policies.reasoningExecution`), not
  `executeWithFallback`. Only transcription routes through the ARCH executor today.
- **Embeddings and vision pipelines** have no ARCH circuit/fallback coverage.
- **Cross-process state.** Perf and PI maps are process-local; nothing is shared
  across instances or persisted.
- **Tenant/user scoping** of adaptive decisions (§15).

## 11. Product Intelligence (behavioral subsystem)

Product Intelligence is a **consumer subsystem that feeds behavioral signals into
ARCH**, not the same layer as runtime telemetry:

```
Product Intelligence ──behavioral signals (funnels, friction, adoption)──┐
                                                                          ▼
Runtime telemetry ──latency / failures / fallbacks──────────────► ARCH policy engine
                                                                          ▼
                                                                adaptive decisions
```

### 11.1 Local event architecture

```
UI interactions ──► trackProductEvent()
                     redactInteractionEvent: forbidden-key regex drops content-like keys;
                     allowlists keep structural keys; values slugified + truncated
                     ▼
              account-scoped localStorage ring buffer (bounded)
              + rage-click observer (structural attributes only)
                     ▼
              summarizeProductIntelligence() (shared)
              funnels · friction · adoption · insights · adaptive actions
                     ▼
              ProductIntelligencePanel (Dashboard)

──────────────── no production bridge ────────────────

backend/src/arch.js PI store — dormant; see §11.4
```

`sessionMetrics.js` bridges session lifecycle events (`live_started/ended`,
`first_hint_rendered` with TTFT) into the PI stream while raw timings go to the
Electron JSONL store — never transcript text.

Funnels: live_interview (6 steps), solo_practice (4), screen_solve (3). Correlations:
preflight stall rate, resize-before-teleprompter, slow-TTFT → early abandon or
missing session end, playbook-before-Live adoption.

### 11.2 Privacy boundary

Structured, redacted UI flows only. Excluded by contract and by code: resumes,
interview transcripts, prompts, answers, API keys, passwords, screenshots, raw meeting
audio. Secret patterns are scrubbed from any value that survives key filtering.
Opt-in breadcrumb replay exists behind an explicit default-off switch.

### 11.3 Adaptive-action bridge

Summarized insights can surface one-click actions (e.g. apply Concise/Fast style when
latency is high); applying an action emits its own event so the loop is measurable.

### 11.4 Backend PI — future path decision

The backend PI store (`recordArchProductEvent` + snapshot in `backend/src/arch.js`)
has **no production callers today**. Decision: it is the **reference implementation for
a future explicit opt-in hosted telemetry path** (option A). It stays only so long as
hosted PI remains plausible; if that roadmap decision goes negative, it is a deletion
candidate. Until a bridge exists, PI is desktop/local by construction — which is also
the privacy posture the UI advertises.

## 12. Backend / API topology

Two shapes share one logic layer:

- **Express shim** — `server.js` + `backend/src`: auth (JWT), sessions, documents,
  uploads, transcribe, billing/metering middleware, `/api/arch`. Mongo optional.
- **Serverless** — `api/*.js` with a route registry (`api/_lib/apiRoutes.js`).
  Most simple POST handlers share `api/_handler.js`; streaming and specialized routes
  (e.g. `hint-stream`) perform equivalent ARCH policy/metric wiring directly.
- **Capability modes**: hosted (`MOCKMATE_HOSTED=1`, managed proxy, no user keys) vs
  BYOK (keys client-local); `resolveCapabilities()` exposes which is live.

Jobs: 5 source families — Adzuna (city-level location handling via
`shared/jobLocation.js`), JSearch-style aggregation, Greenhouse boards, Lever boards
(`shared/companyBoards.js`), and the YC startup pipeline (`shared/ycJobs.js`).
Ranking (`rankHeuristic` in `api/_lib/jobs.js`): title-token overlap, seniority-distance
penalty, recency boost; candidate band from structured resume facts
(`shared/resumeFacts.js`), optionally refined by an LLM ranker.

## 13. Mobile (`mobile/`)

Expo/React Native (TypeScript) foundation: hosted auth, Prepare/History/Duo/Account,
interview session component, explicit hosted-document selection, secure token storage,
transcript sync. Release milestones (not current): microphone transcription, file
extraction, real Duo pairing.

## 14. Security boundaries

- Keys and PI events live in account-scoped local storage / Electron userData only.
- PI redaction is double-layered (key allowlists + value sanitization), with the
  excluded-data list also enforced by ABL validation.
- Session metrics block content-like keys (`sanitizeMetric`).
- RAG cache integrity requires embedding provider+model identity match.
- Live safety gate is preserved on public builds; frictionless paths are dev/local-only.
- Secrets are rejected from ABL, telemetry, and logs.

## 15. Known architectural limitations

| ID | Area | Limitation | Path |
|---|---|---|---|
| ARCH-1 | Adaptive routing | Perf/PI state is process-local: nothing persists across restarts/instances and decisions are not per-account (operation mixing itself is solved — metrics are scoped `turn_latency_ms:<operation>`) | persist + scope to provider+operation+deployment, then account/session, before hosted scale-out |
| ARCH-2 | Execution coverage | Only transcription uses `executeWithFallback`; LLM/embedding/vision paths use their own adapters | migrate hot capabilities incrementally (§16) |
| PI-1 | Backend PI | Dormant; local-only today | decision recorded in §11.4 |
| PI-2 | Rage-click targets | Fallback to `title`/`aria-label` can carry dynamic values; slugified but meaning may survive | prefer `data-pi-target`/`id` on sensitive screens |
| LIVE-1 | Question dedupe | Compares only against last committed question | windowed history |
| LIVE-2 | Finalize-on-pause | Timer heuristic, but narrowly scoped: system/loopback capture only, and permanently disabled after the first question commits | tune against recorded sessions if needed |
| CAP-1 | Screen capture | Display-level only; no foreground-window detection or region cropping | platform APIs where available |

## 16. Target architecture

- **ARCH as orchestration framework**: reasoning execution, embeddings, and vision
  migrate onto `executeWithFallback` so circuit-breaking/failover/metrics apply
  uniformly; ABL becomes the single place lanes and fallbacks are declared.
- **Scoped adaptive routing**: per provider+operation+deployment, then account.
- **Hosted PI** behind explicit opt-in with tenant isolation, or deletion of the
  dormant backend store (§11.4).
- **Mobile parity milestones** per §13.

## 17. Status & evidence links

Volatile facts (test counts, audit remediation status, release notes, validation
evidence) are tracked outside this document:

- `CHANGELOG.md` — release history incl. v1.5.x lineage
- `docs/audit-remediation.md` — audit item status
- `docs/audit-status-*.md` — dated audit snapshots
- `docs/ROADMAP.md`, `docs/DUO_PLAN.md` — planned work
- `docs/lockedin-failure-patterns.md` — competitor-autopsy ledger feeding Anti-Fail rules
