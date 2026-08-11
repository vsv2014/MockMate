# Validation status (release gate honesty)

Update this file whenever a packaged soak or stealth dry-run is completed.
Do **not** mark PASS from code review alone.

| Item | Status | As of | Notes |
|------|--------|-------|-------|
| Packaged Solo soak | NOT VERIFIED | 2026-08-11 (v1.4.4) | Run on installer from `releases/latest` |
| Packaged Live soak | NOT VERIFIED | 2026-08-11 (v1.4.4) | Use `LIVE_DRY_RUN_TEMPLATE.md` → `v1.4.4.md` |
| UX freeze | OPEN | 2026-08-11 | Product/UX audit batch shipped; freeze after soak |
| Stealth / share-preview matrix | UNKNOWN | 2026-08-11 | See `STEALTH_BROWSER_MATRIX.md` — all Win/macOS cells UNKNOWN |
| 120-minute continuous usage | NOT VERIFIED | 2026-08-11 | Designed / partially bounded; **do not claim** until timed packaged session |

**Linux stealth:** NOT SUPPORTED (no OS content-protection API).
