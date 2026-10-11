# Changelog

## v1.6.0 — 2026-10-11 (release candidate; not published)

Feature-release candidate on PR #85’s branch. Not merged, tagged, or published. The latest published stable release remains v1.5.3; v1.5.5 was an unpublished source candidate. Full notes and release gates: [`docs/RELEASE_NOTES_v1.6.0.md`](docs/RELEASE_NOTES_v1.6.0.md).

### Interview preparation workspace
- Add Home, Interview Kits, and Ready Room screens to the desktop shell, including Kit creation/editing, active-Kit selection, and Ready Room handoffs.
- Keep opportunity context, Solo drafts, and saved-session snapshots Kit-scoped; prevent Kit sessions from attaching the shared document library or overwriting the shared profile.
- Show honest pre-flight states for local services, configured providers, real AI/voice checks, and screen-share privacy; disclose possible provider usage. The demo preview uses synthetic data and disables external tests.

### Live and provider reliability
- Distinguish quota, rate-limit, transient, and mixed provider errors; honor retry metadata and preserve cooling-down/failover behavior.
- Preserve partial Live answers on stream failure without silently replaying a paid request; retry Deepgram token-grant rate limits and keep quota/auth errors actionable.
- Preserve the Live failover budget on Windows, wait for the local API service before key-reload restart, and improve bounded local-service/renderer lifecycle handling while retaining packaged `child_process.fork()`.

### Candidate verification and release boundary
- Local v1.6.0 candidate checks passed: 83 test files / 627 tests, API smoke 4/4, production build, Vite-output verification, platform/React 19/Vitest 5/dev-tooling/auth-config/Express 5 contract checks, and `git diff --check`. These ran under Node 22.22.3; release CI pins Node 24.
- The PR #85 reliability-only head passed Linux/Windows Desktop CI; fresh CI is required for the final pushed candidate.
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
