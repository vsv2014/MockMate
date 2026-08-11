# Validation status (release gate honesty)

Update this file whenever a packaged soak or stealth dry-run is completed.
Do **not** mark PASS from code review alone.

| Item | Status | As of | Notes |
|------|--------|-------|-------|
| Packaged Solo soak | NOT VERIFIED | 2026-08-12 (v1.4.6 code) | Last evidence template: `v1.4.4.md`; run on installer from `releases/latest` or a fresh 1.4.6 build |
| Packaged Live soak | NOT VERIFIED | 2026-08-12 (v1.4.6 code) | Use `LIVE_DRY_RUN_TEMPLATE.md` → `v1.4.6.md` when packaging |
| UX freeze | OPEN | 2026-08-12 | 1.4.5 HUD + 1.4.6 Career/Live engine batch; freeze after soak |
| Stealth / share-preview matrix | UNKNOWN | 2026-08-12 | See `STEALTH_BROWSER_MATRIX.md` — all Win/macOS cells UNKNOWN |
| 120-minute continuous usage | NOT VERIFIED | 2026-08-12 | Designed / partially bounded; **do not claim** until timed packaged session |
| Unit + `smoke:api` | LOCAL ONLY | 2026-08-12 | Green in-dev ≠ packaged soak |

**Linux stealth:** NOT SUPPORTED (no OS content-protection API).
