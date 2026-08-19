# Changelog

## v1.4.9 — 2026-08-19

### Added
- Production-safe structured diagnostics across application/backend startup, authentication, API calls, Deepgram token/socket/reconnect health, session quality, screenshot continuation, LLM provider/model attempts, token/latency metadata, and updater state.
- Buffered JSONL storage under Electron `userData/logs` with two-stage redaction, 5 MB rotation, bounded retention, session/request correlation, and Settings actions to **Export logs** or **Clear** without deleting interview history.
- Release workflow gates for tag/package version consistency, unit tests, API smoke tests, and required Windows/Linux updater artifacts.

### Changed
- Windows/Linux updates download in the background but install only after **Restart & install**; choosing Later no longer causes an unexpected install on quit.
- Authentication calls now have a 15-second deadline and distinguish timeout, local account-service startup, and network failure.
- Device-local builds hide non-functional email password recovery; hosted recovery now waits for the backend request before claiming a reset was sent.
- The render crash recovery action performs a real reload instead of merely clearing the error boundary and immediately crashing again.
- Internal QA scope is documented explicitly: local accounts and bundled team keys are temporary; hosted/shared accounts, billing, managed keys, encrypted sync and production recovery remain roadmap work.

### Fixed
- Consecutive screenshots showing different portions of one long interview question are now evaluated as a bounded continuation chain. When the second capture is confirmed as related, MockMate merges the extracted question, regenerates one complete answer, and updates the existing question card instead of creating a duplicate.
- Screenshot continuation context is limited to the immediately preceding successful capture, the same display, and a two-minute window. Unrelated screens, stale captures, and new Live sessions still start cleanly and cannot inherit an earlier question.
- Rapid consecutive captures are queued and analyzed in order rather than cancelling the first half. The overlay reports queued, continuation-checking, combining, and answer-updated states.
- Screen analysis now provides explicit **Continue question** and **New question** capture actions. Dismissing the panel cancels pending analysis and clears its continuation chain.
- OS/Electron capture failures are now returned to the overlay with an actionable message and always clear pending continuation choices. Provider responses using string-form continuation flags are normalized defensively.
- Live autoscroll now moves the newly rendered answer—not only its question—into view in compact overlays. Programmatic scrolling no longer disables follow-latest mode, manual reading of older turns remains respected, and **Jump to latest** prefers the latest answer.
- Confirmed screenshot continuations expose **Undo last merge**, restoring the exact previous question/answer state. Multi-part extracted question context now has a larger but still bounded 6,000-character budget for dense three-plus-screen problems.
- Queued screenshot analysis keeps one stable loading state between captures, and overlapping automatic scrolls share one guarded timer so follow-latest cannot be disabled by an earlier animation finishing late.
- Windows update notifications are no longer lost when update discovery/download finishes before the authenticated dashboard mounts. Manual checks now report Checking, Up to date, Ready, or an actionable failure instead of silently doing nothing.

## v1.4.8 — 2026-08-19

Live interview intent, latency, grounding, and preflight-window reliability patch based on a
real SysCloud QA interview transcript. Unit/build verification is complete; packaged Windows
meeting/share-preview validation remains required before publishing the installer.

### Added
- Explicit **superseded**, **failed**, and retry states for questions that are corrected, replaced, or time out.
- Current-turn output contracts for requested code, pseudocode, language, and concise answers.
- Resume/JD evidence policy: the resume is the source of first-person claims; the JD prioritizes framing and tools but never creates experience.
- Transcript-derived regression cases for repeated questions, wait/repeat corrections, STT artifacts, overlap merging, and “write it as code” refinements.
- **Stealth safety confirmation** — turning capture protection OFF requires an explicit in-window confirmation; successful ON/OFF changes show a visible status notice.
- A session-scoped coding workspace preserves the latest coding screenshot for later language, debugging, optimization, and implementation follow-ups without leaking it into career answers.
- Privacy-safe Live diagnostics record STT confidence, degraded-mode usage, diarization coverage, question commit latency, and answer first-token latency without transcript text.
- JavaScript coding answers can be executed in a disposable, timeout-limited worker with network, storage, and DOM APIs disabled.
- Meeting preflight identifies supported meeting apps and records the exact share mode being verified.

### Changed
- Question stabilization now waits 700–1500ms based on confidence instead of committing after 180–450ms.
- Repeated/refinal STT windows merge by word overlap; common `AI End`/`AI Okay` artifacts and adjacent duplicate words are cleaned conservatively.
- “Wait”, “sorry”, “I’ll repeat”, “you’re answering wrong”, and equivalent correction turns cancel stale generation and reopen capture.
- “Write it as code” and “be brief” modify the active question instead of creating disconnected cards.
- Live generation now uses a 9-second provider first-byte timeout, 8-second post-metadata token watchdog, and 12-second total UI deadline.
- Full resume/JD grounding budgets increased for relevant experience/fit questions.
- Stealth preflight now distinguishes an OS protection check from user verification in the actual meeting share preview; both are required before Live starts on supported desktop platforms.
- Live transcription uses Deepgram Nova-3 with keyterm prompting, VAD/endpointing, global-English accent handling, and OS voice isolation/automatic gain control when available; Nova-2 remains the connection fallback.
- The dashboard now summarizes local answer latency, question-capture latency, and STT confidence from recent sessions without exposing transcript content.

### Fixed
- Live and Solo model selectors no longer dump every model exposed by a provider key. They show Automatic (recommended) plus at most three curated models per configured provider, identify which providers are active, and clear stale selections. Settings can now remove an old provider key instead of merge-only replacement.
- Capability status now counts distinct provider keys rather than internal model aliases, so one OpenAI key is no longer reported as multi-provider failover. Managed mode cannot pass Live readiness without a real provider. Cerebras key entry/discovery and stale disconnected-display cleanup are now wired end to end.
- Selecting Automatic now deletes the old persisted model ID so stale explicit choices cannot return in later Live/Solo/Duo sessions. Display hot-plug refreshes capture choices, Claude/Cerebras count in desktop key detection, and Advanced settings have explicit clear actions for model, vision, and Adzuna overrides.
- Live setup/preflight can now be dragged, resized, collapsed to a movable pill, and restored before the interview starts.
- Old generations completing against corrected questions.
- Blank cards with no explanation after supersede, cancellation, or failure.
- Explanations being returned when the interviewer explicitly requested code.
- Coding screen language tabs now strictly regenerate the complete solution in the selected language instead of retaining the language visible in the screenshot.
- Spoken/manual coding questions are recognized even after a non-coding topic and render as expanded syntax-highlighted code blocks with a dedicated Copy control; loose model-emitted code is fenced defensively.

## v1.4.7 — 2026-08-18

Reliability patch for live screenshot solving, interview-session isolation, local authentication,
and newest-question navigation. Production hosted accounts remain planned work; this release keeps
device-local sign-in honest and preserves guest/BYOK access if the account service is unavailable.

### Added
- **Vision provider settings** — optional Groq vision model and custom OpenAI-compatible vision gateway fields under Advanced settings.
- **Jump to latest** — appears when a new question arrives while the candidate is reading an older answer.
- Regression coverage for manual screenshot precedence, context-sensitive screen caching, and provider-compatible image detail.

### Changed
- **Explicit Stealth mode** — capture protection is ON by default and controlled by a visible shield toggle. Turn it OFF only to test/demo the overlay in capture. It no longer changes opacity/collapse state; protected hints remain a separate opt-in window. Always verify the meeting share preview.
- **Manual screenshot precedence** — F7 / Ctrl+Shift+U answers the readable question on the newly captured screen instead of allowing a previous spoken/OCR question to override it.
- **Provider-compatible screenshots** — image detail uses `auto` so vision gateways can balance OCR quality, latency, and cost.
- **Authentication fallback** — failure of the optional local account service no longer closes MockMate; guest/BYOK interview modes remain available.
- **Autoscroll respects the user** — the newest card is followed only while the feed is already at the latest position.

### Fixed
- Previous interview question/screenshot state appearing in a newly started Live interview.
- Cached screenshot answers leaking across sessions or profile/context changes.
- New-account failures being presented as generic credential errors when the local account service was unreachable.
- Misleading “not relevant to last question” status after an independently solved manual capture.
- **Question/answer copying in Live** — both cards allow manual text selection and expose Electron-safe copy buttons with visible success/failure feedback.

## v1.4.6 — 2026-08-12

Live interview engine hardening, Career export polish (PDF primary), Jobs→interview JD seeding,
provider health split (text vs vision), and a large unit/smoke test net. Stealth share-preview matrix
and continuous 120-minute usage remain **not verified** on a packaged build — dry-run before a real interview.

### Added
- **Tailored resume PDF** — Resume Studio Tailor → **Download PDF** (jsPDF, 1–2 page single-column; same `applyTailorToResume` text, no invented content). `.txt` / FAANG `.tex` remain optional.
- **`POST /api/resume-latex`** — optional Overleaf-oriented LaTeX export for tailored resumes.
- **Jobs / Career → Solo & Live JD seed** — explicit confirm + profile write (`src/lib/interviewJobSeed.js`).
- **Career draft persistence** — analysis JD / draft survive minimize (`src/lib/careerDraft.js`); shell stays mounted when collapsed to pill.
- **Robust Copy / download helpers** — Electron-safe clipboard + text file download (`src/lib/clipboard.js`).
- **Live interview core modules** — `InterviewState`, `GenerationManager`, `questionCapture`, classification authority, `screenContext`, `transcriptBuffer`, `contextSelection`, `interviewClassify`; Live transport slice (`hintTransport`, `LiveSessionController`).
- **Vision policy** — `api/_lib/visionPolicy.js` (+ tests).
- **Playbooks extract** — `api/_lib/playbooks.js`.
- **`npm run smoke:api`** — in-process API route contract smoke (`scripts/api-smoke.mjs`).
- Broad unit coverage: career, Deepgram token policy, provider health, docs/PDF fixtures, Live transport, interview state/classify/capture.

### Changed
- **Provider failover / health** — unified stream+JSON failover; **text vs vision** health separated (`lastWorkingTextProvider` / vision path; vision 429 does not ban text).
- **Deepgram local managed** — Member/scoped keys may fall back to API-key websocket on loopback managed; **hosted** (`MOCKMATE_HOSTED=1`) never returns the raw project key (see `docs/SECRET_ROTATION.md`).
- **Documents** — job descriptions stored as type `jd`; **Onboarding** resume upload is **PDF-only**.
- **Home** — removed Screenshot/screen-analysis CTA and panel (screen solve stays on Live / F7).
- **Referral DM** — copy-only UX clarified (MockMate does not email or auto-DM); phased follow-up/send documented in `docs/ROADMAP.md` § P6.
- Dead code removed: root `providers.js` / `search.js`, `src/delivery.js`.

### Fixed
- Career Copy / minimize JD loss; Deepgram 403 on local managed with Member keys.

## v1.4.5 — 2026-08-11

Compact Live HUD, pin/pill stay-or-hide behavior, and bundled runtime provider keys for out-of-box Live/Solo on downloaders (CI secrets → installer `.env`; never committed). Optional Windows/macOS signing wired in CI without requiring certs. Windows release: empty `WIN_CSC_LINK` unset so unsigned builds succeed.

### Added / Changed
- Live overlay as a **compact HUD** with pin-aware stay/hide; unpinned blur → pill (not vanish); ignore own windows/screenshots for blur logic.
- **Bundled runtime keys** via GitHub Actions secrets at package time (user BYOK still overrides).
- Signing docs / CI paths for optional Authenticode / Apple signing.

## v1.4.4 — 2026-08-11

Reliability + trust UX for Solo/Live, Resume Studio ↔ Jobs depth, design-token parity, and an honest landing page. Stealth share-preview matrix and continuous 120-minute usage remain **not verified** on this build — always dry-run before a real interview.

### Added
- **Jobs → Resume Studio handoff** — score or tailor against a matched listing (analysis JD stays screen-local).
- **Apply tailor to resume** — write summary + rewritten bullets into the shared profile resume.
- **Saved-job tracking** — local status chips + notes on the Saved tab.
- **Solo interview turn timeout** (60s) with retry / orphan recovery.
- Unit coverage for answer-style SOT, docs upsert, apiFetch timeout, tailor apply, saved-job updates, jobs handoff.

### Changed
- **Home readiness** truthful (AI + Voice); stealth copy is verify-first, never “invisible to all capture.”
- **Begin Practice** / **Start Live** CTA consistency; Sessions naming; glance-first Live overlay.
- **Landing page** brand-first hero, OS-aware Linux stealth honesty, glance mockup.
- Design tokens applied across Account, App chrome, Room PiP, Live accents.

### Fixed
- yearsExp persisted from onboarding; answer style single SOT (`concise` default); resume/JD RAG upserts.
- Evaluate errors persist in Sessions; WhatsNew dialog a11y (Escape + focus trap).

## v1.4.3 — 2026-07-09

Big one: fixes the packaged-app regressions from 1.4.2, adds document RAG + live collaborative
rooms (Duo), a proper AI-settings surface, and retires the legacy dual-UI. Doubles down on the
wedge — private live help + content-protected overlay (verify share preview) — see docs/ROADMAP.md.

### Fixed
- **Backend unreachable in the packaged app** — the local server's CSP blocked the auth backend on :4000, so **Solo, Live, and sign-in all failed** in 1.4.2. `connect-src` now allows the loopback backend.
- **Live transcription gated behind the AI-response cap** — STT couldn't start once you hit the monthly limit; decoupled (STT is metered separately).
- **No more mid-interview dead end** — local managed usage is no longer hard-capped (metering only applies to the hosted multi-tenant backend).
- **Web-search grounding could stall a live answer up to 10s** — now time-boxed (1.8s live / 2.5s solo); the answer never waits on a slow lookup.
- **Cross-platform dev scripts** — `PORT=3002 …` was Unix-only and broke `npm run dev` / `electron:dev` on Windows; removed (the server defaults to 3002).
- Added a real `.gitignore` (node_modules / dist / .env were leaking into git).

### Added
- **Duo (Rooms)** — a friend/mentor joins your interview live: shared transcript + screen, plus a **private, content-protected AI co-pilot window** (verify share preview; not invisible to all capture).
- **Document RAG** — upload resume / JD / notes; they're chunked + embedded and the most relevant parts are retrieved per question, replacing the old truncated-resume stuffing.
- **AI Settings** — Response length (Concise / Balanced / Detailed), Screenshot replies (Quality / Faster), Auto-skip noise, and a Filter-documents relevance slider.
- **Guest mode** — try the app before creating an account (local BYOK); sign in anytime to sync.
- **Collapse-to-pill** — minimizing the overlay leaves a small logo pill (content protection where OS allows — verify share preview).
- **What's New modal**, in-app version label.
- **Modernized model catalog** — GPT-5.4, Gemini 3 Flash / 3.1 Flash-Lite, Cerebras, Claude Sonnet 5; Auto now routes to a current fast model on Live and a current strong model for hard questions.
- **`npm run doctor`** (install/bin integrity) + `npm run verify`; release checklist & roadmap under `docs/`.

### Changed
- **Mode-aware error messages** — managed users no longer told to "check your API key" (they have none); BYOK users keep the key-oriented guidance.
- **Retired the dual-paradigm UI** — deleted the legacy `Home.jsx` / `Report.jsx`, re-themed `Room.jsx` to the design tokens; every screen is now one system.

## v1.4.2 — 2026-07-08

First real release since 1.4.0 (1.4.1 was never shipped properly). Hardens the live-interview
path on Windows and makes it easy to start free.

### Fixed (live interview)
- **Blank-answer bug** — a streamed answer could show its badges but no text and still report "done"; now retries instead of showing nothing.
- **Faster answers** — cut the pre-answer pause (~850ms → 250–450ms) and halved the audio buffer (~256ms → 128ms) for snappier live transcription.
- **Survives network blips** — Live transcription no longer dies permanently after a ~40s outage (WiFi handoff / VPN / brief sleep); it reconnects for up to ~20 min.
- **Model choice honored** on the non-streaming hint path; empty/filtered completions now fail over cleanly instead of erroring.

### Added
- **Start free, no card** — Groq & Gemini are listed first in Settings with direct "get a free key" links; clarifies that a ChatGPT Plus subscription is *not* an API key.
- **Better update flow** — the update toast now has a Retry / "download manually" fallback so it's never a dead end.
- Billing groundwork (Stripe checkout/portal/webhooks) — disabled until a hosted backend is configured.

### Changed
- Landing page reworked to the honest download-and-go + bring-your-own-key flow.
- Account usage limits now come from the server (no more drift between what you see and what's enforced).

## v1.4.0 — 2026-06-26

The SaaS foundation: accounts, a redesigned Home, and a more reliable Solo voice flow.

### Added
- **Full auth system** — Welcome, Signup, Login, and a 2-step Onboarding (role setup + optional resume upload), gating the app behind sign-in.
- **Account screen** — avatar, plan badge (Free/Pro), monthly usage bars (AI responses + live transcription), an *Upgrade to Pro* CTA (disabled until billing ships), a *Use my own API keys* toggle, and Sign out.
- **Job Matching** — resume-ranked roles (later: separate workspace nav alongside Resume Studio).

### Changed
- **Home overlay redesigned** to the new design system — Kanit, `#0c0c0c` surfaces, accent-gradient Live hero, 2-column Practice grid, single Career row, and a quiet Settings / API keys / Shortcuts footer. Keyboard shortcuts now live behind the ⌨ button instead of cluttering the main surface.
- **Kanit is self-hosted** (woff2 bundled in `public/fonts`) — no Google Fonts CDN call on launch (privacy + offline-safe).
- **Icons** on the redesigned Home are inline SVG (no Unicode-glyph fallbacks, which render as empty boxes on Linux).
- **Backend (auth/SaaS)** — JWT (7-day) auth with bcrypt (12 rounds); **file-backed store by default** (offline-safe, zero infra) with **MongoDB opt-in** via `MONGO_URI`; API base URL is env-configurable (`MOCKMATE_API_BASE`) so it can point at a hosted backend with no code change. Forked from the Electron main process; JWT stored encrypted via `safeStorage` (never localStorage).
- **Solo Practice — full redesign** (purple design system): a structured session builder (interview type / level / target company), a count-up **timer** (sessions are time-based, not question-counted), and a new **results screen** (score ring + rubric dimensions + improvements). The **setup screen** is migrated to the design system, and the old **question-count selector was removed**.
- **Live Companion — red-theme visual redesign**: a dominant **Suggested answer card** (eyebrow + confidence badge + bullet points), a full-width **Copy answer** action (no Insert), and a persistent **listening bar** with an honest, mic-state-bound indicator. Red (`#ef4444`) throughout — never purple — to signal "live / real-time."
- **Live Companion — screen-capture path discoverable**: a persistent **Analyze screen** button (same trigger as `Ctrl+Shift+U`) plus an idle prompt after 30s. Added a **"Coding question detected"** banner and a **"Get code solution"** button for verbally-asked coding questions (tight phrase trigger, suppressed on behavioral/culture/company answers).

### Fixed
- **Solo voice reliability** — Solo now uses **Deepgram as the only voice engine** and **never falls back to the browser Web Speech API** (which silently fails inside Electron). When no Deepgram key is set, Solo shows a clear gate before starting (*Add Deepgram key* / *Use text mode*); if Deepgram hits its quota or drops mid-session, Solo switches to **text mode** and the session continues uninterrupted. The question flow and scoring are unchanged.
- **Auto-update CI hardening** — the release workflow now **fails loudly** if the git tag doesn't match `package.json` version (the #1 silent "no update offered" cause) or if `latest*.yml` update metadata is missing from the build, instead of shipping a release that can never auto-update.
- **Live Companion — duplicate suggestions no longer feel frozen** — a re-surfaced answer now shows a brief, fading *"Similar question · showing same answer"* signal, and the near-duplicate threshold was tightened from ≤2 to **≤1 word** so a genuine follow-up gets a fresh answer.

### Platform notes
- **Windows / Linux:** auto-update is silent (downloads in the background, installs on next launch).
- **macOS:** updates remain **manual** — the build is not yet code-signed/notarized, so re-download the `.dmg` from the releases page. (No Apple signing secrets added in this release.)
