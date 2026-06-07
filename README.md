# MockMate — Real-Time AI Interview Companion

A desktop overlay that floats over your screen during live interviews, listens to the
interviewer, and gives you natural, resume-grounded answers in seconds.
**Invisible to screen recording and screen share on Windows & macOS.**

---

## Download (no setup)

Grab the latest build from the [**Releases page**](https://github.com/vsv2014/MockMate/releases/latest):

| Platform | File | Run |
|---|---|---|
| **Windows** | `MockMate-1.0.0-Windows.zip` | Extract → run `MockMate.exe` |
| **Linux** | `MockMate-1.0.0.AppImage` | `chmod +x` → run it |
| **macOS** | `MockMate-1.0.0-arm64.dmg` (Apple Silicon) / `-x64.dmg` (Intel) | Open the dmg → drag to Applications |

On first launch, MockMate opens a **setup screen** where you paste your API keys — no manual
file editing. Keys are saved locally and the app restarts ready to use.

> **Launch MockMate _before_ you join the call.** It appears in the top-right corner; press `Alt+H` to hide/show.

## Run from source (developers)

```bash
git clone https://github.com/vsv2014/MockMate
cd MockMate
npm install
npm run electron:dev   # launches the Electron overlay + API server + Vite
```

No `.env` is required to start — the app shows the setup screen if no keys are found. To
preconfigure keys, create a `.env` in the project root (or next to the built executable).

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

Implemented: email/password auth (bcrypt + JWT), Google OAuth endpoints, `GET/PATCH /me`
(profile + resume), and per-user session history. Desktop login wiring is in progress. API keys
are **never** stored here — they stay on the user's machine.

---

## Roadmap

**Now**
- Auto-update (`electron-updater`) + signed/notarized installers
- Accounts + billing rails (Stripe) — foundation of the managed subscription

**Next**
- Managed-key proxy — paid tier with zero key setup ("it just works")
- Cloud profile / resume / session-history sync (via the accounts backend)
- Full-session conversation memory (beyond the last few turns)
- Coding-mode follow-ups: "optimize / explain / dry-run", capture-just-the-problem-pane

**Later**
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
npm run electron:build:win   # Windows .zip
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
