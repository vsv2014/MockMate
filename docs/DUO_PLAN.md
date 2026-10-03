# MockMate Duo (Rooms)

**Status (v1.5.2 — Shipped):** Full-fledged collaborative interview room across `src/Duo.jsx` (Lobby + Report) and `src/Room.jsx` (LiveKit Room + Grounded Candidate Co-Pilot + Helper Question Bank).  
**Voice:** Deepgram mic STT (`src/useDeepgram.js` + shared `src/lib/deepgramTransport.js`) — requires Deepgram configured (BYOK Settings → Voice, or managed voice).  
**Stealth:** Candidate hints use content-protected Electron window / Document PiP where available. Claims stay strictly within the verified matrix — always verify share preview; never claim “invisible to all capture.”

## Shipped Capabilities (v1.5.2)
- [x] **Full Interview Context Setup in Lobby (`src/Duo.jsx`)** — Candidate configures Target Role, Target Company, Job Description / Focus, and sees active Resume + Custom Playbook status before creating or joining a room.
- [x] **Recent Rooms Quick-Rejoin (`mm-duo-recent-v1`)** — Persists the last 3 Duo rooms locally for 1-click reconnect if a browser tab refreshes.
- [x] **RAG + Playbook Grounded Private Co-Pilot (`src/Room.jsx`)** — Candidate hints automatically include Resume, JD, Custom Playbook rules, recent conversation turns, and retrieved RAG document chunks (`retrieveContext`).
- [x] **Rich Co-Pilot Hint Cards + Manual Ask Bar** — Displays `opener` (1-sentence headline), `keyPoints`, expandable `Full Answer / Code`, `watchOut`, a manual `"⚡ Ask AI"` input bar, and per-turn `"⚡ Hint"` triggers on interviewer transcript turns.
- [x] **Helper Question Bank & Private Coaching Nudges (`helper-note` channel)** — Helper/Interviewer can send 1-click role-specific questions or custom questions to the shared transcript, and send private coaching nudges directly to the Candidate.
- [x] **Automatic Session History Persistence & Markdown Export** — Completed Duo sessions save to local History (`saveSession`) and support 1-click `.md` report + transcript export.

## Prereqs
1. LiveKit Cloud → `LIVEKIT_URL` / `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` in `.env`.
2. Deepgram key (or managed Deepgram) for room transcription.

## Manual verify
- [x] Create room → partner joins with `mock-...` code (or `?room=mock-...` URL)
- [x] Both sides see shared transcript finals (Deepgram + Helper text questions)
- [x] Candidate hints appear in protected window (Electron) or PiP (Chromium) with opener + key points + full answer toggle
- [x] Share preview check on Win or macOS
- [x] End → report renders, saves to History, and exports Markdown
