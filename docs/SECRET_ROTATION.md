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

## Bundled runtime keys (out-of-box Live/Solo for downloaders)

MockMate can ship provider keys **inside the installer** so end users can try Live without
opening Settings. That is intentional for a personal/distribution build.

**How (safe):** put keys in **GitHub Actions secrets**. CI writes a temporary `.env` at
package time; `.env` stays gitignored and is never committed.

| Secret | Required for |
|---|---|
| `DEEPGRAM_API_KEY` | Live + Solo voice (everyone who installs) |
| `GROQ_API_KEY` / `GEMINI_API_KEY` / `OPENAI_API_KEY` / … | At least one LLM for answers |

Rotate by updating the secret and cutting a new release. Anyone can still extract keys from
the installed `resources/app/.env` — treat them as **shared product keys**, set billing caps
in each provider console, and rotate if abused.

## Provider API keys (BYOK)
- Stored encrypted at rest in `userData/.env.enc` via Electron `safeStorage` (OS keychain) when available.
- Legacy plaintext `userData/.env` is migrated to `.env.enc` on first launch after upgrade, then deleted.
- Headless / no-keychain environments fall back to `userData/.env` mode `0600`.
- Rotate by replacing keys in Settings; old keys remain valid at the provider until revoked in that provider’s console.
- User BYOK **overrides** bundled keys for that install.

## Deepgram
- Prefer short-lived **grant tokens** (Owner-scoped key). Local desktop may fall back to the
  project key on the websocket when grant minting returns 403 (Member keys).
- Rotate the key in Deepgram console + update the `DEEPGRAM_API_KEY` GitHub secret + rebuild.
