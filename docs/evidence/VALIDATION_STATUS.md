# Validation status — v1.5.5 release candidate

**As of 2026-10-10. Status is evidence-based; do not infer a physical PASS from unit tests, code review, or an unsigned CI installer.**

- **Source version:** `1.5.5` in both root package manifests. The candidate is **not** a published GitHub Release. Latest published GitHub Release: `v1.5.3`; v1.5.4 was an untagged interim fix.
- **Reviewed source baseline:** merged `main` at `69fd857a79f47d81925b7554116f15d8fd1650b2` (PR #79) before release-documentation changes.
- **CI evidence:** [run 37877818087](https://github.com/vsv2014/MockMate/actions/runs/37877818087), Linux + Windows success. 80 application test files / 567 tests, backend tests, API smoke, build, unsigned validation Windows installer, packaged runtime and real React renderer/navigation smoke.
- **Production readiness:** **NOT CERTIFIED.** Signed public workflow and physical host/device coverage were not observed.

| Item | Status | Evidence / remaining requirement |
|---|---|---|
| Package/lock version | CODE VERIFIED | `package.json.version` and root `package-lock.json.version` / root package entry are `1.5.5`. |
| Latest merged desktop code CI | CI PASS | [Run 37877818087](https://github.com/vsv2014/MockMate/actions/runs/37877818087): 80 application files/567 tests, backend tests, smoke/build, Linux and Windows jobs succeeded. Re-run for any changed candidate commit. |
| Packaged Windows React launch/navigation | CI PASS (unsigned) | PR #70 added actual renderer smoke; latest PR #79 Windows CI passed. **This is not a clean physical signed-install certification.** |
| Windows Authenticode signature/publisher | NOT VERIFIED | Production release requires `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD`, `MOCKMATE_WINDOWS_PUBLISHER`; no signed v1.5.5 public workflow result recorded. |
| Physical Windows clean install / updater | NOT VERIFIED | Verify signed `v1.5.5` over the last published `v1.5.3`, including unsigned-to-signed transition. No v1.5.4 public release exists. |
| Packaged Solo practice / evaluation soak | NOT VERIFIED | Physical Windows speaker/microphone/provider session, report and restart; attach build ID and evidence. |
| Packaged Live mic/system audio soak | NOT VERIFIED | Use real devices, noisy interviews, source changes, sleep/wake, reconnect, pause/Stop, turn commit, hints, and long session. |
| Live interrupted renderer notes recovery | CODE/UNIT VERIFIED; DEVICE UNVERIFIED | PR #75 account-scoped read-only checkpoint. Kill/relaunch physical app and verify recovered question/hint notes; no provider calls automatically resume. |
| Managed Live streaming gateway + metering | CODE/UNIT VERIFIED; HOSTED UNVERIFIED | PR #72 authenticated backend WSS, per-segment cap and reservation; PR #74 graceful settlement drain. Need Mongo/TLS/WSS/Deepgram E2E, real provider-usage reconciliation, abrupt-crash ledger recovery. |
| Account-switch and RAG privacy | CODE/UNIT VERIFIED; DEVICE UNVERIFIED | PR #77 blocks stale account auth/embedding responses and preserves corrupt document/history bytes; physical multi-account check outstanding. |
| Saved jobs / Resume Studio migration | CODE/UNIT VERIFIED; DEVICE UNVERIFIED | PR #79 scope v3→v4 + per-account data; first-account legacy-global ownership and A/B sign-in/Guest/delete-account must be checked on real upgrade. |
| Diagnostics export, redaction, Product Intelligence | CODE/UNIT VERIFIED; DEVICE UNVERIFIED | Sanitizer tests pass; verify physical export contains no tokens, prompts, transcript raw content or screenshots. Product Intelligence is local/runtime adaptive telemetry only. |
| Windows overlay content protection | UNKNOWN | Actual Zoom / Meet / Teams full-display and window share previews not recorded. Content protection is OS/capture-mode-dependent. |
| Linux overlay content protection | NOT SUPPORTED | Linux has no equivalent implemented OS content-protection API. |
| Hosted Vercel build/deployment | CODE SHAPE FIXED; HOSTED VERIFY | Vercel Hobby 12-function shape (PR #46); production HTTPS deployments, gateway WS routing and end-to-end provider/auth checks not certified. |
| 120-minute continuous usage | NOT VERIFIED | Code handles recovery paths; cannot claim a two-hour session without recorded timed test. |
| Electron / React / Vite / Vitest platform upgrades | CODE/CI VERIFIED; DEVICE UNVERIFIED | Electron 44, React 19, Vite 8, Vitest 5; include packaged real-device check for audio, drag, modal, copy, updater. |
| macOS/Linux public installers | NOT IN CURRENT RELEASE WORKFLOW | Public workflow builds signed Windows NSIS only; do not claim macOS DMG or Linux AppImage publication. |
| Release freeze | OPEN | Freeze only after the evidence gates, update signer/release metadata, tag/release, then post-publish smoke. |

**Release decision as recorded here: BLOCKED pending physical Windows, trusted signing, and—if Managed AI is published—hosted WebSocket/Mongo/Deepgram reconciliation.**

Evidence templates: [Live dry run](LIVE_DRY_RUN_TEMPLATE.md), [Live audit](LIVE_BUG_AUDIT.md), [release checklist](../RELEASE_CHECKLIST.md), [screen-share matrix](../STEALTH_BROWSER_MATRIX.md).
