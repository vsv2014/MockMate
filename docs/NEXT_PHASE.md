# Next Phase — Managed Backend

> **Status updated for v1.5.2:** authentication, the managed AI proxy, atomic LLM/STT metering, Stripe code paths, hosted email verification, and server-held provider-key support are implemented. The remaining work is primarily **production deployment/configuration, cross-device evidence, recovery, privacy controls, and exact usage reconciliation** — not another backend rewrite.

## What is already implemented

- Hosted signup/login/JWT and Account UI.
- Email-verification branch with explicit no-token state until verification completes.
- Managed `/api/*` proxy with plan/model enforcement and atomic LLM reservation.
- Streaming STT lease reservation before Deepgram grant minting.
- Uploaded transcription with server-probed duration and reserve-before-spend accounting.
- Stripe checkout, signed webhook, portal, reconciliation and plan-expiry logic.
- Mongo-backed hosted users/usage/sessions/documents.
- BYOK remains a first-class local/private option.
- Vercel Hobby serverless shape reduced to **12 functions** while preserving career/resume URLs.

## What remains before calling the managed service production-proven

1. **Hosted deployment verification**
   - one clean production/staging deployment on the final public head;
   - production CORS, stable `JWT_SECRET`, Mongo, provider keys and Deepgram credentials;
   - no public provider-key proxy exposure.

2. **Billing validation**
   - Stripe test-mode checkout → webhook → entitlement → portal → cancellation/downgrade;
   - webhook replay/out-of-order-event evidence;
   - production price/webhook URLs and failure handling.

3. **Account recovery and OAuth**
   - production password recovery mail delivery;
   - optional Google account linking/duplicate-email behavior;
   - expiry/replay tests for verification/recovery links.

4. **Exact voice reconciliation**
   - current streaming grants use conservative ≤5-minute atomic leases;
   - reconcile exact streamed seconds per account/session without charging reconnect gaps.

5. **Opt-in encrypted sync**
   - resume/profile/history stay local-first by default;
   - any cloud sync must be explicit, encrypted, tenant-scoped, exportable and deletable.

6. **Privacy-controlled diagnostics**
   - centralized support telemetry must remain opt-in and content-free;
   - define retention/deletion and tenant isolation before enabling hosted analytics.

## Deployment shape

### Desktop/local
Electron can use local BYOK providers and a local auth/backend fork for development/private workflows.

### Hosted managed backend
Use the Express backend for authenticated accounts, sessions, documents, billing and managed transcription. The serverless `api/` layer remains useful for selected Vercel endpoints, but public Vercel AI access is default-deny unless explicitly enabled.

### Vercel Hobby constraint
v1.5.2 consolidates four career/resume wrappers into one `api/career.js` function, preserving:

- `/api/ats-score`
- `/api/referral`
- `/api/resume-latex`
- `/api/tailor-resume`

This keeps the deployment at Hobby's **12 Serverless Function** limit without requiring Pro.

## Data placement policy

| Data | Default location | Future hosted behavior |
|---|---|---|
| Resume/profile | Local | Optional encrypted sync only |
| Interview transcripts/reports | Local | Optional encrypted sync only |
| Provider choice/UI preferences | Local/device | Keep local unless cross-device value is clear |
| Plan/subscription/usage | Server | Authoritative server state |
| Platform provider keys | Server only | Never sent to clients |
| BYOK keys | Device local | Do not silently upload |

## Definition of production-proven

A clean install can sign up (including verification when enabled), use managed Live/Solo without local provider keys, hit LLM/STT limits gracefully, complete Stripe upgrade/downgrade, recover from auth/network/provider failures, and export/delete any opted-in cloud data with no platform secret exposed to the client.

For product sequencing, see `ROADMAP.md`. For current implementation, see `ARCHITECTURE.md`. For release gates, see `RELEASE_CHECKLIST.md`.
