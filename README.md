# MockMate — Real-Time AI Interview Companion

A desktop app for interview prep **and** live help: a full **dashboard workspace** (Solo practice,
Resume Studio, Job matching, Sessions) plus a **live overlay** that floats over your
screen during real interviews, listens to the interviewer, and gives natural, resume-grounded
answers in seconds. On **Windows & macOS**, the overlay uses OS content-protection APIs so it can be
**excluded from common screen-share / recording paths** — always verify in your meeting app’s share
preview before a real interview. Treat stealth as **partial / matrix UNKNOWN** until you’ve proven
it for your stack. **Not supported on Linux.** See [Screen Protection](#screen-protection).

AI runs in one of two modes: **MockMate AI** (managed — when the hosted proxy is configured: no keys
to manage, automatic routing + failover) or **Bring your own key** (OpenAI / Anthropic / Gemini /
Groq / Cerebras, stored locally; the model picker is discovered live from your key).

---

## Download (no setup)

Grab the latest build from the [**Releases page**](https://github.com/vsv2014/MockMate/releases/latest):

| Platform | File | Run |
|---|---|---|
| **Windows** | `MockMate-Setup-<version>.exe` | Run the installer |
| **Linux** | `MockMate-<version>.AppImage` | `chmod +x` → run it |
| **macOS** | `MockMate-<version>-arm64.dmg` (Apple Silicon) / `MockMate-<version>-x64.dmg` (Intel) | Open the dmg → drag to Applications |

On first launch you sign in or continue as a guest and land on the **dashboard**. Internal QA
installers can include team providers; otherwise open **Settings → Bring your own key** to use your
own OpenAI / Anthropic / Gemini / Groq / Cerebras key (stored locally). Keyless **MockMate AI** only
applies when the hosted managed proxy is configured. Then **Begin interview** (Solo) or **Start Live**.

**Auto-update (Windows & Linux):** new versions download in the background and MockMate shows
**Restart & install** when ready. Choosing **Later** never installs unexpectedly; use
**Settings → Check for updates** for an explicit Checking / Up to date / Downloading / Ready /
failure result. **macOS updates are manual for now**
(the build isn't code-signed yet) — grab the latest `.dmg` from the [releases page](https://github.com/vsv2014/MockMate/releases/latest).

> **macOS:** the DMG is **not** notarized yet, so on first open Gatekeeper shows
> _"Apple could not verify MockMate is free of malware"_ — clear it with **right-click → Open**
> (or `xattr -dr com.apple.quarantine /Applications/MockMate.app`). New versions are a manual
> re-download for now; auto-update on macOS needs Apple Developer signing — see [`SIGNING.md`](SIGNING.md).
>
> **Windows:** until Authenticode secrets (`WIN_CSC_*`) are configured — see [`SIGNING.md`](SIGNING.md) —
> the installer is **not** code-signed. SmartScreen may show _"Windows protected your PC"_
> (**More info → Run anyway**), and **Smart App Control** can also block install/uninstall because
> Windows cannot verify the publisher. **Modify** in Installed apps stays greyed out on purpose
> (NSIS has no MSI-style Modify).

> **Launch MockMate _before_ you join the call.** It appears in the top-right corner; press `Alt+H` to hide/show.

## Run from source (developers)

```bash
git clone https://github.com/vsv2014/MockMate
cd MockMate
npm install
cp .env.example .env            # configure keys ONCE — dev reads this automatically
npm run electron:dev            # macOS / Windows: Electron app + API server + Vite
# Linux (Chromium's SUID sandbox needs root perms) — use the no-sandbox dev script instead:
npm run electron:dev:nosandbox
```

> **Debugging:** packaged builds write privacy-safe structured events to
> **`%APPDATA%\mockmate\logs\diagnostics.jsonl`** on Windows. Use
> **Settings → Diagnostics → Export logs** to share a redacted timeline covering API, STT,
> provider/model failover, screenshot, auth, session and updater behavior. Development API logs
> also tee to `logs/server.log`. See [`docs/DIAGNOSTICS.md`](docs/DIAGNOSTICS.md).

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
- Floats over **Zoom / Google Meet / Microsoft Teams** — always on top
- Captures **system audio** and transcribes the interviewer in real time via **Deepgram** (Voice)
- Streams a natural, **resume-grounded** answer — references your actual projects, never generic
- **Custom voice prompt** — set your persona/tone/seniority once; it shapes every answer
- Auto-detects coding platforms (LeetCode, HackerRank, CoderPad…) → one-tap **Coding mode**
- **Live web search** auto-triggers for company/product questions
- **Mid-session context field** to steer answers ("focus on Python", "system design round")
- **Documents (RAG)** — upload your resume / JD / notes; they're chunked + embedded and the most
  relevant parts are retrieved *per question* (no more truncated-resume stuffing)
- **Answer controls** — Concise / Balanced / Detailed length, Answer vs Coach mode, Auto-skip noise
- **Minimize to a pill** — collapses to a small logo; content protection still applies where the OS allows — **verify share preview**
- Post-session AI notes (not a fake live score)

### 👥 Duo (Beta)
- A friend/mentor **joins your interview room live** — shared transcript + screen share
- The candidate gets a **private AI co-pilot** the partner never sees — rendered in a
  **content-protected window** where the OS supports it (always verify share preview)
- Needs LiveKit configured (`LIVEKIT_URL` / `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET`)

### 🤖 Solo Practice
- AI interviewer asks role-calibrated questions, probes with follow-ups
- End-of-session scorecard: technical knowledge, communication, problem-solving, delivery

### 💻 Coding Mode
- Press **`Ctrl+Shift+U`** (or tap the auto-detected "Solve it" prompt) on a coding question
- GPT-4o vision reads the screen → **working code + approach + complexity + edge cases**
- **Language switcher** — re-solve the same problem in Python/Java/C++/JS/Go/TS instantly
- Syntax-highlighted, one-tap **copy** (same content-protection caveats as Live — verify share preview)

### 💼 Job Matching
- Live roles (Remotive + Adzuna) **ranked against your resume** — why-it-fits + skill gaps
- Location filter, sort by fit / newest / salary, on-site vs remote badges, Load-more
- **★ Save** any role to a local **Saved-jobs** list (status + notes)
- Open **Resume Studio** against a match, or **use this JD** in Solo / Live (confirm → profile)

### 📄 Resume Studio
- **ATS resume score** — graded **/100** with checks (keywords, impact metrics, parse-safety, seniority…),
  missing keywords, prioritized fixes, and red flags
- **Tailor resume** — rewrites summary + bullets for a target role/JD and surfaces keywords you
  genuinely match (**never fabricates** experience). Analysis JD on this screen stays local to Resume Studio.
  Primary export: **Download PDF** (1–2 pages); optional `.txt` / Overleaf `.tex`.
- **Referral DM drafter** — personalized note from your resume + role; **copy to paste** only
  (MockMate does not send email or LinkedIn messages). Follow-up / user-confirmed send is roadmap § P6.
- Hand off a listing to **score/tailor**, or seed the JD into **Solo / Live** with an explicit confirm.

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
| **Windows** | `SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE)` via Electron `setContentProtection` | ✅ **Partially supported** — excluded from common OS screen-capture / share APIs; **verify in your meeting app before a real interview** |
| **macOS** | `NSWindowSharingNone` via Electron `setContentProtection` | ✅ **Partially supported** — same caveat; verify Zoom/Meet/Teams share preview |
| **Linux** | — | ⚠️ **Not supported** — overlay is visible in screen share |

Content protection is applied to **every** BrowserWindow, including the floating hints / PiP
window. This is **not** “invisible to all capture tools” and **not** undetectable: cameras
filming the screen, some remote-desktop / DLP paths, HDMI taps, and certain browser/compositor
edge cases are outside this API. **Always dry-run a screen share** (see `docs/STEALTH_BROWSER_MATRIX.md`)
before trusting it live. **Linux:** no content-protection API — use Windows or macOS for a hidden overlay.

**Hide shortcut (all platforms):** `Alt+H` or `Ctrl+Shift+H` fully hides/restores the window —
works even when it's not visible.

---

## API Keys

| Key | Purpose | Free? | Link |
|---|---|---|---|
| `OPENAI_API_KEY` | GPT-5.6 / GPT-5.4 / GPT-4o answers (subject to key access) + screen/coding vision + document embeddings (RAG) | Pay per use | [platform.openai.com](https://platform.openai.com/api-keys) |
| `GROQ_API_KEY` | Fast AI answers | ✅ Free | [console.groq.com](https://console.groq.com/keys) |
| `GEMINI_API_KEY` | AI answers + vision + embeddings (RAG) alternative | ✅ Free | [aistudio.google.com](https://aistudio.google.com/apikey) |
| `CEREBRAS_API_KEY` | Fastest-throughput answers (Llama, wafer-scale) | ✅ Free | [cloud.cerebras.ai](https://cloud.cerebras.ai) |
| `ANTHROPIC_API_KEY` | Claude Fable 5 / Opus 5 / Sonnet 5 / Haiku 4.5 answers (subject to key access) | Pay per use | [console.anthropic.com](https://console.anthropic.com/settings/keys) |
| `DEEPGRAM_API_KEY` | Live audio transcription | ✅ $200 credits | [console.deepgram.com](https://console.deepgram.com) |
| `TAVILY_API_KEY` | Web search for company questions | ✅ Free | [tavily.com](https://tavily.com) |
| `LIVEKIT_URL` / `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` | **Duo** rooms (collaborative interview help) | ✅ Free tier | [cloud.livekit.io](https://cloud.livekit.io) |

**Minimum to run:** one LLM key + Deepgram key. Duo needs the LiveKit trio (optional). See `.env.example`.
**Recommended:** configure **2+ LLM providers** — MockMate auto-falls-back when one is
rate-limited, which matters for a full-hour interview (Groq's free tier alone exhausts quickly).
On **Auto**, Live hints prefer the fastest current model (Gemini Flash-Lite / Cerebras / Groq) and
hard questions escalate to a strong model. **Maximum quality** routes every answer to the strongest exact model discovered for the configured keys (for example GPT-5.6 Sol or Claude Fable 5). Model defaults are
`.env`-overridable (e.g. `OPENAI_GPT5_MODEL`, `GEMINI_FLASH_LITE_MODEL`, `CEREBRAS_MODEL`).

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
- `src/` — **frontend only** (React renderer; DOM, audio capture, `localStorage`). Helpers in `src/lib/`
  (`profile`, `docs`, `careerDraft`, `resumePdf`, `clipboard`, `interviewJobSeed`, …) and Live slice in `src/live/`.
- `api/`, `server.js`, `electron/` — **backend only** (Node). AI/provider/retry/failover in `api/_lib/`
  (`core`, `interview`, `jobs`, `career`, `visionPolicy`, `playbooks`, `http`). The backend **never imports from `src/`**.
- `shared/` — **pure logic used by both** layers (`delivery`, `retrieval`, `interviewState`,
  `generationManager`, `questionCapture`, `interviewClassify`, `screenContext`, …). Dependency arrow only ever points *into* `shared/`.
- `backend/` — JWT auth + (Phase 2b) managed `/api` proxy; forked from Electron; see [`docs/NEXT_PHASE.md`](docs/NEXT_PHASE.md).

```
┌────────────────────────────────────────────────────────────────────────┐
│  Electron main  (electron/main.cjs)                                       │
│   • Frameless · always-on-top · transparent overlay window                │
│   • setContentProtection(true) on every window → common capture APIs      │
│       (Win/macOS; NOT all tools — always verify share preview)             │
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
     ┌──────────┼─────────────────┬───────────────────┬───────────────────┐
     ▼          ▼                 ▼                   ▼                   ▼
  /api/hint   /api/analyze-     /api/deepgram-token  /api/interview     /api/token (LiveKit)
  (answers)    screen (vision)   (mint STT token)    /api/evaluate (Solo) /api/embed (RAG)
     │            │
     ▼            ▼
  LLM on Auto: fast tier (Gemini Flash-Lite / Cerebras / Groq / GPT-mini) for live hints,
  escalates to a strong tier (GPT-5.4 / Claude) for DSA + system design — with auto-failover.
  Vision: GPT-4o / Gemini      Web search: Tavily / Serper (time-boxed)   Embeddings: OpenAI / Gemini

  Audio pipeline:
    System audio ─▶ AudioWorklet thread (downsample → PCM16 16kHz)
                 ─▶ Deepgram WebSocket ─▶ live transcript
                 ─▶ question detect ─▶ /api/hint ─▶ streamed answer
    (auto-reconnect + KeepAlive for long sessions; continuous 120m not claimed / not verified)

────────────────────────────────────────────────────────────────────────────
  Accounts backend  (backend/, optional, separate service — early)
    Express + MongoDB (Mongoose) · JWT auth
    /auth/signup · /auth/login · /auth/google · /me · /sessions
    Account fields + optional future sync endpoints. Desktop résumé/transcripts stay LOCAL by default.
    API keys stay LOCAL until the hosted managed-key proxy is built.
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
endpoints, and `GET/PATCH /me` account/profile fields. The backend schema can accept résumé data,
but the desktop deliberately does **not** upload it; résumé and transcripts remain local unless a
future explicit encrypted-sync option is enabled. **Desktop login wiring shipped in v1.4.0** —
the backend is forked from the Electron main process, with a **file-backed store by default**
(offline-safe; **MongoDB opt-in via `MONGO_URI`**) and an **env-configurable base URL
(`MOCKMATE_API_BASE`)** for hosted Managed AI. Managed provider keys stay on that backend;
BYOK keys stay encrypted on the user's machine.

---

## Roadmap

**Done (1.4.10)**
- ✅ **Managed AI release boundary** — public installers contain no provider keys and release CI requires a valid hosted HTTPS endpoint.
- ✅ **Server-owned entitlements** — managed clients cannot bypass plan model tiers; monthly LLM usage is reserved atomically and failed/cancelled calls are released.
- ✅ **Provider/RAG resilience** — model-family failover is bounded and embeddings fall back from OpenAI to Gemini with provider-specific model IDs.
- ✅ **Hosted diagnostics** — desktop/backend request correlation plus metadata-only provider attempt logs; no prompts, transcripts, screenshots, audio or secrets.
- ✅ **Electron 43 / Node 24** — runtime, release workflow and packaging checks migrated.

**Done (1.4.9)**
- ✅ **Multi-screenshot questions** — queued captures can be combined into one bounded question/answer chain, with explicit Continue/New controls and Undo merge.
- ✅ **Latest answer visibility** — compact Live follows the rendered answer while respecting manual reading; Jump to latest targets the newest answer.
- ✅ **Production diagnostics** — buffered/rotated local JSONL timeline with two-stage redaction, session/request correlation, provider/model attempts, STT reconnects, screenshot continuation, auth/API latency and updater lifecycle; Export/Clear controls in Settings.
- ✅ **Windows updater recovery** — updater state survives dashboard/auth startup, Check for updates always reports a state, and Later does not silently install on quit.
- ✅ **Release gates** — tag/package version match, unit tests, API smoke and updater-artifact validation run before publishing.
- ✅ **Managed release boundary** — public installers contain no provider secrets and fail release unless an HTTPS managed endpoint is configured.

**Done (1.4.8)**
- ✅ **Live intent reliability** — slower semantic commit gate, overlap/artifact cleanup, correction cancellation, and active-card refinements for requests such as “write it as code.”
- ✅ **Bounded answers** — provider first-byte timeout, 12-second Live deadline, stale-generation cancellation, and visible superseded/failed/Retry states.
- ✅ **Truthful role fit** — resume-only first-person evidence, JD-prioritized framing, and explicit code/language/brief output contracts.
- ✅ **Preflight overlay controls** — setup is draggable/resizable and collapses to a movable pill before Start Live.
- ✅ **Safer Stealth + coding transforms** — OFF requires confirmation; screen-solution language tabs regenerate complete code in the selected language.
- ✅ **Mid-interview coding** — coding requests reset routing from earlier topics and loose streamed code is normalized into an expanded highlighted/copyable block.

**Done (1.4.6)**
- ✅ **Live engine hardening** — `InterviewState` / generation / question-capture / classification authority; text vs vision provider health; Deepgram local-managed key fallback policy.
- ✅ **Resume Studio exports** — tailored **PDF** (primary), optional `.txt` / FAANG `.tex`; draft persistence across minimize; Electron-safe copy.
- ✅ **Jobs ↔ Career ↔ interview** — JD seed into Solo/Live; Documents `jd` type; Home declutter (screen solve on Live only).
- ✅ **`npm run smoke:api`** + expanded vitest net. Referral follow-up/send stays **roadmap P6** (copy-only today).

**Done (1.4.5)**
- ✅ Compact Live HUD, pin/pill stay-or-hide, and optional CI signing paths. *(Legacy internal builds could bundle keys; public builds no longer do.)*

**Done (1.4.4)**
- ✅ Jobs → Resume Studio handoff, apply-tailor-to-resume, saved-job status/notes, Solo turn timeout, honest Home readiness / landing.

**Done (1.4.3)**
- ✅ **Fixed the packaged-app regression** — the local server's CSP blocked the auth backend + LiveKit, so Solo/Live/sign-in failed in 1.4.2; loopback + LiveKit origins now allowlisted.
- ✅ **Duo (Rooms)** — a friend joins live: shared transcript + screen, plus a private, capture-protected AI co-pilot (LiveKit).
- ✅ **Document RAG** — chunk + embed uploaded docs, retrieve the relevant parts per question (replaces truncated-resume stuffing).
- ✅ **AI Settings** — response length, screenshot Quality/Faster, auto-skip, doc-relevance threshold; **guest mode**, **collapse-to-pill**, **What's New**.
- ✅ **Modernized model catalog** — GPT-5.4 / Gemini 3 Flash / Flash-Lite / Cerebras / Claude Sonnet 5; Auto routes fast-for-live, strong-for-hard with failover.

**Done (1.4.2)**
- ✅ **Live reliability** — blank-answer retry, faster time-to-first-token, reconnect through network blips, honored model choice on the non-streaming path.

**Done (1.4.0)**
- ✅ **Auth system** — Welcome / Signup / Login / 2-step Onboarding; the app is gated behind sign-in (everyone on `free`, no billing yet).
- ✅ **Account screen** — plan badge, monthly usage bars (display-only until metering ships), *Use my own API keys* toggle, Sign out.
- ✅ **Home overlay redesigned** — Kanit, `#0c0c0c`, accent-gradient Live hero, Practice grid, single Career row, quiet footer; shortcuts moved behind the ⌨ button.
- ✅ **Kanit self-hosted** — woff2 bundled, no Google Fonts CDN (privacy + offline-safe).
- ✅ **Job Matching + Resume Studio** — separate workspace screens (sidebar); share resume/role profile.
- ✅ **Auth backend wired** — forked from Electron main; **file-store default**, **Mongo opt-in** (`MONGO_URI`), **env-configurable base** (`MOCKMATE_API_BASE`); JWT stored via `safeStorage`.
- ✅ **Solo voice reliability** — Deepgram-primary with a text-mode fallback; never silently fails on browser STT inside Electron.
- ✅ **Auto-update CI guards** — release fails loudly if the tag ≠ `package.json` version or `latest*.yml` is missing.

**Done**
- ✅ Auto-update via `electron-updater` (Windows + Linux) — background download with explicit Restart & install
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
- ✅ **Resume Studio**: **ATS resume score** (/100), **per-role resume tailoring** (never fabricates), and a **referral-message drafter** — from your resume + LLM (`api/_lib/career.js`).
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
- **Referral outreach (in-app)** — keep copy-only drafts now; next: local follow-up reminders, then
  optional **user-confirmed** send via the user’s Gmail/Outlook (not MockMate mailers / not silent
  multi-agent triggers). Phased plan: [`docs/ROADMAP.md` § P6](docs/ROADMAP.md).
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
npm test                     # Vitest unit suite
npm run smoke:api            # API route contract smoke (in-process)
npm run verify               # doctor + build + tests
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

- **BYOK mode:** your provider API keys stay in local `userData` / `.env` and are sent only to the providers you configure (OpenAI, Anthropic, Deepgram, etc.) — not to a MockMate key vault.
- **Shipped builds never include provider keys.** Managed AI uses server-held credentials; BYOK/private mode uses the user's encrypted device-local keys.
- **Interview content leaves the device** when features need it: audio → **Deepgram**; resume/JD/transcript → your chosen **LLM**; screenshots → **OpenAI / Gemini** when you press `Ctrl+Shift+U`.
- **Managed MockMate AI:** prompts and context go through MockMate’s authenticated, metered proxy; platform keys stay on the server.
- Optional accounts backend can store profile/resume/history if you choose — separate from API keys.
- No third-party product analytics/tracking in the desktop app.
