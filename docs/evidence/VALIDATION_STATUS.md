# Validation status (release gate honesty)

Update this file whenever a packaged soak or stealth dry-run is completed.
Do **not** mark PASS from code review alone.

| Item | Status | As of | Notes |
|------|--------|-------|-------|
| Packaged Solo soak | NOT VERIFIED | 2026-08-19 (v1.4.9 code) | Run on the GitHub-built Windows installer; attach evidence before calling the release proven |
| Packaged Live soak | NOT VERIFIED | 2026-08-19 (v1.4.9 code) | Use `LIVE_DRY_RUN_TEMPLATE.md` → `v1.4.9.md`; exercise intent corrections, code, screenshots, language switching and reconnect |
| Windows auto-update v1.4.8 → v1.4.9 | NOT VERIFIED | 2026-08-19 | Keep the older NSIS install; verify Checking → Downloading → Ready → Restart & install without uninstalling |
| Diagnostic export/redaction | CODE VERIFIED | 2026-08-19 | Sanitizer tests pass; export/rotation still needs one packaged Windows click-through |
| UX freeze | OPEN | 2026-08-19 | Freeze after packaged v1.4.9 Live/Solo/updater/diagnostic-export checks |
| Stealth / share-preview matrix | UNKNOWN | 2026-08-19 | See `STEALTH_BROWSER_MATRIX.md` — all Win/macOS cells UNKNOWN |
| 120-minute continuous usage | NOT VERIFIED | 2026-08-19 | Designed for reconnect/token refresh; **do not claim** until timed packaged session |
| Unit + `smoke:api` + production build | LOCAL PASS | 2026-08-19 | 294 unit tests + 3 API smoke tests green; green code is not a packaged soak |
| Local Electron/package doctor | LOCAL PASS | 2026-08-19 | Repaired Electron 32.3.3 runtime download; doctor reports the install complete and runnable |
| Local packaged build (Linux) | LOCAL PASS | 2026-08-19 | `electron-builder --linux --publish never` produced `MockMate-1.4.9.AppImage` and `latest-linux.yml`; this validates packaging but does not replace the required Windows installer test |

**Linux stealth:** NOT SUPPORTED (no OS content-protection API).
