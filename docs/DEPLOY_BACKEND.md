# Deploying MockMate's hosted backend

This is the canonical deployment guide. Keep deployment details here rather than creating separate phase/runbook files.

## Deployment shape

MockMate supports two runtime shapes:

- **Desktop/local BYOK** — Electron can use the local backend and locally stored provider keys.
- **Hosted Managed AI** — the Express backend provides accounts, Mongo-backed state, billing, managed LLM/STT usage and shared APIs. Vercel hosts selected serverless/web endpoints.

Deploy the **whole repository** for the Express service because `backend/server.js` imports shared `api/_lib/*` modules.

```text
Root Directory: <blank>
Build Command:  npm install
Start Command:  node backend/server.js
```

## Required hosted configuration

At minimum, configure:

- `MONGO_URI`
- stable `JWT_SECRET`
- `HOST=0.0.0.0`
- explicit production `CORS_ORIGIN` (include `http://localhost:3002` and `http://127.0.0.1:3002` for installed Electron desktop clients, plus the web app HTTPS origin)
- the provider credentials used by Managed AI
- `DEEPGRAM_API_KEY` for managed voice

Never package Mongo credentials or platform provider keys in the desktop application.

### Email verification / recovery

If hosted email verification is enabled, `validateHostedConfig()` requires its mail-delivery prerequisites, including `RESEND_API_KEY` and an HTTPS `VERIFY_URL_BASE` plus sender configuration. Password-reset configuration is separate.

Signup has two valid contracts:

- verification disabled → `{ token, user }`
- verification enabled → `verificationRequired: true` with **no session token** until verification/login completes

## Vercel

The Hobby deployment is intentionally kept at **12 Serverless Functions**. Four career/resume URLs are consolidated behind `api/career.js` with `vercel.json` rewrites:

- `/api/ats-score`
- `/api/referral`
- `/api/resume-latex`
- `/api/tailor-resume`

Adding new top-level `api/*.js` files can push the deployment back over Hobby's limit; re-check the function count whenever the API surface changes.

Public Vercel AI access remains default-deny unless explicitly enabled.

## Managed usage and billing

The backend is authoritative for plan enforcement:

- LLM usage reserves quota before provider work.
- Hosted streaming STT never exposes a Direct Deepgram grant. The authenticated
  `/api/deepgram-token` endpoint now returns a **30-second single-use gateway
  ticket**, consumed over `wss://<host>/api/stt-stream` as a WebSocket
  subprotocol. The backend verifies the ticket, reserves up to 300 seconds,
  caps connection lifetime/16 kHz PCM bytes (including final partial-length
  grants when less than 300 seconds remain), forwards audio to Deepgram, and
  refunds unused time on socket cleanup. Each 300-second segment reconnects
  with a fresh ticket and a new capped reservation.
- Configure the ingress/proxy to pass **WebSocket upgrades** over TLS (WSS) to
  `backend/server.js` on the SAME process as the HTTP ticket issuer. This
  initial gateway uses a process-local ticket registry: horizontal replicas
  require sticky routing or a distributed one-use ticket registry. Otherwise
  issued tickets fail at handshake when load-balanced to a different instance.
- The previous renderer expected direct Deepgram grants. Upgrade the hosted
  Express backend and compatible desktop client together; do not switch just
  one side in the public environment.
- Allow the Electron origin (`http://localhost:3002`) explicitly in
  `CORS_ORIGIN` for the installed desktop renderer, and verify the browser
  WebSocket Origin is accepted. Never set a wildcard production origin.
- Server crash recovery and exact provider-reported usage reconciliation
  remain launch gates for managed billing; a bounded live connection does not
  itself settle an outstanding reservation after a process crash.
- Uploaded transcription server-probes duration and reserves before provider spend, then settles usage.
- Mongo release operations clamp counters at zero.
- Stripe checkout/webhook/portal/reconciliation code is available when Stripe is configured; the signed webhook and authoritative reconciliation path determine entitlement state.

For Stripe deployment, configure the values documented in `.env.example` / `backend/.env.example` and validate test-mode checkout → webhook → entitlement → portal → cancellation before enabling production billing.

## Verify a hosted deployment

Run the repository verification first:

```bash
npm ci
npm test
npm run smoke:api
npm run build
```

Then verify the host:

```bash
API=https://your-api.example.com
curl -s "$API/health"
curl -s -o /dev/null -w "%{http_code}\n" -X POST "$API/api/interview" -d '{}'
# unauthenticated managed call should return 401
```

Complete signup/login (and email verification when enabled), then verify:

- Authenticated `/api/deepgram-token` returns `gateway: true` and no
  `access_token` in hosted mode. A WebSocket with the ticket is accepted
  once; replay/expiry/foreign-origin requests are rejected.
- An actual 6+ minute Live call segments/reconnects without exceeding the
  reserved usage; test mic and system audio, network loss, Stop during
  provider startup, quota exhaustion, and the 4008/4009 behaviors.
- Simulate a gateway crash and reconcile previously reserved usage before
  claiming provider-billed settlement is exact.
- Managed AI works without local provider keys.
- LLM and STT limits return the expected 402 paths.
- Mobile `/transcribe` succeeds for supported recordings and respects quota.
- Stripe upgrade/downgrade/reconcile works when billing is enabled.
- Desktop and mobile clients can reach the hosted service through HTTPS.

## Client configuration

Desktop public builds use `MOCKMATE_API_BASE`; release CI validates it as a non-loopback HTTPS URL and exposes it to the renderer as `VITE_API_BASE`.

Mobile beta/production uses HTTPS `EXPO_PUBLIC_API_BASE`.

## Production evidence gate

Do not call the hosted service production-proven until there is evidence for:

- one clean deployment on the final public head;
- production CORS/JWT/Mongo/provider configuration;
- signup/login/verification/recovery flows;
- managed LLM/STT quota behavior;
- billing lifecycle when enabled;
- packaged desktop connectivity;
- and the release ledger in [`evidence/VALIDATION_STATUS.md`](evidence/VALIDATION_STATUS.md).
