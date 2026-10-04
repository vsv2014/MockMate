# Audit Remediation Status — v1.5.2 final sync

This file summarizes the automated/code-review state after PR #45 and the Vercel Hobby deployment hotfix (PR #46). It does **not** replace packaged release evidence.

## Current verification baseline

- `npm test` — **66 suites / 478 tests passing**, exit 0, zero unhandled errors.
- `npm run smoke:api` — passing.
- `npm run build` — passing.
- Desktop CI — Ubuntu + Windows green on the reviewed v1.5.2 branch.
- Mobile secret-free verification is PR-gated; production/store builds remain separately gated.

## High-impact remediation status

### Auth
- Hosted email-verification signup contract is explicit: verification-required responses contain no session token, and desktop/mobile do not persist one until verification succeeds.
- Hosted verification refuses to boot without required mail-delivery prerequisites.
- Desktop token-persistence failures are surfaced rather than interpreted as successful login.

### Billing / metering
- Managed LLM usage uses atomic reserve-before-spend accounting.
- Streaming STT grants atomically reserve a conservative lease before minting provider access and release it on mint failure.
- Managed upload transcription server-probes media duration and atomically reserves before Deepgram spend; failure/abort releases the lease and success reconciles actual usage.
- Mongo LLM/STT releases clamp at zero.

### RAG / privacy lifecycle
- Account-scoped local artifacts are purged on account deletion.
- Deleted/replaced documents invalidate in-flight indexing work so stale embed completions cannot resurrect private text.
- Persistent RAG cache is byte-budgeted and embedding-provider/model-bound.

### Electron / Live
- Overlay shortcuts are mode-scoped.
- Turn-1 system-audio boost is restricted to valid opener patterns and covered by negative controls.
- PiP/content-protection confirmation reports the actually protected window.
- External navigation uses one validated policy for OAuth/job URLs.

### CI / release
- Mobile verification is PR-gated.
- Windows tests run in CI.
- Release workflow is version-generic and enforces tag ↔ `package.json` consistency plus main ancestry.
- Vercel Hobby deployment was reduced from 15 to **12 Serverless Functions** without changing the four affected public career/resume URLs.

## Product-truth corrections

- ARCH is a policy plane plus partial execution plane; not every capability runs through one executor.
- Product Intelligence is **local/runtime adaptive telemetry**, not hosted closed-loop analytics.
- v1.5.2 automated public artifact scope is Windows NSIS; macOS/Linux are not claimed as automated public artifacts for this release.
- Mobile microphone recording/transcription is implemented in private beta, but store readiness is not claimed.

## Remaining release evidence

The following are **not** considered PASS from code review alone:

- packaged Windows clean-install and end-to-end smoke;
- Live mic/system first question;
- `Alt+T → drag → Alt+T` teleprompter behavior;
- `F7` repeat/display memory;
- Zoom/Meet/Teams share-preview confirmation;
- one clean hosted deployment on final public head;
- v1.5.1 → v1.5.2 updater path;
- diagnostics export/redaction click-through;
- long-duration soak.

See `docs/evidence/VALIDATION_STATUS.md` for the release-gate ledger and `docs/BLAST_RADIUS_REVIEW.md` for the branch review summary.
