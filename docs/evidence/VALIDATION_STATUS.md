# Validation status — v1.6.0 release candidate

**As of 2026-10-11. Evidence is version- and commit-specific; do not infer a physical PASS from unit tests, code review, or an unsigned CI installer.**

- **Candidate source:** branch `arena/b60e7f0c-mockmate` / PR #85; version `1.6.0` in root `package.json` and `package-lock.json`. It is not merged to `main`, tagged, or published.
- **Latest stable public Windows release:** `v1.5.3`. The v1.5.4 hotfix and v1.5.5 source candidate were not stable releases.
- **Audit-remediation checks (2026-10-11):** `npx vitest run` — **84 files / 630 tests passed**; `npm run smoke:api` — **5 tests passed**; `npm run build`, `npm run verify:vite-output`, Electron syntax checks, and `git diff --check` passed under sandbox Node 22.22.3. The aggregate `npm run verify` stopped in `scripts/doctor.mjs` before build/tests because the Electron runtime download failed (`fetch failed`; the sandbox cannot reach its download host). The release workflow pins Node 24, as required by `package.json`.
- **Previous candidate CI (pre-remediation):** [run 38118183667](https://github.com/vsv2014/MockMate/actions/runs/38118183667) passed Linux verification, Windows validation-installer/runtime smoke, and Vercel checks on the earlier pushed v1.6.0 head. It does not certify the audit-remediation diff. The earlier reliability-only run was [38116194648](https://github.com/vsv2014/MockMate/actions/runs/38116194648).
- **Production readiness:** **NOT CERTIFIED.** This source verification does not include a signed public build, physical Windows install/audio/share-preview test, or a real hosted WSS/Mongo/Deepgram usage reconciliation.

| Item | Status | Evidence / remaining requirement |
|---|---|---|
| Package/lock version | CODE VERIFIED | Root `package.json.version` and `package-lock.json` root version are `1.6.0`. No stable v1.6.0 tag/release has been created. |
| Audit-remediation checks | PASS (sandbox; targeted) | 84 test files / 630 tests; API smoke 5/5; Vite production build/output check; Electron syntax checks; `git diff --check`. `npm run verify` remains blocked before tests/build because Electron runtime download failed in the sandbox. Node 22.22.3 was used; release CI requires Node 24. |
| Previous candidate CI | PASS (pre-remediation only) | [Run 38118183667](https://github.com/vsv2014/MockMate/actions/runs/38118183667) passed Linux verification, Windows validation installer/runtime smoke, and Vercel checks before the audit-remediation diff. New CI is required for this diff. |
| Home / Interview Kits / Ready Room | CODE + UNIT VERIFIED; PACKAGED UI UNVERIFIED | App shell navigation, Kit persistence/profile mapping and Kit-scoped history/drafts are wired and covered by library/history tests. Exercise all flows in the packaged candidate, including Ready Room → Live. |
| Accessibility and form feedback remediation | CODE/BUILD VERIFIED; SCREEN-READER UNVERIFIED | Accessible labels, keyboard tabs/choice groups, upload controls, and status/error announcements are implemented. Validate with keyboard-only and screen-reader use on the packaged app. |
| Click-through recovery | CODE VERIFIED; DESKTOP RUNTIME UNVERIFIED | Main-process results and Alt+C recovery checks are wired with stale-region protection. Verify mouse recovery and overlay hit regions on Windows/macOS; this code-level check does not replace desktop runtime testing. |
| Provider connection test | UNIT/CODE VERIFIED; LIVE KEYS UNVERIFIED | The explicit one-request local-key probe has mocked unit coverage and is exposed only in Electron. No live provider credentials were used; confirm per-provider behavior and any usage charge before relying on it. |
| Packaged Windows React launch/navigation | CI PASS (unsigned; pre-remediation); physical install unverified | Previous [run 38118183667](https://github.com/vsv2014/MockMate/actions/runs/38118183667) built and smoke-tested a Windows validation artifact before this diff. It is not a physical signed-install certification or verification of the current changes. |
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