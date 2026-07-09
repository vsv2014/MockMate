# MockMate v1.4.3

**The packaged app connects again — plus live collaborative rooms, document RAG, and a real AI-settings surface.**

1.4.2 shipped a regression that broke the desktop build: the local server's security policy blocked the backend, so **Solo, Live, and sign-in all failed**. This release fixes that and doubles down on the wedge — *invisible, private, best-answer* — with the next wave of features.

## 🩹 Fixed (1.4.2 regressions)
- **Backend unreachable in the packaged app** — `connect-src` now allows the loopback backend (:4000) and LiveKit. **Solo, Live, sign-in, and Duo all connect again.**
- **Sign-in window couldn't be closed, resized, or moved** — it now has proper window controls (no more Task Manager).
- **Live transcription no longer gated by the AI-response cap** — speech-to-text is metered separately, so hitting your monthly answer limit doesn't kill your mic mid-interview.
- **No mid-interview dead end** — local managed usage is no longer hard-capped (metering applies only to the hosted multi-tenant backend).
- **Web-search grounding can't stall a live answer** — time-boxed (1.8s live / 2.5s solo); the answer never waits on a slow lookup.
- **Windows dev scripts fixed** — the Unix-only `PORT=` prefix that broke `npm run dev` / `electron:dev` is gone.

## ✨ Added
- **Duo (Rooms)** — a friend or mentor joins your interview live: shared transcript + screen, plus a **private, screen-capture-protected AI co-pilot window** that only the candidate sees.
- **Document RAG** — upload your resume / JD / notes; they're chunked, embedded, and the most relevant parts are retrieved per question (replaces the old truncated-resume stuffing).
- **AI Settings** — Response length (Concise / Balanced / Detailed), Screenshot replies (Quality / Faster), Auto-skip noise, and a document-relevance slider.
- **Guest mode** — try the app before creating an account (local bring-your-own-key); sign in anytime.
- **Collapse-to-pill** — minimizing the overlay leaves a small, still-capture-protected pill you click to expand.
- **What's New modal** + in-app version label.
- **Modernized model catalog** — GPT-5.4, Gemini 3 Flash / 3.1 Flash-Lite, Cerebras, Claude Sonnet 5. Auto routes to a current fast model on Live and a current strong model for hard questions, with graceful failover.
- **Jobs** — results now hard-filter by experience/seniority and cache (no refetch every time you open the tab).

## 🔧 Changed
- **Mode-aware error messages** — managed users are no longer told to "check your API key" (they don't have one); BYOK users keep the key-oriented guidance.
- **Retired the legacy dual-paradigm UI** — deleted `Home.jsx` / `Report.jsx`, re-themed `Room.jsx` to the design tokens. Every screen is now one system.

## ⬆️ Upgrade / setup
1. Download the installer asset below and run it (Windows).
2. First launch: choose **Guest** (your own key) or sign in.
3. For Live, you need one LLM key + a **Deepgram** key. Cheapest full path: **Gemini** (free) + **Deepgram** (free credit). Duo additionally needs **LiveKit** (`LIVEKIT_URL` / `KEY` / `SECRET`).
4. Building from source? `npm install` → `npm run verify` → `npm run electron:dev`. See `.env.example` for all keys.

## ✅ Verification & ⚠️ known caveat
- Build green (413 modules), 46/46 tests, `npm run doctor` ✓, two high-effort code reviews with all findings fixed.
- **This release is verified in code, not in a real interview.** The screen-capture-invisibility behavior has **not** been confirmed on this build with live keys. Before trusting it live, run the dry-run in `docs/RELEASE_CHECKLIST.md` — start a Zoom/Meet screen share and confirm the overlay does **not** appear in the share preview. If it shows, don't use it in a real interview.

**Full changelog:** see [`CHANGELOG.md`](../CHANGELOG.md) · Compare: `v1.4.2...v1.4.3`
