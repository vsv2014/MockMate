# MM Prompt — MockMate UI/UX Source of Truth

The single spec for finishing MockMate's UI. Derived from the design reference + a review
of the live app. Every screen must obey the **Visual Language** and the **Two-Experiences**
rule below. Where the current app deviates, the **Fixes** section says exactly what to change.

---

## 1. Product architecture (locked)

Two experiences, one goal — *help you prepare, and assist you live, without being detected.*

- **Workspace** — the full desktop window (sidebar + content). Everything *before/after* an
  interview: Home, Solo Practice, Resume Studio, Job Matching, Past Sessions, Settings, Account.
- **Overlay** — a compact, always-on-top, screen-share-invisible panel. ONLY during a **Live**
  interview. Invisibility comes from `setContentProtection(true)` (Win/macOS), not size.

Flow: `Website → Login → Open app → Dashboard → {Solo | Live | Resume | Jobs} → Feedback → Dashboard`.
Live specifically: `Dashboard → Live Setup (in window) → Start → window minimizes + overlay opens → interview → overlay closes → feedback in window`.

---

## 2. Visual language (make `src/auth/tokens.js` match this exactly)

**Color**
| Token | Hex | Use |
|---|---|---|
| accentFrom | `#8B5CF6` | primary (violet) |
| accentTo | `#6D28D9` | primary gradient end (deep purple) |
| success | `#10B981` | emerald — connected/good |
| warning | `#F59E0B` | amber |
| danger | `#F43F5E` | rose — destructive only |

**Background / surfaces**: base `#08080C` · surface `#111217` · surface-2 `#16171C`
**Text**: primary `#E8E8EC` · secondary `#8A8A8E` · tertiary `#71717A`
**Radius**: card `16px` · control `12px` · large `20px`
**Font**: Kanit (already self-hosted)
**Style**: dark · glass · rounded · generous spacing · almost no hard borders · soft shadows.
Purple = brand/primary. Emerald = success. Rose = destructive ONLY. Drop the purple→orange
gradient in favor of purple→deep-purple (orange/amber only as an accent, e.g. an amber tag).

**Logo** — replace the plain purple "M" square everywhere with the MockMate mark: an angular
"M" whose left stroke is violet and right stroke is emerald. Canonical SVG:

```html
<svg viewBox="0 0 32 32" width="28" height="28" fill="none">
  <defs><linearGradient id="mm" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#8B5CF6"/><stop offset="1" stop-color="#10B981"/>
  </linearGradient></defs>
  <path d="M5 26V7l11 10L27 7v19" stroke="url(#mm)" stroke-width="3.5"
        stroke-linecap="round" stroke-linejoin="round"/>
</svg>
```

Use this in: the top-bar wordmark, the auth screens, and — exported to PNG/ICO — the Electron
window/tray icon (`build/icon.png`, `iconPath()`), so the taskbar icon matches the in-app logo.

---

## 3. Screen status (from live review)

| Screen | State | Action |
|---|---|---|
| Auth (Welcome/Login/Signup) | ✅ on-system | keep |
| Dashboard / Home | ✅ good | apply new tokens; add "System Status" + "Performance Overview" panels (ref) |
| Solo Setup | ✅ good | tokens only |
| Solo Interview Workspace | ✅ good | tokens only |
| Solo Feedback | ✅ good | tokens only |
| API & Settings | ✅ good rows | rename to **Settings**; fold in app settings; see Fix #2 |
| Account | ⚠️ dup keys | remove the BYO-keys block; see Fix #2 |
| **Past Sessions** | ❌ still overlay | bring into the shell as a **table** (Fix #1) |
| Jobs | ⚠️ old teal | reskin to tokens (Fix #4) |
| Resume & Career | ⚠️ old teal | reskin to tokens; drop redundant "← Back" (Fix #4) |
| Live Companion | ❌ old overlay | Phase 3 rebuild (Fix #5) |

---

## 4. Fixes (concrete)

### Fix #1 — Past Sessions must live in the Workspace (not an overlay)
`history` is missing from `SHELL_VIEWS`, so "Sessions" shrinks to the compact overlay.
- Add `'history'` to `SHELL_VIEWS`; render it in the shell content area.
- Design: a **table** — Session · Role/Type · Date · Score · Duration · Actions (view / export / delete),
  matching the reference "PAST SESSIONS" panel. Row click → open that session's feedback (reuse `SoloFeedback`).
- Empty state: friendly, in-shell (no floating box).

### Fix #2 — De-duplicate API keys (Account vs Settings)
Keys currently render in BOTH `Settings` and `Account`. One home only.
- **Settings** (rename "API & Settings" → **Settings**) owns: **API Providers** (the `ApiKeysPanel`
  rows) + app settings (theme later, audio/mic, shortcuts, overlay/stealth, hotkeys — stub now).
- **Account** owns ONLY: identity, plan, usage meters, Upgrade, Sign out. Replace its BYO-keys block
  with a one-line link: *"Manage your API keys in Settings →"*.
- Sidebar keeps a single **Settings** entry; Account stays reachable from the profile chip.

### Fix #3 — CSS / stealth / scroll gaps
- **Scrollbars**: apply the thin custom scrollbar globally in the shell (not just the overlay);
  the shell content area currently shows a default chunky scrollbar and edge gaps.
- **Overlay scroll**: the compact overlay screens (Live setup, old Sessions) clip content and
  mis-scroll — ensure the panel body is a single `overflow-y:auto` column with correct max-height.
- **Gaps**: remove the dead right-edge gap in the shell content; consistent `padding: 22–26px`;
  make the content column `max-width` centered so wide screens don't stretch text.
- **Stealth**: the overlay dims/hides via opacity; verify the dim transition doesn't leave a
  half-scrolled body, and that content protection stays on across window-mode switches.

### Fix #4 — Reskin Jobs & Resume/Career to tokens
Both still use the legacy teal palette. Convert to the design system:
- Cards → `surface`/`radius 16`, purple accent, emerald for positive tags, no teal.
- Buttons → gradient primary / ghost secondary (match Solo).
- Resume: drop the redundant "← Back" (sidebar handles nav); tabs become segmented chips.
- Job cards: score pill uses `scoreColor`; tags use surface-2 chips; "Apply" primary-ghost.

### Fix #5 — Live flow (Phase 3)
Rebuild `LiveCompanion` around the architecture:
- **Live Setup** renders in the Workspace (role, JD, resume, language, voice/instructions, audio source).
  No more raw ".env" message — point to Settings for the Deepgram key.
- **Start** → `setWindowMode('overlay')` + minimize-to-overlay; the overlay is the compact
  Suggested-Answer HUD (ref "LIVE OVERLAY"): Listening state, Current Question, Suggested Answer
  with confidence %, Key Points, Follow-up Prediction, Copy / Insert, waveform.
- **End** → overlay closes, `setWindowMode('app')`, feedback shows in the Workspace.

---

## 5. Reusable pieces to add (from the reference)
- **System Status** panel (Home): provider connected states + Mic + Stealth, "All systems go".
- **Performance Overview** (Home): the score-trend sparkline (we already have `ScoreTrend`; restyle).
- **Provider row** with **Test** + **status** (Connected / Free tier) + **Add Provider** (Settings).
- Shared components worth extracting: `Sidebar`, `TopBar`, `Panel`, `StatPill`, `SessionRow`, `ScoreRing`.

---

## 6. Build order
1. **Tokens + logo** (Fix #2 visual base) — update `tokens.js`, add the M mark + export the icon.
2. **Fix #1** Past Sessions → shell table.
3. **Fix #2** dedupe Account/Settings.
4. **Fix #3** CSS/scroll/stealth pass.
5. **Fix #4** reskin Jobs + Resume.
6. **Phase 3** Live flow.

Do NOT do a big-bang folder reorg; adopt `pages/ components/ overlay/` structure incrementally
as screens are touched. Keep the app building green after each fix.
