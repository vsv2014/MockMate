# MockMate — Real-Time AI Interview Companion

A desktop overlay that floats over your screen during live interviews, listens to the
interviewer, and gives you natural, resume-grounded answers in seconds.
**Invisible to screen recording and screen share on Windows & macOS.**

---

## Download (no setup)

Grab the latest build from the [**Releases page**](https://github.com/vsv2014/MockMate/releases/latest):

| Platform | File | Run |
|---|---|---|
| **Windows** | `MockMate-Setup-<version>.exe` | Run the installer |
| **Linux** | `MockMate-<version>.AppImage` | `chmod +x` → run it |
| **macOS** | `MockMate-<version>-arm64.dmg` (Apple Silicon) / `MockMate-<version>-x64.dmg` (Intel) | Open the dmg → drag to Applications |

On first launch, MockMate opens a **setup screen** where you paste your API keys — no manual
file editing. Keys are saved locally and the app restarts ready to use.

**Auto-update (Windows & Linux):** new versions download silently in the background and install
the next time you reopen MockMate — no re-download needed. **macOS updates are manual for now**
(the build isn't code-signed yet) — grab the latest `.dmg` from the [releases page](https://github.com/vsv2014/MockMate/releases/latest).

> **macOS:** the DMG is **not** notarized yet, so on first open Gatekeeper shows
> _"Apple could not verify MockMate is free of malware"_ — clear it with **right-click → Open**
> (or `xattr -dr com.apple.quarantine /Applications/MockMate.app`). New versions are a manual
> re-download for now; auto-update on macOS needs Apple Developer signing — see [`SIGNING.md`](SIGNING.md).
>
> **Windows:** the installer is **not** code-signed, so Windows SmartScreen may show
> _"Windows protected your PC"_ on first run — click **More info → Run anyway**.

> **Launch MockMate _before_ you join the call.** It appears in the top-right corner; press `Alt+H` to hide/show.

## Run from source (developers)

```bash
git clone https://github.com/vsv2014/MockMate
cd MockMate
npm install
cp .env.example .env       # configure keys ONCE — dev reads this automatically
npm run electron:dev       # launches the Electron overlay + API server + Vite
```

**Developer config — set it once.** Copy `.env.example` → `.env` and fill in your keys
(OpenAI / Anthropic / Gemini / Groq / Deepgram), an optional `OPENAI_MODEL`, or a full
custom OpenAI-compatible endpoint (`LLM_API_KEY` / `LLM_BASE_URL` / `LLM_MODEL`). Both the
dev API server and Electron read `.env` on every launch, so you **never re-enter keys
through the UI** while developing. `.env` is gitignored — your keys are never committed.

> No `.env` is required to *start* — without one, the app shows the in-app key setup
> (that's the path packaged end-users use). The `.env` is purely the dev convenience.

---

## How to use it in a live interview

MockMate is built for **glance-and-riff**, not reading aloud (reading is slow, monotone, and
obvious). The flow is designed for the fraction of a second you have to react:

```
Question lands
   ↓ ~0.5s   a buy-time phrase appears — say it ("Yeah, so…")  → buys you 2–3 seconds
   ↓ ~1–2s   GLANCE the opener + 3 key points (not the paragraph)
   ↓         speak in YOUR OWN words, riffing off those notes
   ↓         drop to the full answer only if you blank
```

The key points are **speaking notes to riff from — not a script.** Set your **voice & style**
once in setup ("talk like a senior eng chatting with a peer, lean on my fintech work") and every
answer matches it.

---

## Modes

### 🎯 Live Interview Companion
- Floats over **Zoom / Google Meet / Microsoft Teams** — always on top, only you see it
- Captures **system audio** and transcribes the interviewer in real time via **Deepgram nova-2**
- Streams a natural, **resume-grounded** answer — references your actual projects, never generic
- **Custom voice prompt** — set your persona/tone/seniority once; it shapes every answer
- Auto-detects coding platforms (LeetCode, HackerRank, CoderPad…) → one-tap **Coding mode**
- **Live web search** auto-triggers for company/product questions
- **Mid-session context field** to steer answers ("focus on Python", "system design round")
- Post-session AI notes

### 🤖 Solo Practice
- AI interviewer asks role-calibrated questions, probes with follow-ups
- End-of-session scorecard: technical knowledge, communication, problem-solving, delivery

### 💻 Coding Mode
- Press **`Ctrl+Shift+U`** (or tap the auto-detected "Solve it" prompt) on a coding question
- GPT-4o vision reads the screen → **working code + approach + complexity + edge cases**
- **Language switcher** — re-solve the same problem in Python/Java/C++/JS/Go/TS instantly
- Syntax-highlighted, one-tap **copy**, hidden from screen share

### 💼 Matching Jobs
- Live roles (Remotive + Adzuna) **ranked against your resume** — why-it-fits + skill gaps
- Location filter, sort by fit / newest / salary, on-site vs remote badges, Load-more
- **★ Save** any role to a local **Saved-jobs dashboard** for later

### 🎯 Resume & Career Tools
- **ATS resume score** — graded 0–100 the way ATS software + a recruiter would (20+ checks: keywords,
  impact metrics, parse-safety, seniority…), with missing keywords, prioritized fixes, and red flags
- **Tailor resume** — rewrites summary + bullets for a target role/JD and surfaces keywords you
  genuinely match (**never fabricates** experience)
- **Referral DM drafter** — a personalized, non-cringe referral request from your resume + role

---

## Answer Intelligence

MockMate detects the question type and answers like a real person under light pressure —
contractions, first person, a little imperfect on purpose (flawless reads as robotic):

- **DSA / Algorithm** → pattern + approach + time/space complexity
- **System Design** → requirements → scale → components → key trade-off
- **Behavioral** → STAR, grounded in your *actual* projects
- **Technical concepts** → sharp definition + analogy + the common mistake
- **Company questions** → live web search for current facts

**Never fabricates.** If a question references a tool, project, or metric that isn't in your
profile, MockMate will **not** claim you used it — it pivots honestly to your closest real
experience and flags the mismatch. A truthful "I haven't used that, but…" keeps the interview
alive; a fabricated claim ends it.

---

## Screen Protection

| Platform | Mechanism | Protection |
|---|---|---|
| **Windows** | `SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE)` | ✅ Invisible to all capture tools |
| **macOS** | `NSWindow.sharingType = NSWindowSharingNone` | ✅ Invisible to all capture tools |
| **Linux** | — | ⚠️ **Not supported** — overlay is visible in screen share |

Content protection is applied to **every** window, including the floating "hints" Picture-in-
Picture window. **Linux note:** Electron has no content-protection API on Linux, so the overlay
**will appear** in screen shares there — use **Windows or macOS** for a hidden overlay.

**Hide shortcut (all platforms):** `Alt+H` or `Ctrl+Shift+H` fully hides/restores the window —
works even when it's not visible.

---

## API Keys

| Key | Purpose | Free? | Link |
|---|---|---|---|
| `OPENAI_API_KEY` | GPT-4o answers + screen/coding vision | Pay per use | [platform.openai.com](https://platform.openai.com/api-keys) |
| `GROQ_API_KEY` | Fast AI answers | ✅ Free | [console.groq.com](https://console.groq.com/keys) |
| `GEMINI_API_KEY` | AI answers + vision alternative | ✅ Free | [aistudio.google.com](https://aistudio.google.com/apikey) |
| `DEEPGRAM_API_KEY` | Live audio transcription | ✅ $200 credits | [console.deepgram.com](https://console.deepgram.com) |
| `TAVILY_API_KEY` | Web search for company questions | ✅ Free | [tavily.com](https://tavily.com) |

**Minimum to run:** one LLM key + Deepgram key.
**Recommended:** configure **2+ LLM providers** — MockMate auto-falls-back when one is
rate-limited, which matters for a full-hour interview (Groq's free tier alone exhausts quickly).
Live hints prefer fast, high-limit models (GPT-4o-mini → Gemini) and keep Groq as a fallback.

---

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Alt+H` / `Ctrl+Shift+H` | Hide / restore the overlay completely |
| `Ctrl+Shift+U` | Capture the screen → instant coding/vision analysis |
| Drag title bar | Move the overlay anywhere |
| ◢ corner | Resize the overlay |

---

## Architecture

**Code layers (enforced):**
- `src/` — **frontend only** (React renderer; DOM, audio capture, `localStorage`). Shared frontend helpers in `src/lib/` (`profile`, `ui`, `languages`).
- `api/`, `server.js`, `electron/` — **backend only** (Node). AI/provider/retry/failover logic in `api/_lib/` (`core`, `interview`, `jobs`, `search`, `http`). The backend **never imports from `src/`**.
- `shared/` — **pure logic used by both** layers (e.g. `shared/delivery.js`: delivery analysis + the single banned-words list). The dependency arrow only ever points *into* `shared/`.
- `backend/` — a **separate** (currently optional/unwired) auth+Mongo service; the foundation for the managed-backend phase ([`docs/NEXT_PHASE.md`](docs/NEXT_PHASE.md)).

```
┌────────────────────────────────────────────────────────────────────────┐
│  Electron main  (electron/main.cjs)                                       │
│   • Frameless · always-on-top · transparent overlay window                │
│   • setContentProtection(true) on every window → hidden from capture      │
│       Windows: WDA_EXCLUDEFROMCAPTURE  ·  macOS: NSWindowSharingNone       │
│   • Global shortcuts (Alt+H hide, Ctrl+Shift+U capture)                    │
│   • Auto-detects meeting + coding-platform windows                        │
│   • Forks the local API server, then loads the UI over http               │
└───────────────┬───────────────────────────────────────────────────────────┘
                │  loads renderer over  http://localhost:3002
                ▼
┌────────────────────────────────────────────────────────────────────────┐
│  Local API server  (server.js, forked child) — serves BOTH:               │
│    • the built React UI (dist/)   → /  /assets/*    (same-origin)         │
│    • the /api/* routes            → no CORS, no file:// breakage          │
└───────────────┬───────────────────────────────────────────────────────────┘
                │
     ┌──────────┼─────────────────┬───────────────────────┐
     ▼          ▼                 ▼                       ▼
  /api/hint   /api/analyze-     /api/deepgram-token     /api/interview
  (answers)    screen (vision)   (mint short-lived STT)  /api/evaluate (Solo)
     │            │
     ▼            ▼
  LLM (auto-fallback): GPT-4o-mini → Gemini → Groq → GPT-4o
  Vision: GPT-4o / Gemini      Web search: Tavily / Serper

  Audio pipeline:
    System audio ─▶ AudioWorklet thread (downsample → PCM16 16kHz)
                 ─▶ Deepgram WebSocket ─▶ live transcript
                 ─▶ question detect ─▶ /api/hint ─▶ streamed answer
    (auto-reconnect + KeepAlive keep the stream alive for 1h+ sessions)

────────────────────────────────────────────────────────────────────────────
  Accounts backend  (backend/, optional, separate service — early)
    Express + MongoDB (Mongoose) · JWT auth
    /auth/signup · /auth/login · /auth/google · /me · /sessions
    Stores profile + resume + session history.  API keys stay LOCAL.
```

**Why the UI loads over http (not `file://`):** serving the built app and the API from the same
local origin makes `/assets` and `/api` resolve correctly and avoids `file://` CORS breakage —
this is what makes the packaged app actually work.

---

## Accounts backend (`backend/`) — optional, early

A separate Express + MongoDB service for accounts and cloud sync (the basis for the planned
managed subscription). Run it locally:

```bash
cd backend && cp .env.example .env   # set MONGO_URI + JWT_SECRET
npm install && npm start             # → http://127.0.0.1:4000
```

Implemented: email/password auth (bcrypt + JWT), `/auth/signup|login|me|logout`, Google OAuth
endpoints, and `GET/PATCH /me` (profile + resume). **Desktop login wiring shipped in v1.4.0** —
the backend is forked from the Electron main process, with a **file-backed store by default**
(offline-safe; **MongoDB opt-in via `MONGO_URI`**) and an **env-configurable base URL
(`MOCKMATE_API_BASE`)** for pointing at a hosted service later. API keys are **never** stored
here — they stay on the user's machine.

---

## Roadmap

**Done (1.4.0)**
- ✅ **Auth system** — Welcome / Signup / Login / 2-step Onboarding; the app is gated behind sign-in (everyone on `free`, no billing yet).
- ✅ **Account screen** — plan badge, monthly usage bars (display-only until metering ships), *Use my own API keys* toggle, Sign out.
- ✅ **Home overlay redesigned** — Kanit, `#0c0c0c`, accent-gradient Live hero, Practice grid, single Career row, quiet footer; shortcuts moved behind the ⌨ button.
- ✅ **Kanit self-hosted** — woff2 bundled, no Google Fonts CDN (privacy + offline-safe).
- ✅ **Job match in Career** — Matching Jobs is now a tab inside the Career suite (Home → Career → Jobs).
- ✅ **Auth backend wired** — forked from Electron main; **file-store default**, **Mongo opt-in** (`MONGO_URI`), **env-configurable base** (`MOCKMATE_API_BASE`); JWT stored via `safeStorage`.
- ✅ **Solo voice reliability** — Deepgram-primary with a text-mode fallback; never silently fails on browser STT inside Electron.
- ✅ **Auto-update CI guards** — release fails loudly if the tag ≠ `package.json` version or `latest*.yml` is missing.

**Done**
- ✅ Auto-update via `electron-updater` (Windows + Linux) — silent background install on restart
- ✅ **Real-time accuracy + speed core**: Deepgram **keyterm boosting** (resume/role jargon), **diarization** (answers the interviewer, not your own voice), and **true token streaming** (first words in <1s, replacing the cosmetic word-reveal)
- ✅ **Matching Jobs** (live) — your resume ranked against real postings with reasons + gaps (keyless Remotive source)

**Done (1.3.0)**
- ✅ **Matching Jobs — geo-aware + local jobs**: location filter/input, role-first matching, Load-more, salary/recency sort, and **Adzuna** (`ADZUNA_APP_ID`/`ADZUNA_APP_KEY`) for real **local on-site** jobs merged with region-filtered remote (keyless Remotive stays the always-on fallback).
- ✅ **Global API keys + first-run Welcome** — set keys once (Home → ⚙ Settings); apply to Solo, Live & Jobs without opening any mode first.
- ✅ **Solo review**: copy feedback, copy transcript, full conversation, **3-month local history**, and a **score-trend chart**.
- ✅ **Live Companion session review** — records what *you* said (not the AI's suggestions) → Solo-style scored review.
- ✅ **Resilience**: retry + **instant auto-failover across providers**, transient-503 handling, bounded long-session context, timeouts on all external calls, vision (screen-analysis) failover OpenAI↔Gemini.
- ✅ **Telugu + Indian languages**; browser STT now transcribes in the chosen language.
- ✅ **Codebase cleanup**: dead code removed, shared `src/lib/` + `shared/` modules (single source for colors/languages/profile/banned-words/timeout), backend no longer imports from the frontend.
- ✅ **Resume & Career Tools**: **ATS resume score** (20+ checks), **per-role resume tailoring** (never fabricates), and a **referral-message drafter** — all from your existing resume + LLM (`api/_lib/career.js`).
- ✅ **Saved-jobs dashboard**: ★ Save any match to a local, persistent saved list (`src/savedJobs.js`).

**Next — Managed backend (the path to compete with LockedIn AI / FinalRound)**
> Full design spec + per-phase status: [`docs/NEXT_PHASE.md`](docs/NEXT_PHASE.md)
- ✅ **Login / accounts** — shipped in v1.4.0 (auth, onboarding, Account screen; everyone on `free`).
- ⏳ **Proxy + metering** — route `/api/*` through the authed backend, record usage, enforce plan caps (402 on limit).
- ⏳ **Stripe subscriptions** + **server-held platform keys** — so users "sign up, pay, and it just works" with no key setup. BYO-key stays a first-class option.

**Next — quality**
- **Model-escalation tier**: fast model for simple Qs, strong/reasoning model for DSA + system design.
- Full-session conversation memory (beyond the last few turns).
- Coding-mode follow-ups: "optimize / explain / dry-run".

**Later**
- **Job-application automation** (LinkedIn auto-apply, referral finding + auto-DM) — a **separate
  browser-extension** product, **not** an OAuth feature of this app. It runs in the user's own
  logged-in browser session (LinkedIn exposes no public auto-apply/connections API) and carries
  LinkedIn-ToS/account-ban risk. Design + the OAuth-≠-auto-apply rationale: [`docs/NEXT_PHASE.md`](docs/NEXT_PHASE.md). The ToS-safe pieces (ATS score, tailoring, referral drafting) already ship in-app above.
- ⏳ **macOS code signing + notarization** — unlocks macOS auto-update (currently a manual `.dmg` re-download)
- Deeper stealth (process / Activity-Monitor hiding) for an "undetectable" claim
- More languages (→ 25+), privacy-respecting opt-in analytics
- Linux screen-protection research (Wayland/X11)

---

## Scripts

```bash
npm run electron:dev         # Launch Electron overlay + API + Vite (recommended)
npm run dev                  # API server + Vite only (browser, no screen protection)
npm run build                # Build the frontend (Vite → dist/)
npm run electron:build       # Build installer for the current platform
npm run electron:build:win   # Windows installer (.exe, nsis)
```

**Cross-platform builds** (Windows + Linux + macOS) are produced by GitHub Actions —
see `.github/workflows/release.yml`. Trigger it from the **Actions** tab
("Build & Release MockMate" → *Run workflow*) or by pushing a `v*.*.*` tag.

---

## Supported Languages

English, Spanish, French, German, Portuguese, Hindi, Japanese, Chinese, Korean, Arabic, Italian, Dutch

---

## Privacy

- Audio streamed to **Deepgram** for transcription (per-session, not stored)
- Screenshots sent to **OpenAI / Gemini** only when you press `Ctrl+Shift+U`
- Resume text sent to the LLM as context for grounding answers
- The optional accounts backend stores profile/resume/history per your choice — **API keys never leave your machine**
- No analytics, no tracking
