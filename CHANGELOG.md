# Changelog

## v1.5.4 — 2026-10-04

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
