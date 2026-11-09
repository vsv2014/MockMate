# Validation status

## v1.6.9 unsigned Personal Preview (2026-11-09; Live transcript/scoring status)

**Evidence is version-specific. This is NOT physical device certification.**

- **Source fix:** [PR #129](https://github.com/vsv2014/MockMate/pull/129) merged as `1431a02ce5be7c74386b465dc83fcfd48e7ae1db`; Linux and Windows source/packaged smoke [run 42609817184](https://github.com/vsv2014/MockMate/actions/runs/42609817184) passed.
- **Release:** [PR #133](https://github.com/vsv2014/MockMate/pull/133) merged as `666e82b54f3acc0f4b36dba16c5a5989715daa9a`; versioned [Desktop CI run 42610707338](https://github.com/vsv2014/MockMate/actions/runs/42610707338) passed.
- **Unsigned publication:** [workflow run 42611395447](https://github.com/vsv2014/MockMate/actions/runs/42611395447) completed successfully. [GitHub release v1.6.9](https://github.com/vsv2014/MockMate/releases/tag/v1.6.9) exposes the uploaded UNSIGNED EXE, personal preview notice and SHA256SUMS; isolated BYOK app identity and update-feed absence validated by CI.
- **Reported v1.6.8 Windows session:** 16-minute Live session, 160 final STT segments, 26 committed interviewer questions, 23 hints; no candidate responses in saved speech turns; not scored. `mergeTurns()` had collapsed interviewer-only questions into one paragraph. v1.6.9 now retains distinct committed question IDs for transcript merging. Context-sensitive domain STT keyterms and candidate-capture status were added.
- **Still OPEN physically:** actual microphone attribution to candidate, headset/system-loopback output, Windows installer/userData preservation, RAG/LangChain/LangGraph word recognition against source audio, screen-share stealth checks and feedback score accuracy. CI cannot prove any of these on the user's laptop.
- **Unresolved other findings:** five `VISION_UNAVAILABLE` screenshot requests [#130](https://github.com/vsv2014/MockMate/issues/130); nine preflight `/api/hint` HTTP 502 [#132](https://github.com/vsv2014/MockMate/issues/132). Future explicit opt-in two-source candidate scoring is [#131](https://github.com/vsv2014/MockMate/issues/131). None is claimed fixed by v1.6.9.


## v1.6.8 unsigned Personal Preview (2026-11-09; Ready Room fixes)

**Evidence is commit- and version-specific. This is NOT a physically certified release.**

- **Source:** feature fix #124 (merged `dbb8919330379e0501b6648ae9048cbbbc43fac0`) followed by release-version #126 (merged `da2aff5f552a790672e29e0c30fa551b44654a15`).
- **Issues addressed:** management sidebar icon/label collisions and oversized Ready Room copy; explanatory AI smoke erroneously failing with `code_missing`; readiness failures displayed as Pending; microphone versus System Audio verification ambiguity; system-playback Deepgram finalization before test teardown.
- **Implementation CI:** [PR #124 Desktop CI run 42600260034](https://github.com/vsv2014/MockMate/actions/runs/42600260034) passed Linux security/tests/build and Windows packaged smoke. [PR #126 run 42601081173](https://github.com/vsv2014/MockMate/actions/runs/42601081173) passed same checks for version 1.6.8.
- **Unsigned publication:** [release workflow run 42601710957](https://github.com/vsv2014/MockMate/actions/runs/42601710957) completed. [GitHub release v1.6.8](https://github.com/vsv2014/MockMate/releases/tag/v1.6.8) contains the isolated Personal Preview installer, SHA256SUMS and notice; no updater feed or stable release replacement.
- **Physical Windows verification: NOT DONE.** Check sidebar/Ready Room layout at common display scales, real provider answer for a conceptual hash-map question, separate microphone and actual system-playback final transcript through the chosen Windows output, sign-in/storage, updated preview identity, and Zoom/Meet/Teams share preview. If playback fails, preserve redacted diagnostics and identify the capture source and output device. A real device could still expose an OS/driver/permission issue despite CI.
- **Follow-up:** [#125 desktop-wide typography audit](https://github.com/vsv2014/MockMate/issues/125) tracks similar potential clipping in Jobs, Resume Studio, Settings, Solo and Duo.


## v1.6.5 unsigned personal preview (2026-10-13, v1.6.4 hotfix)

**Evidence is version- and commit-specific. Do not infer a physical PASS from unit tests, code review or an unsigned CI installer.**

- **Source:** branch `arena/603b5bc9-mockmate` (PR from `main` at `ba4e8d7`, the v1.6.4 merge commit). Version `1.6.5` in `package.json` and both lockfile fields.
- **Defects fixed (each reproduced on v1.6.4 code first):**
  - Collapsed badge (the reported blocker): the signed-in stage (`.mm-ready-stage`, `position:fixed; inset:0`, `background:#0B0D12`) stayed opaque while collapsed, painting any window area beyond the 72×72 badge black; v1.6.4's `<style>body{background:transparent!important}</style>` band-aid targeted an already-transparent `body` from a single badge render path. Independently, the native window could grow while dragged: Windows adds a phantom strip to small frameless transparent windows whose size varies with the display ([electron#41190](https://github.com/electron/electron/issues/41190)) and re-applies min/max from the *observed* bounds on every move of a `resizable:false` window ([electron#13043](https://github.com/electron/electron/issues/13043)). No physical Windows reproduction was possible in this environment — the mechanism comes from those reports plus the code path, and is simulated in `electron/window-mode.test.js`.
  - Ready Room: `<aside style="display:none">` held the session summary, readiness rail and the only Live action button.
  - OpenRouter: `write-env`'s allowlist in `electron/bootstrap.cjs` dropped `OPENROUTER_API_KEY`/`OPENROUTER_MODEL`; `hasApiKeys()` ignored the key; `remove-provider-key` had no `openrouter` entry; `setup.html` had no field. `ANTHROPIC_SONNET_MODEL` was dropped by the same allowlist.
  - UI: `@import "tailwindcss";` in `src/styles.css` shipped Tailwind Preflight to every screen (built CSS contained `h1,…,h6{font-size:inherit;font-weight:inherit}` and the list reset).
- **Automated checks on the hotfix head:**
  - `npx vitest run`: **107 files / 839 tests passed**
  - the five new contract tests fail on the v1.6.4 sources and pass here (`src/journey/ReadyRoom.render.test.js`, `electron/provider-key-plumbing.test.js`, `src/designSystem.test.js`, `src/collapsedPill.test.js`, `electron/window-mode.test.js` — 7 of those 14 pill assertions fail on `ba4e8d7`, including the drag-growth guard over 25 consecutive drags)
  - `vite build` passed; the emitted stylesheet contains the `theme` and `utilities` layers and no Preflight `base` layer; `npm run verify:vite-output` and `npm run smoke:api` passed
  - `scripts/doctor.mjs` stops only because the sandbox cannot download the Electron runtime (unchanged from v1.6.3 evidence)
  - PR CI (`windows-tests`, `verify-desktop`, Vercel) must pass before merge
  - the release workflow repeats tests, the build and a packaged smoke test on Windows
- **Not verified (must not be claimed as passing):**
  - Settings key flow and Ready Room → Live on a real packaged Windows build
  - real-provider Live timing, usage and OpenRouter routing
  - physical Windows collapse, drag and resize — including the collapsed-badge transparency and drag-growth checks in `docs/RELEASE_CHECKLIST.md` §4b, which this release turns into the acceptance test for the reported blocker
  - whether Windows still reserves an invisible (now transparent) strip below the badge on the reporter's display
  - meeting share preview
  - the Gate 0 session (`docs/EVALS.md`)
- **Production readiness:** **NOT CERTIFIED.**

## v1.6.3 unsigned personal preview (2026-10-13)

**Evidence is version- and commit-specific. Do not infer a physical PASS from unit tests, code review or an unsigned CI installer.**

- **Source:** `main` after PR #94 (#93's squash plus #94). Version `1.6.3` in `package.json` and both lockfile fields.
- **Publication:** requested through `unsigned-public.yml` as an unsigned GitHub pre-release (Windows x64 NSIS, no updater feed). The latest signed stable Windows release remains `v1.5.3`. v1.6.2 is the prior unsigned preview and does not contain #93.
- **Automated checks on the release head:**
  - `npx vitest run`: **102 files / 804 tests passed**
  - `vite build` passed and `git diff --check` is clean
  - `scripts/doctor.mjs` stops only because the sandbox cannot download the Electron runtime
  - PR CI (`windows-tests`, `verify-desktop`, Vercel) must pass before merge
  - the release workflow repeats tests, the build and a packaged smoke test on Windows
- **Not verified:**
  - real-provider Live timing and usage
  - the early answer start in a real meeting
  - the Settings key flow and Product insights checks on the packaged build
  - physical Windows collapse, drag and resize
  - meeting share preview
  - the Gate 0 session (`docs/EVALS.md`)
- **Production readiness:** **NOT CERTIFIED.**

## v1.6.0 release candidate (historical)


**As of 2026-10-11. Evidence is version- and commit-specific; do not infer a physical PASS from unit tests, code review, or an unsigned CI installer.**

- **Candidate source:** branch `arena/b60e7f0c-mockmate` / PR #85; version `1.6.0` in root `package.json` and `package-lock.json`. It is not merged to `main`, tagged, or published.
- **Latest stable public Windows release:** `v1.5.3`. The v1.5.4 hotfix and v1.5.5 source candidate were not stable releases.
- **Current per-Kit attachment worktree checks (2026-10-11):** `npx vitest run` — **86 files / 644 tests passed**; `npm run smoke:api` — **5 tests passed**; `npm run build`, `npm run verify:vite-output`, platform/React/Vitest/dev-tooling/auth/Express checks, and `git diff --check` passed under sandbox Node 22.22.3. The aggregate `npm run verify` previously stopped in `scripts/doctor.mjs` before build/tests because the Electron runtime download failed (`fetch failed`; the sandbox cannot reach its download host). The release workflow pins Node 24, as required by `package.json`.
- **Latest PR-head CI (2026-10-11):** [run 38126406179](https://github.com/vsv2014/MockMate/actions/runs/38126406179) passed `verify-desktop`, `windows-tests`, and Vercel checks on head `e34229089c12807fbddd8255dcbdde4f58795604`. This remains an unsigned CI validation, not a physical install or signed-release certification.
- **Production readiness:** **NOT CERTIFIED.** This source verification does not include a signed public build, physical Windows install/audio/share-preview test, or a real hosted WSS/Mongo/Deepgram usage reconciliation.

| Item | Status | Evidence / remaining requirement |
|---|---|---|
| Package/lock version | CODE VERIFIED | Root `package.json.version` and `package-lock.json` root version are `1.6.0`. No stable v1.6.0 tag/release has been created. |
| Per-Kit attachment checks | PASS (sandbox + CI) | 86 test files / 644 tests; API smoke 5/5; Vite production build/output; platform, React 19, Vitest 5, dev-tooling, auth-config, and Express checks; `git diff --check`. `npm run verify` previously stopped before build/tests because Electron runtime download failed in the sandbox. Node 22.22.3 was used; release CI requires Node 24. |
| Latest PR-head CI | PASS (unsigned; physical install unverified) | [Run 38126406179](https://github.com/vsv2014/MockMate/actions/runs/38126406179) passed `verify-desktop`, `windows-tests`, and Vercel checks on PR head `e34229089c12807fbddd8255dcbdde4f58795604`. |
| Home / Interview Kits / Ready Room | CODE + UNIT VERIFIED; PACKAGED UI UNVERIFIED | App shell navigation, Kit persistence/profile mapping and Kit-scoped history/drafts are wired. Per-Kit PDF/TXT/Markdown storage, selection, account/Kit isolation, retrieval ownership, and cleanup on Kit deletion have unit coverage. Exercise upload, selection, Ready Room → Live, and Solo flows in the packaged candidate. |
| Accessibility and form feedback remediation | CODE/BUILD VERIFIED; SCREEN-READER UNVERIFIED | Accessible labels, keyboard tabs/choice groups, upload controls, and status/error announcements are implemented. Validate with keyboard-only and screen-reader use on the packaged app. |
| Click-through recovery | CODE VERIFIED; DESKTOP RUNTIME UNVERIFIED | Main-process results and Alt+C recovery checks are wired with stale-region protection. Verify mouse recovery and overlay hit regions on Windows/macOS; this code-level check does not replace desktop runtime testing. |
| Provider connection test | UNIT/CODE VERIFIED; LIVE KEYS UNVERIFIED | The explicit one-request local-key probe has mocked unit coverage and is exposed only in Electron. No live provider credentials were used; confirm per-provider behavior and any usage charge before relying on it. |
| Packaged Windows React launch/navigation | CI PASS (unsigned); physical install unverified | [Run 38126406179](https://github.com/vsv2014/MockMate/actions/runs/38126406179) passed Windows validation-installer/runtime smoke on the latest PR head. It is not a physical signed-install certification. |
| Windows Authenticode signature/publisher | NOT VERIFIED | Public release requires `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD`, and `MOCKMATE_WINDOWS_PUBLISHER`, plus signature verification on installer and executable. |
| Physical Windows clean install / updater | NOT VERIFIED | Test a signed v1.6.0 over the last published v1.5.3, including the unsigned-to-signed transition and local-data preservation. No v1.5.4 public release exists. |
| Packaged Solo practice / evaluation soak | NOT VERIFIED | Test with actual speaker/microphone/provider, complete evaluation, and restart on Windows. |
| Packaged Live mic/system audio soak | NOT VERIFIED | Test real devices, noisy interviews, source changes, sleep/wake, reconnect, pause/Stop, turn commit, hints, and a sustained session. |
| Live interrupted renderer notes recovery | CODE/UNIT VERIFIED; DEVICE UNVERIFIED | Recovery is read-only and must not automatically resume audio, transcription, generation, or billing. Kill/relaunch physical app and verify it. |
| Managed Live gateway + metering | CODE/UNIT VERIFIED; HOSTED UNVERIFIED | Real Mongo/TLS/WSS/Deepgram E2E, provider-usage reconciliation, and abrupt-crash ledger recovery remain outstanding if Managed AI is shipped. |
| Account-switch and RAG privacy | CODE/UNIT VERIFIED; DEVICE UNVERIFIED | Account-scope tests block stale account auth/embedding responses and preserve corrupt document/history bytes. New coverage confirms Kit attachments with the same Kit ID stay isolated between accounts and retrieval excludes shared/other-Kit content. Test physical multi-account upgrade. |
| Saved jobs / Resume Studio migration | CODE/UNIT VERIFIED; DEVICE UNVERIFIED | PR #79 scope v3→v4; verify first-account legacy-global ownership, A/B sign-in, Guest, logout/relogin, and account deletion on a real upgrade. |
| Diagnostics export / redaction / Product Intelligence | CODE/UNIT VERIFIED; DEVICE UNVERIFIED | Verify physical export contains no keys/tokens, prompts, transcripts, or screenshots. Product Intelligence remains local/runtime adaptive telemetry only. |
| Meeting share-preview / content protection | NOT VERIFIED | Record actual Zoom/Meet/Teams window and full-display previews. Content protection is platform/mode-dependent and does not guarantee invisibility. Linux protection is unsupported. |
| Default desktop backend | CODE VERIFIED | `managedApiBase` is empty by default. The local UI/AI service is expected; Guest mode bypasses account authentication, not the local service. |
| Hosted Vercel / WSS deployment | HOSTED UNVERIFIED | Deployment shape is constrained to 12 Vercel functions; validate production HTTPS/WSS routing, Mongo, and provider use before enabling Managed AI. |
| 120-minute continuous usage | NOT VERIFIED | Do not claim a two-hour session without timed packaged evidence. |
| macOS/Linux public installers | NOT IN CURRENT RELEASE WORKFLOW | Public workflow builds signed Windows NSIS only; do not claim macOS DMG or Linux AppImage publication. |
| Release freeze | OPEN | Candidate is unmerged and untagged. Complete all checklist/evidence gates on reviewed `main` before creating a v1.6.0 tag or publishing. |

**Release decision: BLOCKED pending physical Windows checks and trusted signing, plus hosted WSS/Mongo/Deepgram reconciliation if Managed AI is shipped. CI passes but does not satisfy these production gates.**

Evidence templates: [Live dry run](LIVE_DRY_RUN_TEMPLATE.md), [Live audit](LIVE_BUG_AUDIT.md), [release checklist](../RELEASE_CHECKLIST.md), [screen-share matrix](../STEALTH_BROWSER_MATRIX.md).