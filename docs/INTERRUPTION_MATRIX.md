# Real-session interruption / recovery matrix

**Goal:** Prove Live (and Solo where applicable) survives real interview chaos.  
For each scenario verify **all** of:

1. STATE PRESERVED  
2. CONNECTION RECOVERED (or clear degraded mode)  
3. NO DUPLICATE REQUESTS / double answers  
4. NO STALE ANSWER shown as final  
5. USER CAN CONTINUE without full restart  
6. ERROR IS EXPLAINED (actionable)  
7. OBSERVABILITY EXISTS (session log / status)

Statuses: `PASS` | `FAIL` | `PARTIAL` | `UNKNOWN`

## Code expectations (what *should* happen)

| ID | Expected recovery (from code) |
|---|---|
| I01–I03 | Deepgram WS reconnect + PCM queue flush (`src/useSystemAudio.js`); KeepAlive; consecutive reconnect budget ~20min |
| I04 | Fatal close codes / in-band Error → stop + Retry UI (`LiveCompanion` Retry transcription) |
| I05–I06 | `devicechange` → AudioContext resume; may need Retry if track ended |
| I07–I09 | Overlay geometry/pin; content protection re-applied on new windows |
| I10–I11 | Main broadcasts `display-changed`; renderer nudges audio resume (overlay still primary-display positioned) |
| I12 | `powerMonitor` resume/unlock → renderer reconnects STT if socket dead |
| I13 | Renderer reload loses in-memory transcript — user must restart Live (document as PARTIAL if no persistence) |
| I14 | `ensurePortFree` reclaim `:3002`/`:4000` on launch; SIGKILL children on quit |
| I15 | Incomplete stream badge + JSON `/api/hint` fallback |
| I16 | Provider failover in `api/_lib/core.js` before/around stream |
| I17 | Managed JWT in `safeStorage`; BYOK path independent of auth for local LLM keys |
| I19–I20 | AbortController supersession + final debounce / `isStragglerDuplicate` |

## Scenarios (fill Live/Solo cells on packaged builds)

| ID | Scenario | Live | Solo | Notes / evidence |
|---|---|---|---|---|
| I01 | Network disconnect ≤10s then reconnect | UNKNOWN | UNKNOWN | |
| I02 | Wi-Fi network switch | UNKNOWN | UNKNOWN | |
| I03 | Deepgram WebSocket drop (force close) | UNKNOWN | N/A | Auto-reconnect expected on Live |
| I04 | Fatal Deepgram auth/quota | UNKNOWN | UNKNOWN | Must show Retry / clear error — not silent |
| I05 | Audio device change mid-session | UNKNOWN | UNKNOWN | |
| I06 | Mic permission revoked then restored | UNKNOWN | UNKNOWN | |
| I07 | Browser / meeting restart | UNKNOWN | N/A | |
| I08 | Meeting tab change / background | UNKNOWN | N/A | |
| I09 | Fullscreen enter/exit | UNKNOWN | N/A | |
| I10 | Monitor connect/disconnect | UNKNOWN | N/A | |
| I11 | DPI / scale change | UNKNOWN | N/A | |
| I12 | Laptop sleep/wake | UNKNOWN | UNKNOWN | powerMonitor + STT nudge |
| I13 | Electron renderer reload | UNKNOWN | UNKNOWN | Expect session loss unless noted |
| I14 | Electron main restart / orphan port | UNKNOWN | UNKNOWN | Relaunch must bind ports |
| I15 | LLM provider timeout mid-stream | UNKNOWN | UNKNOWN | Incomplete badge / fallback |
| I16 | Provider 429 then failover | UNKNOWN | UNKNOWN | |
| I17 | Auth/JWT expiry mid-session (managed) | UNKNOWN | UNKNOWN | BYOK should continue |
| I18 | Temporary backend 5xx (managed) | UNKNOWN | UNKNOWN | |
| I19 | Rapid interviewer follow-ups | UNKNOWN | UNKNOWN | Abort prior; one in-flight |
| I20 | Simultaneous transcript finals | UNKNOWN | N/A | Coalesce; no duplicate hints |

## Pass criteria for a release
- I01, I03, I04, I15, I16, I19 must be **PASS** on packaged Win **or** macOS for Live.
- I12 sleep/wake at least **PARTIAL** with documented recovery steps.
- Any FAIL that can ruin a live interview is a **ship blocker**.

## How to run (minimum)
1. Packaged build (not `npm run dev`).
2. Start Live with System Audio + real Deepgram + one LLM key.
3. 15+ minute session while executing I01–I20 where feasible.
4. Copy results into `docs/evidence/vX.Y.Z.md` (see template) and attach to the GitHub Release.
