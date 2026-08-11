# Stealth + overlay compatibility matrix

**Rule:** Never mark a cell `SUPPORTED` without a real **packaged-app** dry-run on that OS + browser/meeting shell + scenario.  
Statuses: `SUPPORTED` | `PARTIAL` | `NOT SUPPORTED` | `UNKNOWN`

**Code-backed facts (not a substitute for dry-run):**
- Overlay exclusion = Electron `setContentProtection` → Win `WDA_EXCLUDEFROMCAPTURE`, macOS `NSWindowSharingNone` (`electron/main.cjs`).
- Linux: content protection skipped → Live setup requires explicit ack (`src/LiveCompanion.jsx`).
- `npm run dev` / browser Vite has **no** screen protection — never use for stealth claims.
- PiP exclusion is Chromium Document PiP + content protection — treat as **PARTIAL** until share-preview proven.

## Meeting shells to test
Chrome · Edge · Brave · Arc · Zoom desktop · Google Meet (in browser) · Teams desktop/web

## Platforms
Windows · macOS · Linux

## Scenarios (run each for Live overlay + PiP if used)
1. Normal windowed meeting tab
2. Browser maximized
3. Browser / meeting **fullscreen**
4. GPU / hardware acceleration on vs off (if reproducible)
5. Browser zoom 100% / 125% / 150%
6. DPI / display scale change mid-session
7. Multi-monitor: overlay on primary, share secondary (and reverse)
8. Screen capture / share preview (entire screen + window)
9. Display sleep / wake
10. Browser restart mid-session (meeting rejoin)
11. Overlay hide/show (`Alt+H`) during share
12. Laptop lid close/open (if applicable)

For each failure note:  
`BROWSER → OS → SCENARIO → OBSERVED → LIKELY CAUSE → FIX → REGRESSION TEST`

## Results table (fill per release — copy into `docs/evidence/vX.Y.Z.md`)

| Browser / shell | OS | Fullscreen | Share preview | Multi-monitor | Sleep/wake | Status | Notes / evidence |
|---|---|---|---|---|---|---|---|
| Chrome + Meet | Windows | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | Packaged only |
| Edge + Meet | Windows | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | |
| Brave + Meet | Windows | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | Smart Chromium — do not assume Chrome result |
| Arc + Meet | Windows | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | |
| Zoom desktop | Windows | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | Prefer entire-screen share test |
| Teams desktop | Windows | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | |
| Chrome + Meet | macOS | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | |
| Edge + Meet | macOS | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | |
| Brave + Meet | macOS | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | |
| Arc + Meet | macOS | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | |
| Zoom desktop | macOS | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | |
| Teams desktop | macOS | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | |
| * | Linux | — | visible | — | — | NOT SUPPORTED | No OS content-protection API; preflight ack required |

## Claims allowed in marketing
- After Win+macOS Zoom **and** Meet **and** Teams share-preview pass on the release build: “excluded from common screen-share APIs on Windows & macOS — verify before a real interview.”
- Never: “invisible to all capture tools”, “undetectable”, “invisible to all browsers.”
