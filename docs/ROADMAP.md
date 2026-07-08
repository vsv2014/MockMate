# MockMate roadmap

## Strategy — pick the wedge, not the breadth race
MockMate's moat is **invisible-to-screen-capture + local-first/BYOK + a genuinely robust answer
engine**. LockedIn will always out-feature us on funnel/modes; they cannot easily copy "invisible to
the interviewer's screen share" or "your data never leaves the device." **Win on depth + trust.**
Every item below should ladder up to: *the most private, most invisible, best-answer interview
copilot* — not surface-count parity.

Strengths to protect (already built): multi-provider failover, rate-limit/quota/transient
classification, JSON-repair, abort-safe streaming, playbook prompts (`core.js`/`interview.js`);
content-protected overlay (WDA_EXCLUDEFROMCAPTURE / PiP).

## P0 — Release verification discipline (protects everything)
The most dangerous gap: 1.4.2 shipped bugs that a single packaged-build click-through would have
caught. Fix the *process*, not just the bugs.
- [x] `docs/RELEASE_CHECKLIST.md` — packaged-build smoke gate (sign in → Solo → Live → screenshot → Duo)
- [ ] Adopt it: no tag/upload until the checklist passes on the packaged artifact
- [ ] (Later) CI: `npm ci && npm run build && npm test` on every PR

## P1 — Kill the dual-paradigm debt (consistency reads as quality)
Two UIs fight: legacy browser app (`Home.jsx`, `Room.jsx`, `styles.css` classes) vs the token
dashboard (`App.jsx`, `Dashboard.jsx`, `T`). Orphaned Duo was the symptom.
- [ ] Re-theme `Room.jsx` to design tokens (`T`), then delete `styles.css` legacy classes
- [ ] Delete `Home.jsx` (superseded by `Duo.jsx` + the dashboard)
- [ ] One audit pass: every screen uses `T`, no stray `className="..."` from the old system

## P2 — Document intelligence / RAG (biggest answer-quality lever)
Today: resume truncated to 1800–4000 chars, stuffed into every prompt. That's why long-resume
answers feel generic.
- [x] RAG core — `shared/retrieval.js` (chunk/cosine/topK/threshold), `embed()` in `core.js`, `/api/embed` (verified)
- [ ] Client: docs store → embed chunks once → per-question top-K retrieve → inject (replace truncation)
- [ ] Documents UI (upload/list/delete — the LockedIn panel); multi-doc (resume + JD + extras)
- [ ] "Filter document" threshold slider in AI Settings (default 0.20)
- See `docs/RAG_PLAN.md`.

## P3 — Fix the funnel (convert the aha-moment)
- [ ] Let users try locally BEFORE forcing auth ("try free, sign in to sync") — AuthGate currently
      gates all value behind signup, leaking the "download & go" promise
- [ ] Cap cliff: a graceful path when the managed free cap is hit locally (switch-to-BYOK prompt,
      or don't hard-cap local managed) — never a mid-interview dead end

## P4 — Polish + modernize (mostly done; needs the green build to verify)
- [x] Modernized model catalog (GPT-5.4, Gemini 3 Flash/Flash-Lite, Cerebras, Sonnet 5); un-hardcoded fast tier
- [x] Consolidated AI Settings (Response length · Screenshot replies · Auto-skip)
- [x] What's New modal; mode-aware (managed vs BYOK) error messages; time-boxed web search (Live latency)
- [x] Duo revived (LiveKit `mintToken` + `/api/token`, wired into dashboard)
- [x] Stepped/collapsible setup sections (Live setup → numbered 1·2·3 accordion); in-app version label
- [x] Duo Phase 3: protected Electron co-pilot window (content-protected BrowserWindow + setRoomActive/sendHint IPC)

## P5 — Breadth (ONLY after P0–P3 are solid)
More modes (Professional Meeting / Online Assessment / Phone), Resume Builder, billing UI.
Breadth on a shaky base is a trap — resist until the wedge is airtight.

---
### Status legend
[x] done + verified where possible this session · [ ] pending (most P1–P3 UI needs a green
`npm run build`, currently blocked by a local Windows/Defender file lock — reboot to clear).
