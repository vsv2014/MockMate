# Secret rotation (Phase 0)

## JWT_SECRET (auth backend)

**Desktop (Electron fork):** secret lives in `userData/.jwt-secret` (mode 0600), injected as `JWT_SECRET` into the backend child.

**Rotate (invalidates all sessions):**
1. Quit MockMate.
2. Delete `userData/.jwt-secret` (path varies by OS — see ONBOARDING / Electron `app.getPath('userData')`).
3. Relaunch — a new secret is generated. All existing JWTs fail verification → users must sign in again.

**Hosted backend:** set a new `JWT_SECRET` in the host env and redeploy. Optionally bump every user’s `tokenVersion` in the store so even tokens signed with a leaked-but-still-valid secret stop working after a password-reset style invalidation.

## Password-reset tokens
- Stored as SHA-256 hashes; 30-minute TTL; single-use.
- Successful reset bumps `tokenVersion` (revokes prior JWTs).
- Never log full reset URLs in production (see `backend/src/mailer.js`).

## Managed runtime keys

**Public releases never package provider keys.** Keep managed-provider credentials only on the
hosted backend. When Managed AI is deployed, GitHub Actions reads the non-secret repository
variable `MOCKMATE_API_BASE` and bakes only that HTTPS endpoint into installers. Without it,
the installer is BYOK-only.

| Secret | Required for |
|---|---|
| `DEEPGRAM_API_KEY` | Live + Solo voice (everyone who installs) |
| `GROQ_API_KEY` / `GEMINI_API_KEY` / `OPENAI_API_KEY` / … | At least one LLM for answers |

Rotate keys in the hosting provider; no new desktop release is required. Users cannot extract
keys from a correctly configured backend, but still treat them as **shared product keys**, set billing caps
in each provider console, and rotate if abused.

## Provider API keys (BYOK)
- Stored encrypted at rest in `userData/.env.enc` via Electron `safeStorage` (OS keychain) when available.
- Legacy plaintext `userData/.env` is migrated to `.env.enc` on first launch after upgrade, then deleted.
- Headless / no-keychain environments fall back to `userData/.env` mode `0600`.
- Rotate by replacing keys in Settings; old keys remain valid at the provider until revoked in that provider’s console.
- User BYOK is used only in private/BYOK mode and never uploaded to MockMate.

## Deepgram (local vs production)

- Prefer short-lived **grant tokens** (Owner-scoped key can mint `/v1/auth/grant`).
- **Local Electron (this laptop, including managed mode on :4000):** if grant minting returns
  401/403 (typical for Member / scoped keys), MockMate falls back to using the project API key
  on the websocket. That key already lives on the machine — voice must keep working for solo
  testing and fresh laptop installs without hunting Owner keys.
- **Remote production (`MOCKMATE_HOSTED=1`):** never return the raw project key to clients.
- Opt out of local fallback: `MOCKMATE_DEEPGRAM_KEY_FALLBACK=0`.
- Hosted Managed AI keeps `DEEPGRAM_API_KEY` and LLM keys only in the backend environment.
- Rotate hosted keys in the provider and deployment environment; no desktop rebuild is required.
