# B6 — Deploy the Managed-AI backend

Goal: host MockMate so shared accounts live in MongoDB and keyless users can use Managed AI while BYOK remains available on desktop.

## Pre-flight

Run the current verification baseline before deployment:

```bash
npm ci
npm test          # v1.5.2 baseline: 66 suites / 478 tests
npm run smoke:api
npm run build
```

Do not use old fixed test counts from earlier releases as a deployment gate.

## MongoDB

Create a MongoDB Atlas cluster, database user, and connection string. Configure `MONGO_URI` only on the host; never package it in the desktop app.

## Provider and mail configuration

Hosted Managed AI needs the provider credentials you intend to fund plus `DEEPGRAM_API_KEY` for managed voice.

If email verification is enabled, configure the verification-mail prerequisites required by `validateHostedConfig()` (`RESEND_API_KEY` and HTTPS `VERIFY_URL_BASE`, plus sender configuration). Password-reset mail settings are separate.

## Deploy Express backend

Deploy the **whole repository**, because `backend/server.js` imports `../api/_lib/*`.

```text
Root Directory: <blank>
Build Command:  npm install
Start Command:  node backend/server.js
```

Required public-host basics include `MONGO_URI`, a stable `JWT_SECRET`, `HOST=0.0.0.0`, explicit CORS, and the managed provider keys.

## Vercel web/API deployment

The Vercel Hobby deployment is intentionally kept at **12 Serverless Functions**. PR #46 consolidated four career/resume wrappers into `api/career.js`; `vercel.json` rewrites preserve their original public URLs. If new top-level `api/*.js` files are added, re-check the Hobby function limit before merging.

## Verify authentication

```bash
API=https://your-api.example.com
curl -s "$API/health"
curl -s -o /dev/null -w "%{http_code}\n" -X POST "$API/api/interview" -d '{}'
# Expected unauthenticated AI call: 401
```

Signup may either return a token immediately or return `verificationRequired: true` when hosted email verification is enabled. Complete verification/login before testing authenticated routes in that configuration.

## Verify managed usage

After authentication:

- Managed LLM calls should work without local provider keys.
- Streaming Deepgram grants reserve STT quota atomically before minting.
- Uploaded mobile transcription reserves server-probed duration before provider spend and settles/reconciles afterward.
- Quota exhaustion returns the explicit 402 path.
- BYOK remains local/private where selected.

## Point desktop/mobile clients at production

Desktop release builds use `MOCKMATE_API_BASE` (validated HTTPS; exposed to the renderer as `VITE_API_BASE`). Mobile beta/production uses HTTPS `EXPO_PUBLIC_API_BASE`.

## Production evidence gate

Before public hosted claims, record:

- one clean hosted deployment,
- signup/login including verification when enabled,
- Managed AI and STT quota behavior,
- billing checkout/webhook/reconcile if billing is enabled,
- packaged desktop connectivity/CORS,
- and the release checklist evidence in `docs/evidence/VALIDATION_STATUS.md`.
