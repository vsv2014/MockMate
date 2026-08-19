# MockMate roadmap

## Strategy — pick the wedge, not the breadth race
MockMate's moat is **invisible-to-screen-capture + local-first/BYOK + a genuinely robust answer
engine**. LockedIn will always out-feature us on funnel/modes; they cannot easily copy "invisible to
the interviewer's screen share" or "your data never leaves the device." **Win on depth + trust.**
Every item below should ladder up to: *the most private, most invisible, best-answer interview
copilot* — not surface-count parity.

Strengths to protect (already built): multi-provider failover, rate-limit/quota/transient
classification, JSON-repair, abort-safe streaming, playbook prompts (`core.js`/`interview.js`);
content-protected overlay (WDA_EXCLUDEFROMCAPTURE / PiP).

## Current operating scope — solo owner + internal QA team (v1.4.10)

The public build supports **hosted Managed AI** plus private BYOK. Provider credentials are never
packaged in installers. Internal QA can use BYOK or the same hosted endpoint as production.

**Unblock now:** Live/Solo/screenshot answer reliability, provider-aware model selection, clear
BYOK setup and key errors, bounded request times, recoverable UI errors, safe updates, local session
continuity, copyable/code-formatted answers, Stealth confirmation, and packaged Windows smoke tests.

**Post-1.4.10 roadmap:** shared/team tenancy, encrypted cloud history, production email recovery,
analytics at competitor scale, full Linux parity, and precise per-user STT-second reconciliation.

### Deferred because they require external infrastructure, credentials, or real devices

These are intentionally not claimed as complete in v1.4.10. Each item has a measurable exit gate.

- [ ] **Deploy Managed AI:** provision the existing backend with HTTPS, MongoDB, stable
      `JWT_SECRET`, provider/Deepgram keys, CORS allowlist and `MOCKMATE_HOSTED=1`; set the GitHub
      repository variable `MOCKMATE_API_BASE`. **Done when:** a clean Windows install can sign up
      and complete Live, Solo and screen analysis without any device-local provider key.
- [ ] **Exact voice metering:** associate Deepgram usage with account/session IDs, reconcile actual
      streamed seconds and enforce `sttSeconds` atomically without charging reconnect gaps.
      **Done when:** parallel sessions cannot exceed the plan and the Account usage total agrees
      with Deepgram billing within an agreed tolerance.
- [ ] **Managed billing validation:** configure Stripe price, webhook and customer portal URLs.
      **Done when:** checkout → signed webhook → plan/model entitlement → cancellation/downgrade is
      verified against test-mode Stripe and failure/replay cases are covered.
- [ ] **Cross-device authentication and migration:** test shared accounts against the hosted store
      and provide an explicit claim/migration decision for existing device-local users.
      **Done when:** new and old accounts behave correctly across two Windows machines and reinstall.
- [ ] **Packaged Windows certification:** run the full release checklist plus a 30-turn noisy/accent
      interview and a two-hour soak on the actual signed/unsigned installer. **Done when:** evidence
      is recorded in `docs/evidence/VALIDATION_STATUS.md` with updater, Stealth and recovery results.
- [ ] **Installer signing and update channels:** obtain Windows/macOS certificates, verify signatures,
      staged rollout and rollback. **Done when:** clean machines accept install/update without
      avoidable trust warnings and updater metadata/signatures validate.
- [ ] **Safe multi-language code execution:** deploy isolated runners for Python, Java and C++ with
      no network, strict CPU/memory/process/time limits and ephemeral filesystems. Until then,
      generated programs remain copy/run-online outputs; only the local JavaScript sandbox is claimed.
- [ ] **Production account recovery and OAuth:** configure mail delivery and optional Google OAuth,
      then test expiry, replay, account linking and duplicate-email behavior.
- [ ] **Privacy-controlled centralized diagnostics:** opt-in upload, retention/deletion controls,
      tenant isolation and support correlation without transcripts, screenshots, audio or secrets.
- [ ] **Platform certification:** publish a tested capability matrix for Windows/macOS/Linux and each
      meeting/share mode; advertise Stealth only for combinations proven in share-preview tests.

### Hosted-product backlog (LockedIn/Parakeet parity track)
- [x] Hosted-capable HTTPS API + durable Mongo store; invalid URLs fail closed and an absent URL produces BYOK-only builds
- [x] Authenticated AI/STT proxy with server-held keys and atomic LLM entitlement enforcement
- [x] Stripe checkout/webhook/portal and model tier enforcement (production configuration still requires validation)
- [ ] Reconcile exact Deepgram seconds per user and enforce the STT cap independently of LLM calls
- [ ] Production email/password recovery and optional Google sign-in/account linking
- [ ] Encrypted opt-in profile, document and interview-history sync with migration/export tools
- [ ] Signed/notarized installers, signature-verified updates and staged release channels
- [ ] Team administration, centralized QA diagnostics and privacy-controlled analytics
- [ ] Full platform capability matrix; only advertise Stealth/screen capture where certified
- [ ] Durable encrypted local storage (SQLite/userData) with backup, quota and clear-data controls

## P0 — Release verification discipline (protects everything)
The most dangerous gap: 1.4.2 shipped bugs that a single packaged-build click-through would have
caught. Fix the *process*, not just the bugs.
- [x] `docs/RELEASE_CHECKLIST.md` — packaged-build smoke gate (sign in → Solo → Live → screenshot → Duo)
- [x] `npm run smoke:api` — in-process `/api` route contract smoke (fast pre-check)
- [x] CI release gate: `npm ci`, tag/version match, unit tests, API smoke, build, and required updater metadata *(1.4.9)*
- [ ] Adopt it: no tag/upload until the checklist passes on the packaged artifact
- [ ] Add the same verification as a required check on every pull request (release workflow is gated today)

## P0 — Live intent and answer reliability
- [x] 700–1500ms semantic question stabilization; incomplete-clause blocking *(1.4.8)*
- [x] STT overlap merge, conservative artifact cleanup, duplicate suppression *(1.4.8)*
- [x] Correction/refinement controls: wait/repeat cancels; “write it as code” updates the active card *(1.4.8)*
- [x] Stale-generation cancellation, explicit terminal card states, 12s total answer deadline *(1.4.8)*
- [x] Resume-truth/JD-fit evidence policy and requested output/language contracts *(1.4.8)*
- [x] Session-scoped coding context for screenshot → language/debug/optimization follow-ups, isolated from career turns *(1.4.8)*
- [x] Two-stage Stealth preflight: OS protection applied + user-confirmed meeting preview *(1.4.8)*
- [x] Privacy-safe STT quality diagnostics: confidence, degraded mode, diarization coverage *(1.4.8)*
- [x] Nova-3 global-accent/noisy-meeting profile with keyterms, VAD endpointing, OS noise suppression, voice isolation and Nova-2 fallback *(1.4.8)*
- [x] Safe JavaScript execution in a disposable, networkless, timeout-limited worker *(1.4.8)*
- [x] Meeting-app recognition plus share-mode-specific Stealth verification *(1.4.8)*
- [x] Local quality dashboard for transcript confidence and capture/answer latency *(1.4.8)*
- [x] Rotated production diagnostics with redaction, correlation, provider/STT/screen/auth/updater events, and Export/Clear controls *(1.4.9)*
- [ ] Deploy a hardened multi-language execution service (container isolation, no network, CPU/memory/process limits, ephemeral filesystem) before claiming Python/Java/C++ execution
- [ ] Validate 30+ real spoken turns on packaged Windows using System Audio: fragments, corrections,
      code requests, notes/nodes ambiguity, rapid topic switches, and slow-provider failover
- [ ] Record time-to-commit and time-to-first-token percentiles from the packaged soak; tune only
      from evidence (target: useful first text within 2–5s, hard stop by 12s)

## P0 — Next version: production authentication and shared accounts
The desktop currently falls back to a device-local `auth-db.json`. That is useful for offline/dev
work, but it is **not** a production account system: users created on one installation are not
automatically recognised on another. Do not describe local accounts as cross-device accounts.

- [ ] Deploy one HTTPS auth/managed-API service using the existing `backend/` application and a
      durable hosted database (`MONGO_URI`); configure a stable `MOCKMATE_API_BASE` in installers
- [ ] Keep `JWT_SECRET` stable across instances; enforce HTTPS, production CORS allowlists, proxy
      trust, rate limits, health/readiness probes, secret rotation and monitored startup failures
- [ ] Add a safe, authenticated migration/claim flow for existing device-local accounts; never
      upload password hashes or silently merge users without explicit confirmation
- [ ] Complete password recovery with a production mail provider, one-time expiring tokens and a
      hosted `RESET_URL_BASE`; verify Google OAuth redirect/audience configuration if enabled
- [ ] Define duplicate-email/account-linking behaviour across password and Google sign-in
- [ ] Make offline mode explicit: local profile/session access may continue, but shared-account and
      managed-AI actions must show a clear unavailable/retry state instead of false credential errors
- [ ] Validate clean signup, login, logout, refresh, reset, upgrade and migration on two Windows
      machines plus reinstall/update; confirm old and new accounts against the same hosted database
- [ ] Add packaged-build integration tests for backend unreachable, expired JWT, database outage,
      duplicate signup and account-not-found paths before tagging the next release

**Release gate:** do not call authentication production-ready until the hosted deployment,
cross-device test matrix and local-account migration decision are complete.

## P1 — Kill the dual-paradigm debt (consistency reads as quality)
Legacy browser app (`Home.jsx`, old `styles.css`) vs the token dashboard — largely retired in 1.4.3.
- [x] Re-theme `Room.jsx` to design tokens (`T`), then delete `styles.css` legacy classes *(1.4.3)*
- [x] Delete `Home.jsx` (superseded by `Duo.jsx` + the dashboard) *(1.4.3)*
- [ ] One audit pass: every screen uses `T`, no stray `className="..."` from the old system

## P2 — Document intelligence / RAG (biggest answer-quality lever)
Long resumes used to be truncated into every prompt; RAG retrieves relevant chunks per question.
- [x] RAG core — `shared/retrieval.js` (chunk/cosine/topK/threshold), `embed()` in `core.js`, `/api/embed` (verified)
- [x] Client: docs store → embed chunks → per-question top-K retrieve → inject *(Documents + AI Settings threshold)*
- [x] Documents UI (upload/list/delete); multi-doc (resume + JD + extras); JD type `jd`
- [x] "Filter document" threshold slider in AI Settings (default 0.20)
- See `docs/RAG_PLAN.md` (client wiring marked shipped; keep soak evidence honest).

## P3 — Fix the funnel (convert the aha-moment)
- [x] Guest / try locally BEFORE forcing full account value *(guest mode 1.4.3)*
- [x] Cap cliff: hosted cap returns an actionable Upgrade/BYOK path; local mode is not hard-capped.

## P4 — Polish + modernize (mostly done; needs the green build to verify)
- [x] Modernized model catalog (GPT-5.4, Gemini 3 Flash/Flash-Lite, Cerebras, Sonnet 5); un-hardcoded fast tier
- [x] Electron 43 / Node 24 desktop migration with lazy-runtime bootstrap in release CI
- [x] Key-aware quality routing: Fast, Balanced, and Maximum quality; live discovery for GPT-5.6 and Claude Fable/Opus/Sonnet 5
- [x] Consolidated AI Settings (Response length · Screenshot replies · Auto-skip)
- [x] What's New modal; mode-aware (managed vs BYOK) error messages; time-boxed web search (Live latency)
- [x] Duo revived (LiveKit `mintToken` + `/api/token`, wired into dashboard)
- [x] Stepped/collapsible setup sections (Live setup → numbered 1·2·3 accordion); in-app version label
- [x] Duo Phase 3: protected Electron co-pilot window (content-protected BrowserWindow + setRoomActive/sendHint IPC)
- [x] Live compact HUD + pin/pill *(1.4.5)*; Live engine modules + Career PDF / JD seed *(1.4.6)*

## P5 — Breadth (ONLY after P0–P3 are solid)
More modes (Professional Meeting / Online Assessment / Phone), Resume Builder, billing UI.
Breadth on a shaky base is a trap — resist until the wedge is airtight.

## P6 — Referral outreach (Career) — phased, not multi-agent-first

**Ship today (v1.4.x):** Referral DM is **copy-only** — draft from resume + role + company; user
pastes into LinkedIn/email. That is intentional. Specialty vs ChatGPT is **grounded context already
in MockMate** (profile, tailor, JD), not “we send mail.”

**Do not build first:** autonomous multi-agent email/LinkedIn triggers (MockMate SMTP, silent sends,
agent swarms). Wrong surface: OAuth/spam/trust/support; competes with CRM products; LinkedIn auto-DM
belongs to the separate extension track in [`NEXT_PHASE.md`](NEXT_PHASE.md) (ToS/ban risk).

### Phased roadmap (keep the idea; ship in this order)

| Phase | What | Why |
|---|---|---|
| **A — Now (1.4.6)** | Best grounded drafts + Copy; tailored **PDF** for resume | Low risk; uses existing Career context |
| **B — Next** | Per-job/company **follow-up checklist + local reminders** (calendar/OS notify); still user-sends | Captures “follow-up” value without send infrastructure |
| **C — Later** | **User-confirmed send** via *their* Gmail/Outlook (“Send with my account”); templates + optional schedule | Agent/assistant **drafts + reminds**; human taps Send — never MockMate-as-mailer |
| **D — Separate product** | LinkedIn discovery / auto-DM / Easy Apply | Browser extension only — see NEXT_PHASE “Job-application automation” |

**Multi-agent angle (validated, deferred):** sequences (DM → thank-you → 7-day nudge) are valuable as
**assisted outreach** (prepare + remind + confirm), not as unsolicited autonomous agents. Revisit
when Jobs/Career retention is strong enough that users live in MockMate between interviews.

---
### Status legend
[x] done + verified in unit tests / code where noted · [ ] pending. Packaged stealth soak + 120m
usage remain **NOT VERIFIED** — see `docs/evidence/VALIDATION_STATUS.md`. Do not claim them from
docs alone.
