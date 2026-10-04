# PR #45 / v1.5.2 Blast-Radius Review — Final State

## Scope

The full v1.5.2 branch was reviewed against `main` across Electron, React, shared runtime modules, Vercel/serverless API, Express backend, auth, billing/metering, RAG/storage, mobile, CI/release and documentation. The review covered **131+ changed files** and was followed by the Vercel Hobby deployment-shape hotfix in PR #46.

## Final blocker register

| ID | Finding | Final state |
|---|---|---|
| BR-1 | Metering route/source-of-truth mismatch | ✅ Fixed |
| BR-2 | Release-note capability drift | ✅ Fixed |
| BR-3 | Global Electron navigation blocked OAuth/job links | ✅ Fixed |
| BR-4 | RAG deletion/account-lifecycle persistence gap | ✅ Fixed |
| BR-5 | Turn-1 system boost too broad | ✅ Fixed |
| BR-6 | Auth token persistence `{ok:false}` treated as success | ✅ Fixed |
| BR-7 | Mobile changes not PR-gated | ✅ Fixed |
| BR-8 | No Windows runtime/unit coverage in PR CI | ✅ Windows CI added; packaged smoke remains release evidence |
| BR-9 | RAG cache lacked byte-budget/write-failure visibility | ✅ Fixed |
| BR-10 | Stale installer-secret guidance | ✅ Fixed |
| BR-11 | Stale in-flight RAG indexing could resurrect deleted text | ✅ Fixed |
| BR-12 | Email-verification signup contract mismatch | ✅ Fixed |
| BR-13 | Managed STT limits not safely enforced | ✅ Fixed for streaming grants and upload transcription with atomic reserve-before-spend |
| BR-14 | PiP capture-protection confirmation could target wrong window | ✅ Fixed |
| BR-15 | Release workflow still hardcoded to v1.5.1 | ✅ Fixed; workflow now version-generic |
| BR-16 | Vercel Hobby exceeded 12 Serverless Functions | ✅ Fixed in PR #46: 15 → 12 functions via consolidated career endpoint + rewrites |

## High-radius boundary summary

### Auth
- Desktop/mobile handle verification-required signup as an explicit no-token state.
- Hosted verification fails closed if mail prerequisites are missing.
- Local token persistence failures surface to the user.

### Billing and metering
- Managed LLM provider spend is reserved atomically before execution.
- Streaming STT reserves a conservative ≤300s lease before Deepgram grant minting and releases failed mints.
- Upload transcription server-probes MP4/M4A/WAV duration and reserves before Deepgram spend; failure/abort releases and success reconciles usage.
- Mongo release paths clamp usage at zero.

### RAG/privacy
- Persistent document cache is account-scoped, byte-budgeted, and embedding-provider/model-bound.
- Remove/replace/account-delete invalidate persisted data.
- Generation counters + AbortController + post-embed signature validation prevent stale async resurrection.

### Electron / Live
- Overlay accelerators register only while overlay/teleprompter mode owns them.
- Navigation uses one validated HTTPS policy for OAuth/job destinations.
- PiP/content protection reports the actually protected window.
- Turn-1 system-audio behavior is opener-scoped and regression-tested.

### API / deployment
- Express and serverless paths share the audited API logic where intended.
- Public Vercel AI routes remain default-deny unless explicitly enabled.
- Four career/resume URLs are preserved through Vercel rewrites into one consolidated function, keeping Hobby deployment at 12 functions.

### Release
- `package.json` is 1.5.2.
- Release workflow accepts version tags generically and validates tag ↔ package version + main ancestry.
- Automated release target for v1.5.2 is Windows NSIS.

## Verification baseline

- 66 test suites / 478 tests passing, exit 0, zero unhandled errors.
- `npm run build` clean.
- `npm run smoke:api` clean.
- Ubuntu + Windows desktop CI green on the reviewed branch.
- Mobile secret-free verification is PR-gated.

## Watchlist / non-merge blockers

1. `freePort()` may kill any listener on MockMate's ports without verifying process identity. This predates PR #45 and should be hardened separately.
2. Streaming STT accounting is intentionally conservative in ≤5-minute grant increments until exact per-second reconciliation lands.
3. Product Intelligence is local/runtime only; do not describe it as hosted closed-loop analytics.
4. Mobile is private beta and still needs physical-device/store validation.
5. Windows installer signing/notarization/trust improvements remain operational work.

## Release gates still requiring real-world evidence

Code review and CI do **not** mark these PASS:

- packaged Windows clean install and launch;
- `Alt+T → drag → Alt+T` teleprompter transition;
- mic/system first-question behavior;
- `F7` repeat/display-memory behavior;
- real Zoom/Meet/Teams share-preview confirmation;
- one clean hosted deployment on the final public head;
- v1.5.1 → v1.5.2 auto-update path;
- diagnostics export/redaction click-through;
- long-duration soak.

## Final code-review conclusion

**BR-1 through BR-16 are closed in code.** Remaining risk is release validation/operations, not an open cross-subsystem architecture blocker. Public release should follow `docs/RELEASE_CHECKLIST.md` and record results in `docs/evidence/VALIDATION_STATUS.md` before tagging v1.5.2.
