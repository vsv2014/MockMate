# MockMate — Architecture

This document describes the current v1.5.2 architecture. Roadmap items live in `docs/ROADMAP.md`; release evidence lives in `docs/evidence/VALIDATION_STATUS.md`.

## 1. System shape

MockMate is desktop-first with a private-beta mobile client.

- **Desktop:** Electron + React/Vite, with Solo, Live overlay/teleprompter, Resume Studio, Jobs, Documents/RAG, Career and Duo surfaces.
- **Local backend:** `server.js` / `backend/src` for local development and BYOK-compatible flows.
- **Hosted backend:** Express/Mongo for accounts, sessions, documents, billing and managed transcription.
- **Vercel API:** serverless AI/API surface sharing logic from `api/_lib/*`.
- **Mobile:** Expo/React Native private beta using the hosted HTTPS API.

## 2. Desktop runtime

`electron/main.cjs` owns BrowserWindow lifecycle, overlay modes, global shortcuts, capture, content protection, updater behavior and local child-process startup.

Window modes include dashboard/app, overlay, camera-anchored teleprompter and pill. Overlay-specific shortcuts are registered only while overlay/teleprompter modes are active.

Windows/macOS use Electron content protection where supported. This is a partial protection mechanism, not a universal invisibility guarantee; meeting-app share preview must still be verified. Linux does not provide the same protected-overlay guarantee.

The current public v1.5.2 automated release artifact is Windows NSIS. macOS/Linux runtime and packaging code remain in the repository but are not claimed as automated v1.5.2 public artifacts.

## 3. Live interview pipeline

```text
system/mic audio
→ Deepgram STT
→ question stabilization/classification
→ selected-document hybrid RAG
→ managed/BYOK LLM route
→ hint layers / teleprompter delivery
→ privacy-safe metrics
```

Turn-1 system-audio handling, duplicate suppression, corrections, answer-now behavior and bounded generation are implemented in shared/live modules.

### STT quota model

Managed Live STT uses an **authenticated WebSocket gateway hosted by the Express backend**, never a browser-reusable Deepgram project key or an unbounded JWT grant. The authenticated /api/deepgram-token response issues a random, 30-second, single-use ticket. The client supplies it as the second WebSocket subprotocol on wss://<host>/api/stt-stream. The backend accepts only a fixed Deepgram host, validates model/PCM parameters, atomically reserves up to 300 seconds of a user's allowance, and enforces **both** 300 seconds wall time and 9.6 MiB of 16 kHz/16-bit mono PCM per connection. The upstream Deepgram socket is owned by the backend, so a client's expired provider credential cannot bypass the budget. Every reconnect requires a fresh ticket and capped reservation. Error 4008 indicates exhausted quota; 4009 is normal segment rollover/reconnect.

The gateway refunds unused reserved time using observed server-side PCM and connected duration. It is conservative rather than claiming exact Deepgram provider invoice reconciliation. Backend process crashes may leave an outstanding reservation; before fully launching managed billing, add durable lease-recovery accounting and validate against provider usage reports. Multi-instance deployments must provide sticky routing or a shared one-time ticket registry: the in-memory ticket registry is process-local. The deployment must support WebSocket upgrades and reverse-proxy wss:// with correct Origin forwarding. Deploy the managed backend and renderer **together** for this protocol change; earlier renderer versions expect direct grants.

The local BYOK path still connects directly to Deepgram using the user's local credentials and consumes no MockMate-managed STT allowance.

Managed upload transcription parses supported audio duration server-side, reserves quota before Deepgram processing, then settles/reconciles the reservation against provider duration. Client-supplied duration is not trusted for billing.

## 4. Documents / RAG

Selected résumé/JD/notes are parsed, chunked and embedded. Persistent vectors in `mm-docs-index-v1` are tied to document signature, vector dimensions and exact `provider:model` embedding identity.

Delete/replace invalidates in-flight generations so stale async embedding work cannot resurrect removed document content. Local persistence is account-scoped and bounded by a byte budget.

## 5. API topology

Two execution shapes share common logic:

- **Express:** auth, `/me`, sessions, documents, uploads/transcribe, billing, metering and `/api/*` mounted behind middleware.
- **Vercel:** top-level `api/*.js` Serverless Functions backed by `api/_lib/*`.

For the Hobby plan, the deployed Vercel surface is intentionally kept at **12 Serverless Functions**. Four career endpoints (`/api/ats-score`, `/api/referral`, `/api/resume-latex`, `/api/tailor-resume`) are rewritten to one consolidated `api/career.js` function while preserving their external URLs.

`vercel.json` also rewrites `/api/models` through the providers route. Adding new top-level `api/*.js` files must include a function-count review.

## 6. Authentication and hosted accounts

Hosted auth supports signup/login/logout, account deletion and optional email verification.

Signup has two valid outcomes:

- immediate `{ token, user }` when verification is disabled;
- a verification-required response when `REQUIRE_EMAIL_VERIFICATION=1`, followed by verification/login.

Hosted verification configuration fails closed if required mail settings are incomplete.

Desktop tokens are persisted through the Electron auth bridge; mobile tokens use OS-protected secure storage.

## 7. Billing / metering

The backend is authoritative for plan limits. LLM-cost routes are guarded before provider spend. Managed model policy, request-size weighting, atomic reservations and release/reconciliation live in `backend/src/middleware/meter.js`, `backend/src/plans.js` and store implementations.

Mongo and file stores both clamp usage releases at zero. Stripe checkout/webhook/portal/reconcile code exists, while production Stripe configuration remains a deployment-validation item.

## 8. ARCH runtime intelligence

ARCH is a declarative policy/runtime layer built around `arch/mockmate.abl.json`.

Implemented today:

- validated ABL capabilities and lane routing;
- operation-scoped latency metrics;
- adaptive `balanced → fast` lane promotion for the affected operation only;
- transcription fallback execution with retries/timeouts/circuit behavior;
- bounded performance snapshots.

Not all LLM/vision/embedding execution goes through the same ARCH fallback executor yet. Performance state remains process-local and is not a hosted cross-instance learning system.

## 9. Product Intelligence

Product Intelligence is **local/runtime adaptive telemetry**, not hosted closed-loop analytics.

Renderer interactions are reduced to structural, redacted events in an account-scoped bounded local store. Resumes, transcripts, prompts, answers, screenshots, audio, API keys and passwords are excluded by contract/sanitization.

The backend PI store is currently dormant with no production bridge. Any future hosted PI path requires an explicit opt-in/privacy design.

## 10. Mobile architecture

The Expo/React Native client currently supports:

- hosted auth and secure token persistence;
- Prepare / History / Duo / Account;
- selected hosted text documents;
- text mock / Answer Assist sessions;
- microphone recording with explicit consent/state;
- authenticated `/transcribe` upload flow;
- synced session/history/account usage contracts.

Still private-beta gated: PDF/DOCX mobile extraction, real Duo pairing/remote controls, physical-device certification, store privacy/distribution and same-device meeting capture guarantees.

## 11. Security boundaries

- Platform/provider secrets remain server-side for Managed AI.
- BYOK credentials remain device-local where selected.
- RAG persistence is account-scoped.
- Product Intelligence and diagnostics prohibit content-like/private fields.
- Hosted API configuration fails closed on invalid public URLs/security prerequisites.
- Vercel public API remains default-deny unless explicitly enabled.

## 12. Release/validation boundaries

Code review and green CI do not equal a field-proven release. v1.5.2 still requires the packaged Windows smoke/share-preview/updater evidence recorded in `docs/RELEASE_CHECKLIST.md` and `docs/evidence/VALIDATION_STATUS.md` before the release is called fully validated.

Current automated verification baseline: **66 suites / 478 tests**, API smoke and production build green on the reviewed branch.
