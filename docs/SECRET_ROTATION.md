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

## Provider API keys (BYOK)
- Stored encrypted at rest in `userData/.env.enc` via Electron `safeStorage` (OS keychain) when available.
- Legacy plaintext `userData/.env` is migrated to `.env.enc` on first launch after upgrade, then deleted.
- Headless / no-keychain environments fall back to `userData/.env` mode `0600`.
- Rotate by replacing keys in Settings; old keys remain valid at the provider until revoked in that provider’s console.
- **Do not ship bundled vendor keys** in release artifacts.

## Deepgram
- App uses short-lived **grant tokens** only (raw key never returned to the renderer).
- Rotate the Owner-scoped key in Deepgram console + update Settings / host env.
