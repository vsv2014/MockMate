# MockMate — Architecture & Onboarding

> A desktop **AI interview copilot**: a full dashboard app for prep (Solo practice, Resume Studio,
> Job matching, Sessions) **and** a live overlay that listens during real interviews and streams
> resume-grounded answers. Built with **Electron + React (Vite)** + a small **Express** API and a
> **JWT auth backend**. On Windows/macOS, Electron `setContentProtection` can exclude the overlay
> from common capture APIs — **always verify share preview**; not supported on Linux.

This doc is written so a new dev (or an AI coding agent — Claude Code / Codex) can be productive fast.

---

## 1. Run it

```bash
git clone https://github.com/vsv2014/MockMate && cd MockMate
npm install                     # single node_modules at root (backend deps live here too)

# macOS / Windows:
npm run electron:dev            # Electron + local API server(:3002) + Vite(:5174) + auth backend(:4000)
# Linux (Chromium SUID sandbox needs root, so):
npm run electron:dev:nosandbox
```

- **Keys:** none needed to boot. Add AI keys in-app: **Settings → Use my own API key** (stored in
  `~/.config/mockmate/.env`), or for dev put them in a project `.env` (see `.env.example`).
- **Logs:** the API server tees everything to **`logs/server.log`** — `tail -n 40 logs/server.log`
  is the fastest way to see LLM errors / provider failover. **Check it first when debugging.**
- **Tests:** `npm test` (vitest). **API smoke:** `npm run smoke:api`. **Build UI:** `npm run build`.
  **Full gate:** `npm run verify`. **Package app:** `npm run electron:build` (`:win` for Windows).

---

## 2. The 4 processes (mental model)

```
Electron MAIN (electron/main.cjs) ── window, tray, global shortcuts, IPC, content-protection,
   │                                  auto-update. FORKS the two servers below.
   ├─ forks ──► LOCAL API server (server.js, :3002)  ── LLM /api/* using LOCAL/BYOK keys (private)
   └─ forks ──► AUTH backend (backend/server.js, :4000) ── JWT auth + (Phase 2b) MANAGED /api proxy
Renderer (React, Vite :5174 in dev) ── the whole UI. Talks to :3002 via /api (vite proxy).
```

- **Local server (`server.js`)** = the BYOK/private path: `/api/*` LLM routes, **unauthed**, keys stay
  on the machine. Reads keys from userData `.env` + project `.env`.
- **Auth backend (`backend/`)** = accounts (JWT) and — new in **Phase 2b** — the **managed** `/api/*`
  proxy: same LLM engine but **authed + metered** (this is where MockMate's own keys will live).
- Both mount the **same** route module (`api/_lib/apiRoutes.js`) — `server.js` unauthed, `backend`
  authed+metered. One engine, two deployments.

---

## 3. The AI engine (`api/_lib/`) — the heart

- **`core.js`** — provider registry + router.
  - `CATALOG` — providers (openai, openai_mini, groq, gemini, claude_*) → `{ label, envKey, baseURL, model() }`.
  - `completeJSON()` / `streamText()` — call an LLM with **automatic failover** across configured
    providers (`getFallbackProviders`), rate-limit/quota/400 **benching**, JSON repair.
  - **Text vs vision health** (1.4.6) — separate last-working / ban windows so a vision 429 does not
    take text offline (and vice versa).
  - **Model selection:** a provider id can be plain (`openai`) or an encoded dynamic pick
    **`provider::model`** (e.g. `openai::gpt-4.1`). `resolveProvider`/`baseOf` handle both.
  - `listModels()` — **dynamic discovery**: asks each key's provider (`/v1/models` etc.) what models
    it can actually use, so the picker is always current and never 400s on a stale id.
  - **Gemini gotcha:** never send `response_format:json_object` to Gemini (400s) — only `reasoning_effort:'none'`.
- **`apiRoutes.js`** — `registerApiRoutes(app, { auth, onLlm, report })` registers every `/api/*` route
  (incl. Deepgram token policy, `/api/resume-latex`, embed, interview, career, jobs).
- **`interview.js`** — `interviewerTurn` (Solo), `streamHint`/`generateHint` (Live, SSE), `evaluateSolo`
  (scoring), `analyzeScreen` (Ctrl+Shift+U / F7), interview **playbooks** (also `playbooks.js`).
- **`visionPolicy.js`** — when / how screen analysis may run.
- **`jobs.js`** — `findJobs` (Remotive remote + Adzuna local; LLM ranker → keyword fallback).
- **`career.js`** — `atsScore`, `tailorResume`, `referralMessage`, `resumeLatex`.
- **`api/*.js`** — thin Vercel serverless wrappers of the same handlers (web deploy).

### Live interview shared modules (`shared/` + `src/live/`)
- **`interviewState.js`**, **`generationManager.js`**, **`questionCapture.js`**, **`interviewClassify.js`**,
  **`screenContext.js`**, **`transcriptBuffer.js`**, **`contextSelection.js`**, **`hintLayers.js`** —
  authority for question lifecycle, generations, and context (unit-tested).
- **`src/live/hintTransport.js`**, **`LiveSessionController.js`** — Live SSE / session orchestration slice.
- **`shared/delivery.js`** — filler/pace analysis (do not confuse with deleted `src/delivery.js`).

---

## 4. Frontend (`src/`)

- **`App.jsx`** — `ElectronShell`: `view` state + routing. `SHELL_VIEWS` (home/solo/jobs/career/
  settings/account/history/documents…) render inside the **dashboard shell**; `companion` (Live)
  renders as the compact **overlay**. Minimize-to-pill **keeps the shell mounted** (hidden) so
  Career drafts survive. Screen analysis UI lives on **Live**, not Home. Wrapped in `<AuthGate>`.
- **`Dashboard.jsx`** — `AppShell` (top bar + sidebar), `DashboardHome` (greeting, action cards,
  Recent Sessions, `Sparkline` performance, `SystemStatus`), `SessionsTable`, `UpdateToast`.
- **`Solo.jsx`** — Solo Practice: setup → 3-panel interview workspace → feedback. Deepgram voice
  (`useDeepgram`); no browser mic (fails in Electron). **`SoloFeedback.jsx`** = results screen.
- **`LiveCompanion.jsx`** — Live: setup (full-window) → `LiveOverlay` (compact HUD, streaming
  suggested answers) → feedback. Reports its phase up so the window resizes.
- **`Career.jsx`** — Resume Studio: ATS / tailor / referral (copy-only). Tailor exports: **PDF**
  primary (`lib/resumePdf.js`), optional `.txt` / `.tex`. Draft JD: `lib/careerDraft.js`.
- **`Jobs.jsx`** — matching + saved jobs; handoff to Career / Solo / Live via `lib/jobsHandoff.js`
  + `lib/interviewJobSeed.js`.
- **`Documents.jsx`** + **`lib/docs.js`** — client-side RAG index.
- **`ApiKeys.jsx`** — Settings AI chooser: **Managed AI** vs **Bring your own key** cards + the
  dynamic model picker (from `/api/models`) + key entry.
- **`Account.jsx`**, **`auth/`** (AuthGate, Login, Signup, Welcome, Onboarding, `api.js`, **`tokens.js`**
  = design system, `ui.jsx`, `AuthShell.jsx`). Onboarding resume: **PDF-only**.
- **`lib/aiMode.js`** — `managed` vs `byok` (`MANAGED_AVAILABLE` flag). `lib/profile.js`, `lib/ui.js`
  (`scoreColor`), `lib/languages.js`, `history.js` (local sessions), `lib/clipboard.js`.
- **Design tokens** live ONLY in `src/auth/tokens.js` (teal accent `#14B8A6→#10B981`, dark surfaces,
  Kanit font). Change colors/radii there.

---

## 5. Auth & data (`backend/`)

- **`server.js`** — Express: `/auth/*`, `/me`, `/health`, `/sessions` (Mongo-only), and (2b) the
  authed+metered `/api/*` proxy.
- **`src/store.js`** — user + usage store. **file** backend (default, `~/.config/mockmate/`) or
  **mongo** (set `MONGO_URI`). Same API either way. `getUsage`/`addUsage`/`currentPeriod`.
- **`src/middleware/auth.js`** — `requireAuth` (JWT, `tokenVersion` check), `signToken`.
- **`src/middleware/meter.js`** (2b) — `checkCap` (402 over monthly cap) + `recordLlm`. Limits in
  **`src/plans.js`** (Free = 40 AI responses + 30 voice min/mo; Pro = fair-use).
- JWT is stored on the desktop via Electron **safeStorage** (never localStorage); web uses `localStorage`.

---

## 6. Current status & roadmap

- **Phase 1 — Auth** ✅ (Welcome/Login/Signup/Onboarding, JWT, file/Mongo store).
- **Phase 2a — Managed-AI UX** ✅ (Managed default + BYOK Advanced, dynamic model picker, System
  Status, invisible failover, friendly errors, dashboard).
- **Phase 2b — Hosted managed proxy** 🔨 *in progress*:
  - B1 shared route registrar ✅ · B2 auth-gate ✅ · B3 metering ✅ (all testable locally).
  - **B5 client routing** (managed → hosted proxy w/ JWT) and **B6 deploy** (Render/Fly + Mongo +
    MockMate's own keys) — **TODO**. See `docs/PHASE2B_SCOPE.md`.
  - ⚠️ **Until B6, "Managed AI" uses the machine's local keys** — a keyless user can't run managed yet.
- **Phase 2c — Stripe billing** ⏳ (Free cap → "Upgrade or BYOK"; enforce/upgrade).
- **Product (1.4.5–1.4.6)** ✅ compact Live HUD; Live state/generation/capture modules; Career PDF +
  copy-only referral; Jobs→interview JD seed; text/vision health split; Deepgram local fallback policy.
  Next Career outreach phases: `docs/ROADMAP.md` § P6 (reminders → user-confirmed send — **not** silent agents).
- Docs: `docs/DEPLOY_BACKEND.md`, `docs/PHASE2B_SCOPE.md`, `docs/MM_PROMPT.md` (UI spec),
  `docs/ROADMAP.md`, `CHANGELOG.md`.

---

## 7. Gotchas / hard-won lessons (read before editing)

- **Build passing ≠ working.** Vite/esbuild don't catch undefined refs — a missing import throws only
  at runtime. Run the app after renderer changes.
- **Main-process changes need a full restart** (`electron/main.cjs`, `preload.cjs`, `server.js`,
  `backend/`), not just Vite HMR.
- **Linux/Wayland:** no screen-capture (pipewire portal hangs → guarded off), no meeting auto-detect,
  content-protection can't hide the overlay. Dev with `electron:dev:nosandbox`.
- **Voice = Deepgram only** (browser `webkitSpeechRecognition` silently fails in Electron). Local
  managed may fall back to API-key WS if grant minting 403s; hosted never returns the raw key —
  see `docs/SECRET_ROTATION.md`.
- **Provider keys**: server + backend load userData `.env` / `.env.enc` in addition to project `.env`.
  Shipped builds may include **bundled** keys from CI secrets (BYOK overrides).
- **Free AI keys are unreliable** for long sessions (Gemini 400s on some models, Groq 6k TPM). A
  funded **OpenAI** key (`gpt-4o-mini`) is the reliable path. ChatGPT subscription ≠ API credit.
- **Domains stay separate:** Live Copilot, Screen Analyzer, Solo — share infra, not product semantics.
  Do not put screen-analysis CTAs back on Home.

---

## 8. "I want to…" quick map
- **Change a screen's look** → that screen in `src/` + tokens in `src/auth/tokens.js`.
- **Add/adjust an interview prompt** → `api/_lib/interview.js` / `playbooks.js`.
- **Provider/model/failover behavior** → `api/_lib/core.js`.
- **Live question/generation lifecycle** → `shared/interviewState.js`, `generationManager.js`, `questionCapture.js`.
- **Career / ATS / referral / PDF** → `api/_lib/career.js`, `src/Career.jsx`, `src/lib/resumePdf.js`.
- **Add an `/api/*` route** → `api/_lib/apiRoutes.js` (+ `api/<name>.js` for Vercel).
- **Auth / usage / plans** → `backend/src/` (`routes/`, `middleware/`, `store.js`, `plans.js`).
- **Window sizing / shortcuts / capture / update** → `electron/main.cjs` (+ `preload.cjs` bridge).
- **Roadmap / what ships next** → `docs/ROADMAP.md`, `CHANGELOG.md`.
