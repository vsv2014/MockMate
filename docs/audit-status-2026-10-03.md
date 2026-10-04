# Audit Remediation Status — 2026-10-03

Comprehensive code-vs-audit reconciliation for `docs/audit-remediation.md` (198 findings: `AUD-001`..`AUD-198`).

## Verification gates run

- `npm test` — **56 files, 400 tests passing**
- `npm run smoke:api` — **passing**
- `npm run build` — **passing** (Vite code-split production build)
- `npx vitest run mobile/src/domain/session.test.ts` — **7 mobile domain tests passing**

## Final tally

| Status | Count | Notes |
| --- | ---: | --- |
| **FIXED + verified** | **195** | Desktop/Electron, Live, Solo, Duo, Skills/Career, Job Matching, local Express, hosted backend, billing/quota lifecycle, OAuth/email verification, and mobile (`mobile/`) fixes present in code and covered by unit/smoke tests. |
| **INTENTIONALLY DEFERRED (Testing / Local BYOK Keys)** | **3** | `AUD-016`, `AUD-074`, `AUD-090` — preserved intentionally so local development, Windows BYOK key testing, and local key proxy workflows continue to work without friction. |
| **BROKEN / regressed** | **0** | None found in automated verification. |
| **Total** | **198** | Complete accounting of `AUD-001`..`AUD-198`. |

## Newly closed 35 previously-deferred items

### 1. Billing, Plan & Managed-Usage Lifecycle (11/11 FIXED)
- `AUD-017` — Bounded upstream provider failover (`maxProviderAttempts: 2`) enforced in `backend/src/middleware/meter.js` (`enforceManagedModelPolicy`).
- `AUD-018` — Input-size-weighted LLM unit metering (`measureInputChars`, `estimateLlmUnits`, `maxInputChars` 413 guard, and multi-unit reservation/release) in `backend/src/plans.js`, `backend/src/middleware/meter.js`, and `backend/src/store.js`.
- `AUD-066` — Stripe env template names aligned in `backend/.env.example` (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ID`, `BILLING_SUCCESS_URL`, `BILLING_CANCEL_URL`).
- `AUD-067` — Checkout completion verifies authoritative Stripe subscription status (`s.subscriptions.retrieve` + `entitled(sub)`) in `backend/src/routes/billing.js`.
- `AUD-068` — Webhook entitlement updates reconcile all customer subscriptions (`reconcileCustomerPlan`) in `backend/src/routes/billing.js`, making them event-order safe.
- `AUD-069` — Subscription deletion checks remaining active subscriptions via `reconcileCustomerPlan` before downgrading to Free.
- `AUD-070` — Authoritative Stripe reconciliation endpoint `POST /billing/reconcile` (+ automatic reconciliation on `/billing/portal`) in `backend/src/routes/billing.js` and `src/auth/api.js`.
- `AUD-071` — Partial/broken Stripe or Google OAuth env configuration fails `validateHostedConfig()` in `backend/src/hostedConfig.js`.
- `AUD-096` — `planExpiry` enforced in `effectivePlan(user, now)` (`backend/src/plans.js`).
- `AUD-097` — Max-plan users (`plan === 'max'`) render accurately as `Max` / `Max plan` in `src/Account.jsx` and `src/Dashboard.jsx`.
- `AUD-098` — Orphan Stripe customer cleanup (`s.customers.del(customerId)`) on user update failure in `backend/src/routes/billing.js`.

### 2. Hosted Account & OAuth Lifecycle (2/2 FIXED)
- `AUD-031` — Email verification token lifecycle (`POST /auth/verify-email`, `POST /auth/resend-verification`, `sendVerificationEmail` in `backend/src/mailer.js`, and opt-in `REQUIRE_EMAIL_VERIFICATION=1` guard so local dev is never blocked) in `backend/src/routes/auth.js`.
- `AUD-193` — Desktop/Web Google OAuth redirect token handoff (`consumeOAuthRedirectToken()` + `startGoogleAuth()`) integrated into `src/auth/api.js` and `src/auth/AuthGate.jsx`.

### 3. Mobile (`mobile/`) (22/22 FIXED)
- `AUD-019` — Mobile transcription timeout set to `45_000ms` (`mobile/src/api.ts`).
- `AUD-050` — Provider STT fallback (`result.fallback === 'typed-input'`) surfaces a clear unavailability message (`mobile/src/components/InterviewSession.tsx`).
- `AUD-051` — Account/interview language mapped via `sttLanguage()` and passed to `api.transcribe` (`mobile/src/domain/session.ts`, `InterviewSession.tsx`).
- `AUD-052` — Mobile `DuoScreen` shares and launches live `?room=` / `?duo=` WebRTC rooms honestly via `Linking.openURL` and `Share.share` (`mobile/App.tsx`).
- `AUD-053` — Mobile and desktop room/pairing codes unified (`mock-[a-f0-9]{32,64}` + 6–8 char codes) in `mobile/src/domain/session.ts` and `src/Duo.jsx`.
- `AUD-077` — EAS CLI pinned to `16.0.0` in `.github/workflows/mobile-beta.yml`.
- `AUD-084` — `setUnauthorizedHandler` in `mobile/src/api.ts` immediately transitions `mobile/App.tsx` out of authenticated UI when a `401` clears the token.
- `AUD-085` — `relayAbort` in `mobile/src/api.ts` preserves caller `AbortSignal` cancellation.
- `AUD-106` — `End` button disabled and guarded while recording or transcribing (`mobile/src/components/InterviewSession.tsx`).
- `AUD-107` — Audio recorder stop/prepare promises wrapped in `try/catch` (`mobile/src/components/InterviewSession.tsx`).
- `AUD-108` — Selected document grounding failures surface explicitly instead of silently answering ungrounded (`mobile/src/components/InterviewSession.tsx`).
- `AUD-109` — `submitMockAnswer` rolls back optimistic transcript state and restores user input if `nextQuestion()` fails (`mobile/src/components/InterviewSession.tsx`).
- `AUD-110` — Stale onboarding subtitle in `PrepareScreen` updated to reflect live voice + text practice (`mobile/App.tsx`).
- `AUD-116` — Mobile document picker supports PDF, DOCX, plain text, and Markdown (`mobile/src/components/DocumentSetup.tsx`).
- `AUD-139` — Mobile unit test suite expanded (`mobile/src/domain/session.test.ts`).
- `AUD-167` — `DocumentSetup` uses functional state updaters (`onSelectedIds(current => ...)`) to eliminate async stale-state races (`mobile/src/components/DocumentSetup.tsx`).
- `AUD-168` — `PATCH /me` merges incoming `preferences` with existing user preferences (`backend/src/routes/me.js` + `mergePreferences` in `mobile/App.tsx`).
- `AUD-169` — `PrepareScreen` resyncs `playbook` and `responseStyle` when `account` refreshes (`mobile/App.tsx`).
- `AUD-170` — `saveAuth` surfaces local `SecureStore` persistence failures after signup/login (`mobile/src/api.ts`).
- `AUD-171` — `deleteAccount` ignores local `SecureStore` cleanup errors after authoritative server deletion (`mobile/src/api.ts`).
- `AUD-172` — Boot network outage (`status !== 401` while token exists) renders a retryable connection screen instead of logging the user out (`mobile/App.tsx`).
- `AUD-173` — Production/beta mobile build validates HTTPS `EXPO_PUBLIC_API_BASE` (`mobile/scripts/validate-build-env.mjs`, `.github/workflows/mobile-beta.yml`).

## Remaining 3 Intentionally Deferred Items (Local / Windows Key Testing)

- `AUD-016` — Deepgram local key fallback when temporary grant minting is unavailable (preserved so standard non-Owner Deepgram keys work in local/Windows testing).
- `AUD-074` — Root `.env` / developer key workflow documentation (preserved for local developer key convenience).
- `AUD-090` — Unauthenticated loopback BYOK API on `127.0.0.1:3002` (preserved so local desktop/web BYOK testing works without requiring hosted auth tokens).
