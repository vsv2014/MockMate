# MockMate Duo (Rooms) — revival plan

**Goal:** revive the orphaned `Room` feature as **Duo** — a shared room where a friend/mentor joins
your interview live (shared transcript + screen), and the candidate gets a **private, screen-capture-
protected AI co-pilot**. Beats LockedIn Duo (which is screen-share + remote control only).

**Host decision:** LiveKit Cloud (free tier). **Transport:** LiveKit (WebRTC data channel + tracks).

## Current state (after this session's groundwork)
- ✅ `mintToken()` restored in `api/_lib/core.js` (lazy `livekit-server-sdk` import — cannot break Solo/Live).
- ✅ `/api/token` registered on local `server.js` + managed `api/_lib/apiRoutes.js` (auth-gated, uncapped).
- ✅ LiveKit deps added to `package.json`; `LIVEKIT_*` documented in `.env.example`.
- ✅ `src/Room.jsx` (room + AI co-pilot + PiP protection) and `src/Home.jsx` (old join flow) exist.
- ✅ Room CSS classes still present in `src/styles.css`.

## Phase 0 — Prereqs (you)
1. LiveKit Cloud project → put `LIVEKIT_URL` / `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` in `.env`.
2. `rm -rf node_modules package-lock.json && npm install` (adds the 4 LiveKit deps + repairs the broken install).

## Phase 1 — Make Room.jsx work in the current app (managed + BYOK)
- Replace the 3 raw `fetch('/api/…')` calls in `src/Room.jsx` with `apiFetch` from `src/lib/apiClient.js`
  (lines 14 `/api/token`, 160 `/api/hint`, 188 `/api/report`) → routes to `:4000` w/ JWT in managed, `:3002` in BYOK.
- Import `@livekit/components-styles/index.css` once (in `Room.jsx` or `main.jsx`).
- Re-theme Room's markup to the design tokens (`T` from `auth/tokens`) so it matches the dashboard,
  OR keep the existing `styles.css` classes for v1 (they still exist) and polish later.

## Phase 2 — Dashboard entry (replaces the orphaned Home.jsx flow)
- Add `'duo'` to `SHELL_VIEWS` in `src/App.jsx:24` (renders as a full window, not the compact overlay).
- Add a **"Duo (Beta)"** nav item in `AppShell` (`src/Dashboard.jsx:86`) + a card on `DashboardHome`.
- New `src/Duo.jsx` **lobby** (adapt `Home.jsx` logic — `randomRoom()`, invite `?room=` param, role
  candidate/helper) styled to the dashboard. On "Start/Join" → render `<Room session={…} />`.
- Handle the invite deep-link: if launched/opened with `?room=CODE`, jump straight to the Duo lobby
  pre-filled as the joining participant.

## Phase 3 — Electron protected co-pilot window (premium capture protection)
- Restore preload bridge in `electron/preload.cjs`: `setRoomActive(bool)`, `sendHint(payload)`.
- In `electron/main.cjs`: on `setRoomActive(true)` open a small always-on-top `BrowserWindow` with
  `setContentProtection(true)` (the `browser-window-created` handler already auto-protects it);
  `sendHint` forwards the hint payload to it; close on `setRoomActive(false)`.
- Fallback already works without this: `Room.jsx` uses Document Picture-in-Picture, which Chrome
  marks `WDA_EXCLUDEFROMCAPTURE`. So Phase 3 is an enhancement, not a blocker.

## Phase 4 — Auth / metering (managed mode)
- `/api/token` is `requireAuth` (candidate signed in) — already wired.
- **Open question (v1 decision):** the *helper* joining via invite link isn't necessarily a MockMate
  user. v1 = both sign in (simplest, current behavior). v2 = short-lived invite token minted by the
  candidate so a helper can join without an account. Recommend v1 now.
- Duo's AI co-pilot uses `/api/hint` → counts against the managed monthly cap (expected).

## Phase 5 — Verify (needs 2 clients)
- Two browser tabs (or two machines): create room in one, open invite link in the other.
- Confirm: presence list, live transcript sync (LiveKit data channel), screen share tile,
  candidate-only AI hint on each interviewer question, PiP/protected hint window, End → shared report.

## Known trade-offs / notes
- Room transcript uses the **browser SpeechRecognition** (`useSpeech`), not Deepgram — Chrome/Edge
  only, lower accuracy than Live's Deepgram path. Unifying on Deepgram is a later option.
- `Home.jsx` is legacy (old browser app); Phase 2 supersedes it — delete once `Duo.jsx` lands.
- LiveKit Cloud free tier has monthly minutes limits — fine for testing; watch usage.

## Suggested build order
Phase 0 (you) → Phase 1 → Phase 2 → verify in browser → Phase 3 (Electron polish) → Phase 4 refinement.
