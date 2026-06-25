# Next Phase — Managed Backend (accounts · subscriptions · server-held keys)

> **Status:** DESIGN ONLY. Not built yet. This is the spec for the agent/dev who picks this up.
> **Why:** Today MockMate is **bring-your-own-key (BYO)** — each user pastes their own
> OpenAI/Claude/Deepgram keys. That's great for a personal/dev tool, but it's the wall that
> stops MockMate from competing with LockedIn AI / FinalRound: normal users won't create 3
> provider accounts and add billing. To sell it, MockMate must become **"sign up, pay, it just
> works"** — which means a managed backend that holds the keys and meters usage.

---

## Goal
Turn MockMate from BYO-key into a product:
1. **Login / accounts** (the user-requested login page).
2. **Subscription billing** (Stripe) — Free / Pro / etc.
3. **Server-held API keys** — *MockMate* holds high-tier Anthropic + Deepgram keys; users never see a key.
4. **Usage metering & plan limits** — track tokens/minutes per user, enforce plan caps, prevent abuse.

**Keep BYO-key as an option** (power users / privacy / "use my own key") — the two models coexist:
the app asks the server for an answer; the server uses the user's key if they provided one, else
the platform key (counting against their plan).

---

## Architecture (target)

```
Electron app (renderer)                 Managed backend (Node/Express + Mongo)         Providers
─────────────────────────              ─────────────────────────────────────         ─────────
  Login screen ───────────────────────▶  POST /auth/login → JWT                       
  ⚙ uses session JWT for every call ───▶  /api/* (auth-gated proxy):                   
  Live/Solo/Jobs call the SAME /api/*       1. verify JWT + plan + usage cap            
  endpoints — but now AUTHENTICATED         2. pick key: user's BYO  OR  platform key ─▶ OpenAI / Anthropic
  and proxied through the backend           3. stream answer back (SSE)                  Deepgram (grant token)
                                            4. record tokens/minutes in usage ledger    Stripe (webhooks)
```

Key shift: the LLM/STT calls move from **app→provider (direct)** to **app→backend→provider**, so the
backend can authenticate, choose the key, meter, and rate-limit. The existing `api/_lib/` engine
(core.js, interview.js, jobs.js — provider/retry/failover logic) is **reused as-is** behind the auth layer.

---

## Build on the existing `backend/` folder
There is already a half-built `backend/` (Express + Mongo + JWT, port 4000) — currently **unwired**.
Use it as the foundation rather than starting fresh:
- It has the auth/Mongo bootstrap. Wire it into the app's startup (npm script + electron fork, or deploy it as a hosted service).
- Fold the AI engine (`api/_lib/*`) into it (or have it call the same shared lib) so there's ONE backend, not two.
- **Decide hosting:** for a real product the backend should be a **hosted service** (Render/Fly/Railway/AWS), not bundled in the Electron app — the app talks to `https://api.mockmate.app/...`. (The local `server.js` stays for BYO/offline mode.)

---

## Data model (Mongo)
```
User      { _id, email, passwordHash, plan: 'free'|'pro', stripeCustomerId, createdAt }
Usage     { userId, period (YYYY-MM), llmTokensIn, llmTokensOut, sttSeconds, requests }  // metering ledger
Session   { userId, type, transcript, report, createdAt }   // optional: move history server-side
ApiKey    { userId, provider, encryptedKey }                // optional: user's own BYO key, encrypted at rest
```

## API surface (additions)
```
POST /auth/signup            { email, password }            → { token }
POST /auth/login             { email, password }            → { token }
GET  /auth/me                (JWT)                          → { user, plan, usageThisPeriod, limits }
POST /billing/checkout       (JWT)                          → Stripe Checkout URL
POST /billing/webhook        (Stripe sig)                   → updates user.plan
# Existing AI routes become auth-gated + metered (same request/response shape the app already uses):
POST /api/hint-stream  /api/interview  /api/evaluate  /api/jobs  /api/analyze-screen  /api/deepgram-token
```

## Plan limits (example)
| Plan | Price | Limit |
|---|---|---|
| Free | $0 | e.g. 30 min Live + 3 Solo / month, on a cheap model |
| Pro | $X/mo | generous monthly token/minute budget, best model |
| BYO | — | user supplies own key → unlimited, billed by their provider |

Enforce in middleware: before each `/api/*`, check `Usage[userId][period]` vs plan cap → 402 if exceeded.

---

## Security must-haves
- **Encrypt user BYO keys at rest** (`ApiKey.encryptedKey`, e.g. AES-GCM with a server secret).
- **Never send platform keys to the client.** The app only ever holds a JWT.
- JWT with sane expiry + refresh; bcrypt/argon2 password hashing.
- Stripe webhook signature verification.
- Rate-limit auth endpoints; CORS locked to the app origin.
- Deepgram: backend mints short-lived **grant tokens** per session (already implemented in `core.js deepgramToken`) — never ship the raw Deepgram key.

---

## Client (Electron) changes
- Add a **Login screen** (before the Home overlay). Store JWT in `userData` (secure storage).
- Send `Authorization: Bearer <jwt>` on every `/api/*` call (one place: a `postJSON`/`useApi` wrapper).
- Point API base URL at the hosted backend (env-configurable; falls back to local `server.js` for BYO/offline).
- Settings: "Use my own API key" toggle (BYO) vs "Use my MockMate plan" (managed).
- Show plan + usage in the header (the usage counter already exists — point it at `/auth/me`).

---

## Suggested phasing (so it ships incrementally)
1. **Auth**: signup/login/JWT on `backend/`, Login screen, gate the app. (No billing yet — everyone "free".)
2. **Proxy + metering**: move `/api/*` behind auth; record usage; platform keys server-side.
3. **Stripe**: checkout + webhook + plan gating + limits.
4. **Polish**: BYO toggle, usage dashboard, server-side history, team/referral, etc.

---

## Persistence strategy (local-first → opt-in server sync)

Today the app persists to **`localStorage`** (profile/resume, Solo+Live session history `mm-sessions`,
provider choice, pin/welcome flags). API keys are the exception — they live in `userData/.env`, never localStorage.

**This is a deliberate local-first choice, not a missing API — keep it that way.** Do **not** blindly
move everything into a server DB when accounts land. Decide per data type:

| Data | Sensitivity | Where it should live |
|---|---|---|
| Resume / profile | **High** (PII) | Local by default; sync to server **only if user opts in** |
| Session transcripts + reports | **High** (interview content) | Same — local by default, opt-in sync |
| Provider choice, pin, welcome flag | Low / device-specific | Stay local (`localStorage`) — no value syncing |
| Plan / subscription / usage ledger | — | **Server only** (tied to userId) |

Guidelines for the accounts phase:
1. **Local-first stays the default.** The resume/transcripts only leave the device if the user signs in **and** enables sync. Make this an explicit toggle, and state it in the UI — it's also a privacy selling point vs competitors.
2. When syncing, the server endpoints mirror the local store: `GET/PUT /me/profile`, `GET/POST/DELETE /me/sessions`. The client keeps writing locally and syncs in the background (last-write-wins is fine for a single user across devices).
3. **Encrypt sensitive synced data at rest** (resume/transcripts), same as BYO keys.
4. **Interim durability without a server (optional):** if local history outgrows `localStorage`'s ~5–10 MB cap or its 60-session/90-day limits *before* accounts ship, move the local store to a **`userData` JSON file or SQLite** (like `.env` already does) — durable, unlimited, still fully on-device. This is a clean upgrade that needs no backend.

Net: `localStorage` → (optional) `userData` file/SQLite for durability → (with accounts) **opt-in** encrypted server sync. Never force interview content to the server.

## What NOT to change
- The **AI engine** (`api/_lib/core.js` provider/retry/failover, `interview.js`, `jobs.js`) and the
  **shared** logic (`shared/delivery.js`) are solid — reuse them behind the auth layer, don't rewrite.
- BYO-key mode stays as a first-class option.

---

## Job-application automation (LinkedIn auto-apply, referrals) — read before building

This is a **separate product track from MockMate's accounts/auth**, and the common assumption
("once we add OAuth/login we can auto-apply") is **wrong**. Documenting it so nobody burns weeks
building the wrong thing.

### OAuth does NOT unlock auto-apply
- **"Sign in with LinkedIn" (OpenID Connect) public scopes = `openid profile email`** → name, photo,
  email. **Nothing else.**
- **Connections, messaging, and job-apply APIs are not publicly available.** They sit behind LinkedIn
  **Partner Programs** (Talent Solutions / Marketing Developer Platform) — gated, approval-only, B2B —
  and **even those do not expose auto-apply or connection scraping.**
- So building LinkedIn OAuth gets you a sign-in button, not the ability to apply on someone's behalf.

### How auto-apply actually works
- A **browser (Chrome/Edge) extension** runs **inside the user's own browser, where they're already
  logged into LinkedIn.** It automates the page **DOM** (fills "Easy Apply", clicks, reads the
  connections list) by **riding the user's existing session cookies** — **no OAuth, no API**.
- This is a **separate codebase** (MV3 extension: content scripts + background worker + its own store +
  Web Store review, ~3–4 weeks to publish). It is **not** part of the Electron app and shares no runtime
  with it. It *can* reuse MockMate's backend over HTTPS (resume tailoring, ATS scoring, referral-message
  drafting — see the LLM tools in `api/_lib/career.js`).

### Two unrelated "logins" — do not conflate
| "Login" | Purpose | Mechanism |
|---|---|---|
| **MockMate account** | Stripe billing, opt-in sync, server-side keys, usage metering | OAuth/email → `backend/` (the managed plan above) |
| **LinkedIn automation** | Auto-apply, find referrals, auto-DM | **Not OAuth** — extension acting in the user's logged-in browser |

### Risk / legality (state it to users)
- LinkedIn's User Agreement **§8.2 prohibits automation, bots, and scraping.** Accounts that auto-apply
  at scale get **restricted or banned.** (The *hiQ v. LinkedIn* ruling was about a company scraping
  **public** data — it does **not** authorize automating a logged-in member account.)
- This is **user risk + a permanent anti-bot arms race.** Treat it as a deliberate, separately-branded
  product, with clear in-product disclosure — not a bolt-on MockMate feature.

### What's already done in-app (no LinkedIn needed)
The high-synergy, ToS-safe pieces that leverage MockMate's resume + LLM **already ship** (v1.3.0),
in `api/_lib/career.js` + `src/Career.jsx`:
- **ATS resume score** (20+ checks), **per-role resume tailoring**, **referral-message drafter**, and a
  **saved-jobs dashboard** (`src/savedJobs.js`).

The extension's job is only the part that **requires** the user's live LinkedIn session: discovering
referral contacts and submitting applications. Everything else stays in the app.

---

## Definition of done
A new user can: install the app → **sign up** → **subscribe (Stripe)** → run Live/Solo/Jobs **without ever
seeing an API key** → hit plan limits gracefully. Power users can still flip to **BYO key**. The platform's
keys are high-tier and server-held, so "it just works and never asks for a key" — matching the competitors.

---

## "Room" — peer / human mock interviews (parked idea, deliberate)

MockMate **started** as a peer-mock-interview tool (the profile is still stored under the localStorage key
`peerMockProfile`, and `src/Room.jsx` is the leftover surface). The original idea: invite a friend into a
**room** and interview each other live — a human interviewer instead of the AI. It was set aside when the
product focused on the **AI interviewer (Solo)** + **AI live companion** + career tools. This documents the
idea so it's a roadmap decision, not lost code.

### Why it was parked (and why that's the right call for now)
- **It's a different architecture.** Two humans live in a room needs **WebRTC** (peer audio/video), a
  **signaling server**, **TURN/STUN** servers for NAT traversal, and **room/session state** — a whole
  always-on multiplayer backend. None of that exists today (the app is single-user: local server + LLM).
- **Cold-start / matchmaking.** A peer feature is only useful with a **pool of peers to match** — the hard
  problem Pramp / interviewing.io exist to solve. Hard for a small team to bootstrap.
- **Availability.** The AI is 24/7 and instant; a peer needs another person free at the same time.
- **Differentiation.** The AI angle (always-on, honest scoring, real-time help) is what beats LockedIn AI /
  FinalRound. Peer interviews compete in a separate, crowded, infra-heavy market.

### If we ever build it (what it would take)
1. **Real-time transport:** WebRTC for peer A/V, plus a **signaling service** (WebSocket) to exchange
   offers/answers/ICE candidates. Add a hosted **TURN** server (e.g. coturn / a managed provider) — without
   it, ~15-20% of users behind strict NATs can't connect.
2. **Room lifecycle:** create/join by code or link, presence, "who's interviewer vs candidate", leave/teardown.
   Lives on the same `backend/` service (accounts already there) — gate rooms behind login.
3. **Reuse what exists:** the AI can still ride along as a **co-pilot for the human interviewer** (suggested
   follow-ups, a scorecard) and run the **post-session review** (`makeReport`) on the recorded transcript —
   so it complements the AI product instead of replacing it.
4. **Matchmaking (only if going public):** a lobby/queue to pair strangers by role + level; otherwise keep it
   **invite-a-friend** only (no matchmaking needed, far simpler — a good MVP).

### Recommendation
Keep `src/Room.jsx` in the repo as a marker (it's harmless, unused dead code — nothing imports it). Revisit
**only** if users specifically ask for human peer practice. If we do, start with **invite-a-friend rooms**
(no matchmaking) on top of the accounts backend, with the AI as the interviewer's co-pilot + post-session
scorer — that's the version that reuses the most of what we already have.
