# Changelog

## v1.6.4 — 2026-10-13 (unsigned personal preview)

- **OpenRouter provider support:** Full integration for OpenRouter as a supported provider. Users can connect with a single OpenRouter API key and access any model available through the platform. Model selection, usage tracking, and provider testing all work seamlessly.
- **Modern UI foundation:** Integrated Tailwind CSS and shadcn/ui component library (Button, Card, Input, Badge, Separator) for consistent, maintainable design. Design tokens centralized in `@theme` for easy customization.
- **Settings improvements:** Constrained Settings screen to max-width 1000px for better readability on large displays. Fixed save button visibility and positioning.
- **Linear Ready Room workflow:** Converted pre-flight checks from a two-column grid layout to a clean single-column linear workflow. Session summary, progress tracking, and action buttons now present in a focused vertical sequence.
- **Deepgram UI enhancements:** Added eye toggle to show/hide API key in Settings. Added dedicated test button to verify Deepgram configuration without leaving the settings screen.
- **Answer budget corrections:** Fixed thinking token budget application to work correctly per model. Implemented proper floor values for thinking budgets and improved empty-output detection and surfacing.
- **Desktop stability:** Replaced black overlay window with informative fallback panel for unrecognized views. Fixed collapsed pill icon showing black background rectangle by making body background transparent when collapsed.

Published by `unsigned-public.yml` as an unsigned GitHub pre-release (Windows x64 NSIS, no auto-update feed); not code-signed.

## v1.6.3 — 2026-10-13 (unsigned personal preview)

- Preserve Live follow-up context in both streamed and blocking hints: send the complete current question (previously clipped at 800 characters); honour `includeLastAnswer`, which Live already requested but `getLlmHistory` ignored, so the last completed AI suggestion is included and labelled as AI text, never candidate speech; and replace 300-character history clipping with whole recent turns under a shared 24,000-character budget.
- Share output caps between transports. Coding/system-design and coach-mode requests rise to 2,400 tokens (1,800 concise); streaming previously allowed 900 balanced, 650 concise and 1,100 detailed. Simple streaming caps are unchanged; blocking concise simple answers now use the streaming 380-token cap instead of 700. Concise answers must still include complete requested code or architecture, and definition answers lead with what the term means.
- Treat short explicit requests such as "draw it", "show me the code", "explain the architecture" and "give me an example" as refinements of the current question.
- Keep the Windows transparent overlay natively non-resizable at creation and across collapse/expand; the custom handles still resize through the bounded `window-resize` IPC handler.
- Add metadata-only provider diagnostics: attempt index, serialized request size, per-request usage for blocking calls including JSON repairs, and `null` rather than `0` for token counts a provider does not report.
- Settings reports a detected key separately from model availability, reads BYOK key status from the local service even when Managed mode is selected, and no longer labels Gemini or Groq as free.
- Stop cutting off long Live answers. The 11-second per-provider budget now covers only the wait for the first answer text; after that only a stall ends a stream (8 s on the server, 12 s in the browser). Previously any answer still streaming 11 s after its request started was cut off, shown as a provider outage, and its provider was cooled down.
- Turn off Claude's hidden thinking for Live answers. Claude 5-generation models think by default, and over the OpenAI-compatible endpoint that thinking was invisible, used the answer's token budget and was billed. Live now sends `between_tools` for Sonnet 5.5 and `disabled` for Sonnet 5, Opus 5 and Haiku 5.5, retrying once without the setting if Anthropic rejects it.
- Use the current Claude generation: Sonnet 5.5 for coding/design and Haiku 5.5 for quick answers, falling back to Sonnet 5 and Haiku 4.5 (both still active). Add list prices to the session cost gauge.
- Start Live answers during the question's silence window (system audio, BYOK). The exact request is prepared early and used only if it is identical to the committed request; new speech or any change aborts it.
- Simplify BYOK key setup in Settings: show which model answers quick and coding questions, list saved keys with Test, Replace and Remove, and replace the per-provider fields with one Add API key box. The box suggests the provider from the key format on the device and asks the user to confirm. Saved keys are unchanged.
- Make the Product insights privacy wording true:
  - Rage-click events now store only fixed control identifiers (`data-pi-target`, a clean `id`, or `section:role`), never a button's visible label. Labels could contain a document name, an interview question, a session label, the account name or a Duo room code.
  - The old `mm-product-intel-v1` store is deleted.
  - The breadcrumb opt-in now controls whether usage events reach the diagnostics log; previously they always did.
  - The Settings panel is renamed from "ARCH · Product Intelligence" to "Product insights", with scoped, accurate copy.
- Add `scripts/session-report.mjs`, which summarizes an exported diagnostics bundle per session and writes the Gate 0 rubric scoresheet.
- Document the planned ARCH professional model (`docs/PROFESSIONAL_MODEL.md`): today's data map, the Duo map, a minimal schema, gates and evaluation. Add the Gate 0 Live session protocol to `docs/EVALS.md`, and document the unsigned public preview route in `docs/RELEASE.md`.
- Document the hint context and output caps, Windows resizing rationale and personal BYOK recommendation and cost estimate in `docs/MODEL_AND_AUDIO_REVIEW.md`, with acceptance gates in `docs/RELEASE_CHECKLIST.md` §4b.

Published by `unsigned-public.yml` as an unsigned GitHub pre-release (Windows x64 NSIS, no auto-update feed); not code-signed. Still open (`docs/RELEASE_CHECKLIST.md` §4b):

- real-provider answer, timing and usage checks
- the Settings key flow and Product insights checks on the packaged build
- physical Windows collapse, drag and resize checks
- the Gate 0 session (`docs/EVALS.md`)

## v1.6.2 — 2026-10-12 (signed public release candidate)

Published on 2026-10-12 only as an unsigned personal preview (GitHub pre-release). No signed v1.6.2 build was produced.

- Centralize AI defaults, automatic routing priorities, key links and lifecycle policy; recover with provider-discovered compatible models and distinguish actionable provider failures.
- Remove Live/Solo model dropdowns and retain automatic operation-based routing from PRs #90/#91.
- Add microphone/system-playback preflight selection, carry the tested source into Live, invalidate voice readiness on device changes, and require manual confirmation for microphone questions.
- Use supported Deepgram streaming diarization parameters and reject conflicting/batch-only gateway settings.
- Fix collapsed badge minimum-size constraints and transparent backing, preserve drag/expand behavior, and provide consistent dashboard resizing and scrolling with sticky key-save actions.
- Align desktop package and lockfile versions to 1.6.2. Require signing in the stable workflow and electron-builder; never fall back to an unsigned artifact under the stable v1.6.2 release.

This is prepared source, not proof of a published or physically verified installer. The matching immutable tag/public release must follow CI, trusted Authenticode validation and packaged smoke. No v1.6.2 installer is claimed until its workflow succeeds.

## v1.6.1 — 2026-10-11 (unsigned delivery correction)

- Make the Windows release workflow choose one of two explicit modes: trusted signed stable release when all three signing settings exist, or an isolated unsigned BYOK-only pre-release when all three are absent. A partial signing configuration still fails closed.
- Keep unsigned installs separate from stable MockMate by using the Personal Preview app ID, executable, shortcuts, and user-data identity.
- Publish unsigned builds as pre-releases that are never marked latest, with an `UNSIGNED` filename, SHA-256 checksum, and warning notice. Exclude `latest.yml`, `app-update.yml`, and blockmaps so unsigned builds cannot enter the stable updater channel.
- Fix the personal-preview contract test so it derives the current package version instead of the obsolete hard-coded `1.5.5` value.
- Make release-signing tests valid in both checked-in signed configuration and generated unsigned-preview configuration, then run the complete suite plus an exact unsigned Windows package/smoke after transformation in pull-request CI.
- Suppress the unsigned build's embedded updater feed with `build.publish = null`. Deleting `publish` or setting it to `[]` does not work: electron-builder treats both as unconfigured and re-derives a GitHub feed from `GITHUB_TOKEN` or `.git/config`, then writes `resources/app-update.yml` anyway. A vitest gate now drives the real `app-builder-lib` resolution for all three cases, so the mistake fails in seconds instead of in a 45-minute Windows packaging job.
- Add `scripts/inspect-packaged-updater-metadata.mjs`, run before every unsigned/preview "no updater feed" gate. It prints the packaged `app-update.yml`, its SHA-256, the publish configuration electron-builder resolved and the reason, with CI token values redacted, and uploads the findings as an artifact when the job fails.

## v1.6.0 — 2026-10-11 (source release; no Windows installer assets)

PR #85 was merged and tag/release `v1.6.0` was created from commit `15133530c827d684941b27cf5160789026069f27`. Its Windows workflow stopped at the mandatory signing-settings gate because no Authenticode certificate was configured, so the release contains no installer assets. The latest usable signed Windows installer remains v1.5.3. Full feature notes: [`docs/RELEASE_NOTES_v1.6.0.md`](docs/RELEASE_NOTES_v1.6.0.md).

### Interview preparation workspace
- Add Home, Interview Kits, and Ready Room screens to the desktop shell, including Kit creation/editing, active-Kit selection, and Ready Room handoffs.
- Keep opportunity context, Solo drafts, and saved-session snapshots Kit-scoped; add locally stored, per-Kit supporting-document attachments for practice and Live while keeping the shared document library and profile isolated.
- Show honest pre-flight states for local services, configured providers, real AI/voice checks, and screen-share privacy; disclose possible provider usage. The demo preview uses synthetic data and disables external tests.

### Live and provider reliability
- Distinguish quota, rate-limit, transient, and mixed provider errors; honor retry metadata and preserve cooling-down/failover behavior.
- Preserve partial Live answers on stream failure without silently replaying a paid request; retry Deepgram token-grant rate limits and keep quota/auth errors actionable.
- Preserve the Live failover budget on Windows, wait for the local API service before key-reload restart, and improve bounded local-service/renderer lifecycle handling while retaining packaged `child_process.fork()`.

### Accessibility and operational feedback
- Associate visible labels with Solo, Live, Career, Jobs, and provider-setting fields; add keyboard-operable tab groups, named choice groups, accessible upload buttons, and announced upload/error/progress states.
- Preserve native keyboard navigation for the AI-mode choice, report updater and external-link failures, and prevent stale mouse-region IPC results from re-enabling click-through after it is switched off. Click-through now reports failures and refuses to enable without its recovery shortcut.
- Add an explicit, one-request provider connection test for configured local keys. The route is mounted only by the loopback desktop service (not the hosted managed backend), is offered only in the desktop app, and warns that the request may incur provider usage; it is not run automatically during routing.

### Candidate verification and release boundary
- Current per-Kit attachment worktree checks: 86 test files / 644 tests, API smoke 5/5, production build, Vite-output verification, platform/React/Vitest/dev-tooling/auth-config/Express checks, and `git diff --check`. These ran under Node 22.22.3; release CI pins Node 24. The aggregate `npm run verify` previously stopped before build/tests because `scripts/doctor.mjs` could not download the Electron runtime binary; see `docs/evidence/VALIDATION_STATUS.md`.
- Per-Kit feature commit `0445a894107289fe140129f4d6474aad6971a33d` passed `verify-desktop`, `windows-tests`, and Vercel checks in [run 38126143427](https://github.com/vsv2014/MockMate/actions/runs/38126143427). CI was unsigned validation, not physical-install certification; PR #85 was later merged into `main`.
- Physical Windows installation/audio, signed updater, actual meeting share-preview, and hosted WSS/Mongo/Deepgram usage reconciliation remain release gates. See [`docs/evidence/VALIDATION_STATUS.md`](docs/evidence/VALIDATION_STATUS.md).

## v1.5.5 — 2026-10-10 (superseded release candidate; never published)

Windows desktop release candidate incorporating the previously untagged v1.5.4 packaged-process hotfix and the October 4–9 reliability, privacy, metering, and platform updates. **This entry describes code merged into `main`, not a published or real-device-certified installer.**

### Live audio and AI reliability
- Guard system/microphone capture restarts, STT reconnect buffers, terminal streaming events, and provider failures; handle CRLF/CR SSE framing, avoid duplicate paid hint generation, and reacquire tracks that end without a `devicechange` event (PRs #64–#67, #73, #76).
- Save an account-scoped, bounded, 12-hour checkpoint of visible Live questions and AI suggestions for read-only recovery after unexpected renderer exit. This does **not** automatically restart audio, transcription, or billing (PR #75).
- Hosted **managed** streaming STT now uses authenticated, one-use backend WebSocket tickets and a bounded server-to-Deepgram gateway instead of sending a direct, long-lived provider grant to the desktop client. Limit each segment by time and PCM bytes; validate upstream parameters, enforce plan reservations, and settle on normal termination (PR #72). Local BYOK uses its separate direct-provider path.
- Graceful backend shutdown drains pending STT reservations and settlements before closing MongoDB (PR #74). **Abrupt process crashes and real provider-versus-billing reconciliation remain unverified.**

### Privacy, account switching, and local data
- Isolate saved job bookmarks/statuses/notes and Resume Studio drafts per account. Add schema v3→v4 migration for legacy installation-global values, preserving existing account-scoped values and reporting failed storage writes (PR #79).
- Prevent stale authentication responses, in-flight RAG embedding results, and cached document text from crossing account boundaries (PR #77).
- Preserve unreadable session-history/document JSON in account-scoped recovery backups before subsequent writes; fail closed if backup storage is unavailable (PR #77).
- Legacy global-data ownership remains ambiguous on shared installations; verify migration with two real accounts before public rollout.

### Runtime, security, and delivery
- Include the v1.5.4 correction for packaged Windows child-process `cwd` under `app.asar` and retain v1.5.3 installer/update handoff protections (PRs #52–#53).
- Upgrade to Electron 44, React 19, Vite 8, Vitest 5, Express 5.2.1, and refreshed dependencies, with corresponding smoke and regression checks (PRs #54–#62, #70).
- Avoid terminating unrelated processes on occupied local ports (PR #63).
- Require signed Windows public releases, verify the publisher/certificate, and keep PR-generated Windows builds **unsigned and validation-only** (PR #68).

### Verification and outstanding release gates
- Latest pre-documentation merge, PR #79: **80 application test files / 567 tests passed**, backend tests passed, production build and API smoke passed, and Linux/Windows CI passed including the packaged Windows renderer/runtime smoke. Evidence: https://github.com/vsv2014/MockMate/actions/runs/37877818087.
- Windows CI packaging does **not** certify a physical install, signed updater, microphone/system audio, Deepgram/Mongo deployment, meeting share-preview privacy, or a two-hour Live soak.
- Still required: signed release workflow secrets and actual Authenticode verification; physical Windows clean-install and upgrade checks; Live/Solo dry runs; two-account legacy migration; hosted WSS/Deepgram billing integration; and Zoom/Meet/Teams share-preview evidence. See `docs/RELEASE_CHECKLIST.md` and `docs/evidence/VALIDATION_STATUS.md`.
- `package.json` and `package-lock.json` are already **1.5.5**. The `v1.5.5` tag/release is not yet published. The v1.5.4 entry below was an interim hotfix recorded in the changelog but not published as a separate GitHub Release.

---

## v1.5.4 — 2026-10-04 (interim hotfix; not separately published)

Windows hotfix for packaged local-service startup. `child_process.fork()` can report `spawn MockMate.exe ENOENT` when the child working directory is invalid even if the executable itself exists. In packaged MockMate, both local services were started with a `cwd` under `app.asar`, which is a virtual archive path rather than a real Windows process directory.

### Fixed
- Normalize only MockMate's packaged `server-entry.cjs` forks to the real, writable Electron `userData` directory before the existing service supervisor runs.
- Keep the v1.5.3 installer/update handoff protections: no NSIS auto-run, no updater auto-relaunch, and no service forks while the installed executable is absent.
- Preserve all Solo/Live/Duo/UI behavior; this changes only child-process startup plumbing.

### Windows validation gate
- Install v1.5.4 over v1.5.3 with MockMate fully closed.
- Launch manually from Start/Desktop.
- Verify account sign-in service starts without ENOENT, then verify local UI/API, Solo, and Live startup.

---

## v1.5.3 — 2026-10-04

Windows hotfix for the installer/updater handoff that could leave a still-running MockMate process pointing at an executable path NSIS was replacing, causing local child services to fail with `spawn ... MockMate.exe ENOENT`.

### Fixed
- Disable NSIS `runAfterFinish` so fresh installs do not auto-launch MockMate while installation is still finalizing.
- Disable `electron-updater` post-install auto-relaunch before the existing Electron bootstrap loads.
- Add a pre-bootstrap packaged-app guard: if the installed executable is missing, MockMate does not start local account/API child services and instead exits with a repair/reopen instruction.
- Preserve all existing v1.5.2 runtime/bootstrap behavior after the new handoff gate passes.

### Windows validation gate
- Install v1.5.3 over v1.5.2 with MockMate fully closed.
- Confirm the installer finishes without auto-launching the app.
- Launch MockMate manually from Start/Desktop and verify sign-in/account service, local API, Solo, and Live startup.
- Repeat once through the in-app updater path when a newer test build is available.

---

## v1.5.2 — 2026-10-04

Windows-first desktop release focused on Live reliability, hybrid RAG, interview playbooks, managed auth/STT hardening, and release/deployment correctness.

### Added
- Camera-anchored `760×240` Teleprompter mode with multi-monitor preservation.
- Mode-scoped overlay shortcuts (`Alt+T`, `Alt+R`, `Alt+Up`, `Alt+Down`) and bounded `F7` capture with display memory.
- Layout-aware PDF extraction, section-aware hybrid retrieval, embedding-model-bound persistent cache, speculative RAG pre-warm, and Context Audit Trail badges.
- `CustomPromptStudio` / Interview Playbook presets across Live and Solo.
- Resume Studio, career/job tools, Skills/weakness analysis, and private-beta mobile foundations.
- ARCH policy plane with operation-scoped adaptive routing.
- Product Intelligence as **local/runtime adaptive telemetry** with privacy-safe structural signals. It is not hosted closed-loop analytics.
- Hosted email-verification flow with explicit verification-required client state.
- Managed STT quota enforcement for both streaming grants and uploaded transcription.

### Fixed
- Turn-1 system-audio question capture, including short imperative opener handling without broad greeting false positives.
- Teleprompter renderer/main-process mode synchronization after drag/resize.
- Global navigation policy so OAuth/job links can open without weakening URL validation.
- Desktop auth-token persistence failure handling.
- Account-scoped RAG deletion lifecycle and stale in-flight indexing resurrection race.
- Managed LLM/STT usage reservations so provider spend cannot race past plan limits.
- Upload transcription now server-probes MP4/M4A/WAV duration and reserves before Deepgram spend.
- Mongo LLM/STT release accounting clamps at zero.
- PiP/content-protection confirmation now verifies the actually protected window.
- Release workflow made version-generic; no stale `v1.5.1` branch/default remains.
- Vercel Hobby deployment reduced from 15 to **12 Serverless Functions** by consolidating four career/resume wrappers while preserving their public URLs.

### Verification
- 66 test suites / 478 tests, exit 0, zero unhandled errors.
- `npm run build` and `npm run smoke:api` pass.
- Ubuntu and Windows CI pass on the reviewed v1.5.2 branch.
- Packaged-Windows smoke, share-preview confirmation, hosted clean deploy, and v1.5.1 → v1.5.2 updater validation remain release gates until recorded in `docs/evidence/VALIDATION_STATUS.md`.

### Public artifact scope
- Windows NSIS is the v1.5.2 automated public release target.
- macOS/Linux are not claimed as automated v1.5.2 public artifacts from the current release workflow.
- Mobile remains private beta.

For detailed v1.5.2 behavior and boundaries, see `docs/RELEASE_NOTES_v1.5.2.md`, `docs/ARCHITECTURE.md`, and `docs/ROADMAP.md`.

---

## Earlier releases

Detailed historical entries for v1.4.x–v1.5.1 remain available in Git history and published GitHub Releases. The public documentation from v1.5.2 onward treats `docs/ARCHITECTURE.md` as current-state truth and `docs/ROADMAP.md` as future-state truth to avoid historical planning text being mistaken for shipped capability.
