# Phase 2b — Hosted Managed-AI Proxy + Metering (scope)

## Goal (one line)
In **managed mode**, the desktop calls a **hosted MockMate service that holds MockMate's own
provider keys**, authenticates the user, meters usage, and enforces the plan cap — so a real
customer signs in and it "just works" with zero keys. **BYOK stays 100% local** (private).

## Architecture: before → after
```
NOW (managed = your local keys):
  Desktop ──/api──► local server.js (:3002, keys from your .env) ──► OpenAI/Claude/...

2b (managed = MockMate's keys, authed + metered):
  Desktop ─(JWT)─/api──► HOSTED MockMate proxy ─(auth+meter)─► core.js router ──► OpenAI/Claude/...
  Desktop (BYOK) ──/api──► local server.js (your keys, no metering, private)   ← unchanged
```

## What we REUSE (most of it already exists)
- **The whole LLM engine** — `api/_lib/core.js` (router, failover, `completeJSON`/`streamText`,
  `listModels`) + the `/api/*` routes in `server.js`. No rewrite.
- **Auth** — `backend/` (JWT, `requireAuth`, Mongo opt-in, `/auth/*`, `/me`).
- **Usage model** — `/auth/me` already returns `{ user, plan, usage }`; Account already renders
  usage bars (`llmCalls`, `sttSeconds`). 2b just makes them REAL (increment + enforce).
- **Deploy guide** — `docs/DEPLOY_BACKEND.md` (Render + Mongo).
- **Client managed/BYOK switch** — `src/lib/aiMode.js` already exists.

## What we BUILD (the deltas)
- **B1 — One hosted service.** Mount the `/api/*` LLM routes inside `backend/` (shared JWT +
  Mongo), so the hosted service serves both `/auth/*` and `/api/*`. (Alt: deploy `server.js`
  separately sharing `JWT_SECRET` + Mongo — less refactor, two services.)
- **B2 — Auth-gate `/api/*` in managed.** Managed calls carry the user's JWT; the proxy verifies
  it (`requireAuth`) before doing any LLM work. Local/BYOK path stays unauthed (local only).
- **B3 — Metering + caps.** Per user in Mongo: `usage.llmCalls`, `usage.sttSeconds`, `usagePeriod`
  (YYYY-MM, auto-reset monthly). Each managed completion increments; over the plan cap → **402
  "limit reached → Upgrade or use your own key."** (BYOK is the pressure valve.)
- **B4 — MockMate's keys** in the hosted env (OpenAI/Anthropic/Gemini/Groq/Deepgram). MockMate
  pays these bills.
- **B5 — Client routing.** Managed → hosted `MOCKMATE_API_BASE` (+ JWT on `/api/*` + Deepgram
  token); BYOK → local `server.js`. Handle the 402 with the friendly upgrade/BYOK prompt.
- **B6 — Deploy** (Render/Fly + Mongo Atlas), set MockMate keys + `JWT_SECRET`, point desktop at it.

## Key decisions (gating)
1. **Hosting** — Render (guide ready; free tier sleeps ~15min idle → cold start), or Fly/Railway
   (always-on, better for SSE streaming), or Vercel (serverless; streaming has timeout caveats).
2. **Free-tier meter + cap** — meter by **AI responses + voice minutes** (matches the Account UI).
   Cap value, e.g. Free = **40 AI responses + 30 voice min / month**, then Upgrade-or-BYOK.
3. (impl) Merge into `backend/` (recommended) vs separate service sharing the secret.

## Honest constraints
- **You pay for managed usage.** gpt-4o-mini ≈ $0.10–0.40/interview → the FREE cap must be tight
  or it bleeds money. "Pro unlimited*" needs a fair-use ceiling (silent, high).
- **Privacy split (a feature):** managed = interview data hits MockMate's server (like LockedIn);
  BYOK = stays local. Document it; sell BYOK to privacy-conscious users.
- **Abuse:** free managed invites freeloaders → keep the cap low + require login (already do).
- **2c (Stripe)** adds the actual "Upgrade" payment; 2b enforces the cap and offers BYOK now.

## Sequencing
B1 → B2 → B3 (locally, against the local backend + Mongo, faking "MockMate keys" = your keys) →
verify metering/caps end-to-end → B5 client routing → B4/B6 deploy with real keys. Ships testable
before any hosting spend.
