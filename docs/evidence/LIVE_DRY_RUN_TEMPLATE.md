# Live dry-run evidence — vX.Y.Z

Copy this file to `docs/evidence/vX.Y.Z.md` (match `package.json` version) before tagging a release.

**Build:** packaged installer SHA / CI run URL:  
**OS tested:** Windows __ / macOS __  
**Tester / date:**  

## Required Live checks (First 10 #10)

| Check | Result (PASS/FAIL/PARTIAL) | Notes |
|---|---|---|
| Installer boots, no CSP red errors | | |
| Live STT connects (Deepgram) | | |
| Spoken question → streamed hint (TTFT noted) | | |
| Zoom share preview — overlay absent | | |
| Meet share preview — overlay absent | | |
| Teams share preview — overlay absent | | |
| Glanceable answer (opener / bullets / expand) | | |
| Mid-stream abort → incomplete or fallback usable | | |
| Network blip ≤10s — session continues | | |
| Deepgram drop — auto-reconnect | | |

## Interruption IDs (from INTERRUPTION_MATRIX.md)

Record at least: **I01, I03, I04, I15, I16, I19** as PASS on Win or macOS.

| ID | Result | Notes |
|---|---|---|
| I01 | | |
| I03 | | |
| I04 | | |
| I15 | | |
| I16 | | |
| I19 | | |
| I12 | | sleep/wake — PARTIAL ok with steps |

## Stealth matrix snapshot
Link or paste filled rows from `STEALTH_BROWSER_MATRIX.md` for this build.

## Ship decision
- [ ] Attach this file to the GitHub Release assets
- [ ] Marketing claims match only PASS cells (no “all capture tools”)
