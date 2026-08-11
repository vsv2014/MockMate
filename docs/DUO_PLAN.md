# MockMate Duo (Rooms)

**Status (code):** Lobby (`Duo.jsx`) + LiveKit room (`Room.jsx`) + Electron co-pilot window ship.  
**Voice:** Deepgram mic STT (same hook as Solo) — **not** browser Web Speech. Requires Deepgram configured (BYOK Settings → Voice, or managed voice).  
**Stealth:** Candidate hints use content-protected Electron window / Document PiP where available. Claims must stay within verified matrix — always verify share preview; never “invisible to all capture.”

## Prereqs
1. LiveKit Cloud → `LIVEKIT_URL` / `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` in `.env`.
2. Deepgram key (or managed Deepgram) for room transcription.
3. `npm install` if LiveKit deps missing.

## Product rules
- Market Duo only when LiveKit + Deepgram work on the packaged build you ship.
- Process-level “undetectable” remains **out of scope** — do not claim.
- Prefer Live path quality over Duo feature sprawl.

## Manual verify
- [ ] Create room → partner joins with code
- [ ] Both sides see shared transcript finals (Deepgram)
- [ ] Candidate hints appear in protected window (Electron) or PiP (Chromium)
- [ ] Share preview check on Win or macOS
- [ ] End → report renders
