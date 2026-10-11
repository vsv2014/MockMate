# Validation status — v1.6.0 release candidate

**As of 2026-10-11. Evidence is version- and commit-specific; do not infer a physical PASS from unit tests, code review, or an unsigned CI installer.**

- **Candidate source:** branch `arena/b60e7f0c-mockmate` / PR #85; version `1.6.0` in root `package.json` and `package-lock.json`. It is not merged to `main`, tagged, or published.
- **Latest stable public Windows release:** `v1.5.3`. The v1.5.4 hotfix and v1.5.5 source candidate were not stable releases.
- **Local candidate checks (2026-10-11):** `npm test` — **83 files / 627 tests passed**; `npm run smoke:api` — **4 tests passed**; `npm run build`, `npm run verify:vite-output`, `git diff --check`, and the platform, React 19, Vitest 5, dev-tooling, auth/config, and Express 5 contract checks passed. These ran under the sandbox's Node 22.22.3; the release workflow pins Node 24, as required by `package.json`.
- **Current candidate CI:** [run 38118183667](https://github.com/vsv2014/MockMate/actions/runs/38118183667) passed Linux verification, Windows validation-installer/runtime smoke, and Vercel checks on the pushed v1.6.0 head. The earlier reliability-only run was [38116194648](https://github.com/vsv2014/MockMate/actions/runs/38116194648).
- **Production readiness:** **NOT CERTIFIED.** This source verification does not include a signed public build, physical Windows install/audio/share-preview test, or a real hosted WSS/Mongo/Deepgram usage reconciliation.

| Item | Status | Evidence / remaining requirement |
|---|---|---|
| Package/lock version | CODE VERIFIED | Root `package.json.version` and `package-lock.json` root version are `1.6.0`. No stable v1.6.0 tag/release has been created. |
| Local candidate checks | PASS (sandbox) | 83 test files / 627 tests; API smoke 4/4; Vite production build/output check; platform/React 19/Vitest 5/dev-tooling/auth-config/Express 5 contracts; `git diff --check`. The pushed candidate also passed supported-Node Linux/Windows CI in run 38118183667. |
| Current PR #85 CI | PASS | [Run 38118183667](https://github.com/vsv2014/MockMate/actions/runs/38118183667): Linux verification, Windows validation installer/runtime smoke, and Vercel checks passed on the current v1.6.0 head. |
| Home / Interview Kits / Ready Room | CODE + UNIT VERIFIED; PACKAGED UI UNVERIFIED | App shell navigation, Kit persistence/profile mapping and Kit-scoped history/drafts are wired and covered by library/history tests. Exercise all flows in the packaged candidate, including Ready Room → Live. |
| Packaged Windows React launch/navigation | CI PASS (unsigned); physical install unverified | Current [run 38118183667](https://github.com/vsv2014/MockMate/actions/runs/38118183667) built and smoke-tested a Windows validation artifact. It is not a physical signed-install certification. |
| Windows Authenticode signature/publisher | NOT VERIFIED | Public release requires `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD`, and `MOCKMATE_WINDOWS_PUBLISHER`, plus signature verification on installer and executable. |
| Physical Windows clean install / updater | NOT VERIFIED | Test a signed v1.6.0 over the last published v1.5.3, including the unsigned-to-signed transition and local-data preservation. No v1.5.4 public release exists. |
| Packaged Solo practice / evaluation soak | NOT VERIFIED | Test with actual speaker/microphone/provider, complete evaluation, and restart on Windows. |
| Packaged Live mic/system audio soak | NOT VERIFIED | Test real devices, noisy interviews, source changes, sleep/wake, reconnect, pause/Stop, turn commit, hints, and a sustained session. |
| Live interrupted renderer notes recovery | CODE/UNIT VERIFIED; DEVICE UNVERIFIED | Recovery is read-only and must not automatically resume audio, transcription, generation, or billing. Kill/relaunch physical app and verify it. |
| Managed Live gateway + metering | CODE/UNIT VERIFIED; HOSTED UNVERIFIED | Real Mongo/TLS/WSS/Deepgram E2E, provider-usage reconciliation, and abrupt-crash ledger recovery remain outstanding if Managed AI is shipped. |
| Account-switch and RAG privacy | CODE/UNIT VERIFIED; DEVICE UNVERIFIED | PR #77 coverage blocks stale account auth/embedding responses and preserves corrupt document/history bytes; test physical multi-account upgrade. |
| Saved jobs / Resume Studio migration | CODE/UNIT VERIFIED; DEVICE UNVERIFIED | PR #79 scope v3→v4; verify first-account legacy-global ownership, A/B sign-in, Guest, logout/relogin, and account deletion on a real upgrade. |
| Diagnostics export / redaction / Product Intelligence | CODE/UNIT VERIFIED; DEVICE UNVERIFIED | Verify physical export contains no keys/tokens, prompts, transcripts, or screenshots. Product Intelligence remains local/runtime adaptive telemetry only. |
| Meeting share-preview / content protection | NOT VERIFIED | Record actual Zoom/Meet/Teams window and full-display previews. Content protection is platform/mode-dependent and does not guarantee invisibility. Linux protection is unsupported. |
| Default desktop backend | CODE VERIFIED | `managedApiBase` is empty by default. The local UI/AI service is expected; Guest mode bypasses account authentication, not the local service. |
| Hosted Vercel / WSS deployment | HOSTED UNVERIFIED | Deployment shape is constrained to 12 Vercel functions; validate production HTTPS/WSS routing, Mongo, and provider use before enabling Managed AI. |
| 120-minute continuous usage | NOT VERIFIED | Do not claim a two-hour session without timed packaged evidence. |
| macOS/Linux public installers | NOT IN CURRENT RELEASE WORKFLOW | Public workflow builds signed Windows NSIS only; do not claim macOS DMG or Linux AppImage publication. |
| Release freeze | OPEN | Candidate is unmerged and untagged. Complete all checklist/evidence gates on reviewed `main` before creating a v1.6.0 tag or publishing. |

**Release decision: BLOCKED pending fresh CI on the final candidate, physical Windows checks, trusted signing, and—if Managed AI is shipped—hosted WSS/Mongo/Deepgram reconciliation.**

Evidence templates: [Live dry run](LIVE_DRY_RUN_TEMPLATE.md), [Live audit](LIVE_BUG_AUDIT.md), [release checklist](../RELEASE_CHECKLIST.md), [screen-share matrix](../STEALTH_BROWSER_MATRIX.md).