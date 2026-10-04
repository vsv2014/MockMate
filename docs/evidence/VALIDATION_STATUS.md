# Validation status (release gate honesty)

Update this file whenever a packaged soak or stealth dry-run is completed.
Do **not** mark PASS from code review alone.

| Item | Status | As of | Notes |
|------|--------|-------|-------|
| Packaged Solo soak | NOT VERIFIED | 2026-10-04 (v1.5.2 code) | Run on the GitHub-built Windows installer; attach evidence before calling the release proven |
| Packaged Live soak | NOT VERIFIED | 2026-10-04 (v1.5.2 code) | Replay the SysCloud cases: CTE/polling/RBAC/CI, corrections, standalone topic switches, logistics, coding and provider recovery |
| Windows auto-update v1.5.1 → v1.5.2 | NOT VERIFIED | 2026-10-04 | Keep the v1.5.1 NSIS install; verify Checking → Downloading → Ready → Restart & install without uninstalling |
| Diagnostic export/redaction + ARCH Product Intelligence | CODE VERIFIED | 2026-10-04 | Sanitizer + zero-PII `productIntelligence` tests pass; Product Intelligence is local/runtime adaptive telemetry, not hosted closed-loop analytics; export/rotation still needs one packaged Windows click-through |
| Vercel hosted deployment | CODE/SHAPE FIXED; DEPLOY VERIFY | 2026-10-04 | Hobby deployment was reduced from 15 to 12 Serverless Functions via PR #46; obtain one clean deployment before calling hosted release verified |
| UX freeze | OPEN | 2026-10-04 | Freeze after packaged v1.5.2 Live/Solo/Resume/Jobs/History/updater/diagnostic-export checks |
| Stealth / share-preview matrix | UNKNOWN | 2026-08-19 | See `STEALTH_BROWSER_MATRIX.md` — Win/macOS combinations still require real share-preview validation |
| 120-minute continuous usage | NOT VERIFIED | 2026-08-19 | Designed for reconnect/token refresh; **do not claim** until timed packaged session |
| Unit + `smoke:api` + production build | LOCAL/CI PASS | 2026-10-04 | 66 test suites / 478 tests passed with exit 0 and zero unhandled errors; `smoke:api`, production build, Ubuntu CI and Windows CI are green; green code is not a packaged Windows soak |
| Desktop cross-feature safety | LOCAL/CI PASS | 2026-10-04 | Solo/Live `CustomPromptStudio`, selected-doc gating, `embeddingModel`-bound RAG cache, `760×240` Teleprompter HUD, `[All \| Code \| Steps]` coding tabs, atomic STT quota reservation and local/runtime Product Intelligence are covered in code/tests; packaged UI click-through remains required |
| Electron 43 package/runtime | LOCAL PASS; WINDOWS RELEASE TARGET | 2026-10-04 | Electron/builder migration is code-verified. The v1.5.2 public release workflow currently publishes the Windows NSIS artifact; macOS/Linux are not claimed as v1.5.2 automated release artifacts |

**Linux stealth:** NOT SUPPORTED (no OS content-protection API).
