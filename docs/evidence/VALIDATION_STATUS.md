# Validation status (release gate honesty)

Update this file whenever a packaged soak or stealth dry-run is completed.
Do **not** mark PASS from code review alone.

| Item | Status | As of | Notes |
|------|--------|-------|-------|
| Packaged Solo soak | NOT VERIFIED | 2026-10-03 (v1.5.1 code) | Run on the GitHub-built Windows installer; attach evidence before calling the release proven |
| Packaged Live soak | NOT VERIFIED | 2026-10-03 (v1.5.1 code) | Replay the SysCloud cases: CTE/polling/RBAC/CI, corrections, standalone topic switches, logistics, coding and provider recovery |
| Windows auto-update v1.4.11 → v1.5.1 | NOT VERIFIED | 2026-10-03 | Keep the prior NSIS install; verify Checking → Downloading → Ready → Restart & install without uninstalling |
| Diagnostic export/redaction + ARCH Product Intelligence | CODE VERIFIED | 2026-10-03 | Sanitizer + zero-PII `productIntelligence` tests pass; export/rotation still needs one packaged Windows click-through |
| UX freeze | OPEN | 2026-10-03 | Desktop cross-feature code freeze is ready; freeze only after packaged v1.5.1 Live/Solo/Resume/Jobs/History/updater/diagnostic-export checks |
| Stealth / share-preview matrix | UNKNOWN | 2026-08-19 | See `STEALTH_BROWSER_MATRIX.md` — all Win/macOS cells UNKNOWN |
| 120-minute continuous usage | NOT VERIFIED | 2026-08-19 | Designed for reconnect/token refresh; **do not claim** until timed packaged session |
| Unit + `smoke:api` + production build | LOCAL PASS | 2026-10-03 | 54 test suites (392 unit/integration tests), 4 API smoke tests, dependency doctor and Vite production build pass; green code is not a packaged Windows soak |
| Desktop cross-feature safety | LOCAL PASS | 2026-10-03 | Solo/Live `CustomPromptStudio`, selected-doc gating, `embeddingModel`-bound RAG cache, `760×240` Teleprompter HUD, `[All \| Code \| Steps]` coding tabs, and `ARCH · Product Intelligence` covered in code/tests; packaged UI click-through remains required |
| Electron 43 package/runtime | LOCAL PASS; INSTALLERS CI | 2026-08-19 | Clean dependency migration completed; doctor executed Electron 43.0.0 and builder 26 accepted the migrated package schema. Cross-platform Windows/macOS/Linux installers remain release-CI evidence. |
| Local packaged build (Linux) | PRIOR v1.4.9 PASS; v1.5.1 NOT RUN | 2026-10-03 | Prior Linux packaging does not validate the current release or replace the required Windows installer test |

**Linux stealth:** NOT SUPPORTED (no OS content-protection API).
