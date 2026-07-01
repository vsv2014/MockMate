# B6 — Deploy the Managed-AI backend (runbook)

Goal: host `backend/` so **accounts + usage live in MongoDB** and **keyless users get Managed AI**
(MockMate's own provider keys, metered per user). BYOK stays 100% local on each desktop.

> **Prereqs already done in code:** backend honors `HOST` (binds `0.0.0.0` when set); `mongoose`
> is in `package.json`; `/api/*` is mounted authed + metered (B2/B3); the desktop routes managed
> calls to `MOCKMATE_API_BASE` (B5) and skips the local fork when it's set.

---

## 0. Pre-flight (local, 5 min)
- Ensure secrets are NOT committed: `.env`, `~/.config/mockmate/*` are gitignored. Never commit keys.
- `npm install` locally once (pulls `mongoose`), then `npx vitest run` (46 pass) + `npm run build`.

## 1. MongoDB Atlas (free)
1. cloud.mongodb.com → create a **free M0** cluster.
2. **Database Access** → add a user (username + password).
3. **Network Access** → allow `0.0.0.0/0` (host egress IPs aren't fixed).
4. **Connect → Drivers** → copy the URI:
   `mongodb+srv://USER:PASS@cluster.xxx.mongodb.net/mockmate?retryWrites=true&w=majority`

## 2. MockMate's provider keys (what you'll fund)
- **OpenAI** (required, funded — platform.openai.com → Billing → add credit). `gpt-4o-mini` is the workhorse (~$0.10–0.40/interview).
- Optional 2nd/3rd for failover: **Anthropic**, **Gemini**, **Groq**.
- **Deepgram** (voice) — required for managed live transcription.
- Optional: **Resend** (`RESEND_API_KEY`) for password-reset emails.

## 3. Deploy the backend (Render — primary)
> **Deploy the WHOLE repo, not `backend/` as the root** — `backend/server.js` imports `../api/_lib/*`.

Render → **New → Web Service** → connect the GitHub repo:
- **Root Directory:** *(leave blank = repo root)*
- **Build Command:** `npm install`
- **Start Command:** `node backend/server.js`
- **Instance:** Free (sleeps ~15 min idle → cold start) or Starter (always-on).

**Environment variables:**
| Key | Value |
|---|---|
| `MONGO_URI` | *(Atlas URI from step 1)* — switches the store file → **mongo** |
| `JWT_SECRET` | a long random string — **must stay stable** (rotating logs everyone out) |
| `HOST` | `0.0.0.0` — **required** so Render can route to it |
| `OPENAI_API_KEY` | *(funded)* |
| `ANTHROPIC_API_KEY` / `GEMINI_API_KEY` / `GROQ_API_KEY` | optional failover |
| `DEEPGRAM_API_KEY` | managed voice |
| `RESEND_API_KEY` / `RESET_FROM` / `RESET_URL_BASE` | optional (reset emails) |

Render sets `PORT` automatically — `backend/server.js` reads it. Deploy → you get
`https://mockmate-api.onrender.com`.

> **Fly.io alternative (always-on, better for SSE streaming):** `fly launch` (no deploy), set the
> same secrets via `fly secrets set …`, `internal_port` = the app's `PORT`, `fly deploy`.

## 4. Verify the hosted backend (curl)
```bash
API=https://mockmate-api.onrender.com
curl -s $API/health                                   # -> {"ok":true}
curl -s $API/api/providers | head -c 200              # -> lists MockMate's configured providers
curl -s -o /dev/null -w "%{http_code}\n" -X POST $API/api/interview -d '{}'   # -> 401 (auth required) ✅
# End-to-end: signup → token → authed call
TOK=$(curl -s -X POST $API/auth/signup -H 'content-type: application/json' \
  -d '{"name":"T","email":"t'$RANDOM'@e.com","password":"secret12"}' | grep -o '"token":"[^"]*"' | cut -d'"' -f4)
curl -s -X POST $API/api/interview -H "authorization: Bearer $TOK" -H 'content-type: application/json' \
  -d '{"config":{},"transcript":[]}' | head -c 300     # -> a real interviewer turn (managed, metered) ✅
```

## 5. Point the desktop at it
The desktop reads `MOCKMATE_API_BASE` (main process → auth + managed `/api`) and, for the renderer,
`VITE_API_BASE` (baked at build). Set BOTH to your hosted URL.

- **Test from dev** (no rebuild): `MOCKMATE_API_BASE=$API npm run electron:dev:nosandbox`
  → auth + managed calls go to the hosted backend; the local backend fork is skipped.
- **For a release build**, bake the URL:
  1. In `electron/main.cjs`, set the default: `const API_BASE = process.env.MOCKMATE_API_BASE || 'https://mockmate-api.onrender.com'`
  2. Build the renderer with it: `VITE_API_BASE=$API npm run build`
  3. `npm run electron:build` (`:win` for Windows) → ship.

## 6. Confirm the SaaS is live
- Sign up in the app → the user appears in **Atlas** (`mockmate.users`).
- Run an interview on **Managed AI** with NO local key → it works (MockMate's keys). ✅
- Usage increments in `mockmate.usages`; after 40 responses / 30 voice-min on Free → **402
  "Upgrade or use your own key."**
- BYOK still routes local + private (unchanged).

## Guardrails
- **`MONGO_URI` lives ONLY on the host** — never in the shipped desktop (it'd leak DB creds).
- **Fund OpenAI** and watch spend — managed usage is on you; the Free cap + fair-use limit protect you (`backend/src/plans.js`).
- **`JWT_SECRET` is mandatory on a public bind** — with `HOST` set to anything non-loopback, the
  backend now **refuses to start** without it (no more silent insecure default). Keep it **identical**
  across redeploys, or all sessions invalidate.
- Render free tier sleeps → first request after idle is slow; upgrade for production.
- Next: **2c (Stripe)** turns the 402 into a real "Upgrade to Pro" purchase.
