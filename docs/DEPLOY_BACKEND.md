# Deploying the MockMate hosted backend

This guide describes the current v1.5.2 deployment shape. Local desktop development can still fork `backend/server.js` with the file store. Hosted/shared accounts require MongoDB and a stable HTTPS backend.

## Deployment shapes

- **Express hosted backend (Render/Fly/Railway/etc.)** — deploy the **whole repository**, because `backend/server.js` imports shared logic from `api/_lib/*`. Start with `node backend/server.js`.
- **Vercel serverless surface** — the web/API deployment uses 12 top-level Serverless Functions on Hobby after PR #46. Four career endpoints (`/api/ats-score`, `/api/referral`, `/api/resume-latex`, `/api/tailor-resume`) are preserved through rewrites to the consolidated `api/career.js` function.
- **Desktop local mode** — leave `MOCKMATE_API_BASE` unset to use the local backend/BYOK path.

## Required hosted configuration

At minimum configure:

- `MONGO_URI` — durable MongoDB store
- `JWT_SECRET` — long, stable secret
- `HOST=0.0.0.0` for public Express hosts
- explicit `CORS_ORIGIN`
- provider credentials needed by Managed AI
- `DEEPGRAM_API_KEY` for managed STT

If `REQUIRE_EMAIL_VERIFICATION=1`, hosted startup also requires working verification-mail configuration including `RESEND_API_KEY` and an HTTPS `VERIFY_URL_BASE`. Password-reset mail configuration is separate.

## Render example

Use the repository root, not `backend/` as the Render root:

```text
Root Directory: <blank>
Build Command:  npm install
Start Command:  node backend/server.js
```

Render supplies `PORT`; the server reads it automatically.

## Point clients at the hosted service

For desktop release builds, set the repository variable `MOCKMATE_API_BASE` to the production HTTPS endpoint. Release CI validates the URL and exposes it to the renderer as `VITE_API_BASE`. An absent value intentionally produces a BYOK-only build.

Mobile uses `EXPO_PUBLIC_API_BASE` and requires HTTPS for beta/production builds.

## Verify

```bash
API=https://your-api.example.com
curl -s "$API/health"
curl -s -o /dev/null -w "%{http_code}\n" -X POST "$API/api/interview" -d '{}'
# Expected: 401 without auth.
```

Signup has two valid contracts:

- verification disabled: `{ token, user }`
- verification required: `{ verificationRequired: true, ... }`, followed by email verification and login

Do not write deployment tests that assume signup always returns a token.

## Release truth

Before calling the hosted service production-ready, verify one clean deployment, signup/login (including the email-verification branch if enabled), Managed AI, atomic STT quota enforcement, billing reconciliation, and CORS from the shipped desktop build.
