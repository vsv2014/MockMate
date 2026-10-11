# MockMate v1.6.0 — Release Candidate Notes

**Status (2026-10-11): release candidate prepared on PR #85's branch; not merged, tagged, or published.** The latest published stable Windows release remains **v1.5.3**. The prior v1.5.5 candidate and v1.5.4 source hotfix were not stable releases. The candidate uses root `package.json` and `package-lock.json` version `1.6.0`.

This is a feature release: it adds the Home → Interview Kits → Ready Room preparation journey while carrying forward the unreleased v1.5.5 candidate work and the Live/provider reliability work in PR #85. Public distribution is still Windows x64 signed NSIS only. A green CI run is not a physical-device or hosted-provider certification.

## What’s new since the last published stable release

### Interview preparation workspace
- **Home** now brings active Interview Kits, recent sessions, and practice/readiness actions together.
- **Interview Kits** keep role/company, resume, job description, experience, interview type, language, voice style, and focus notes together. Kit storage is account-scoped on the local device; Kit edits do not overwrite the shared profile.
- **Ready Room** provides pre-flight checks for local service availability, configured providers, a real AI response, voice transcription, and screen-share/privacy conditions. It distinguishes configuration from a successful test and explains when a provider test may use paid allowance.
- Solo drafts and saved-session snapshots can be scoped to a Kit. Kit sessions omit the account-wide document library and selected-document IDs so materials for another opportunity are not silently attached. Live/Solo Kit context returns to that Kit rather than overwriting the shared profile.
- The interactive design preview uses synthetic sample data only; Kit edits remain in memory, and AI/provider, microphone and OS-capture actions are disabled there.

### Live and provider reliability
- Classify quota, rate-limit, transient and mixed provider failures; propagate retry timing and avoid retrying providers that are cooling down.
- Preserve partial Live suggestions after stream errors, clear stuck loading state, and keep the no-silent-replay/no-second-paid-request safeguards.
- Retry Deepgram token-grant rate limits using provider retry metadata while keeping authentication and quota errors actionable.
- Keep the Live hard deadline above sequential provider attempt budgets, and wait for the local AI service to release its port before a key-change restart.
- Improve local service readiness, bounded renderer recovery and shutdown coordination while retaining packaged `child_process.fork()`; optional account-service startup remains separate from the required local UI/AI service.

### Carried forward from the unpublished v1.5.5 candidate
- More robust Live audio capture/reconnect, account-scoped read-only recovery notes, and the authenticated bounded managed-STT gateway.
- Account isolation for saved jobs, Resume Studio drafts, authentication responses and document/RAG work; safer recovery of corrupt local session/document data.
- Electron 44 / React 19 / Vite 8 / Vitest 5 / Express 5 upgrades and deployment/security hardening.

## Verification and release gates

The PR #85 reliability-only head previously passed Linux/Windows Desktop CI ([run 38116194648](https://github.com/vsv2014/MockMate/actions/runs/38116194648)). The v1.6.0 candidate has since passed local checks: **83 test files / 627 tests**, API smoke **4/4**, production build, Vite-output verification, platform/React 19/Vitest 5/dev-tooling/auth-config/Express 5 contract checks, and `git diff --check`. These ran under Node 22.22.3 in the sandbox; the release workflow pins Node 24. Fresh CI for the final pushed candidate is still required. Full evidence is in `docs/evidence/VALIDATION_STATUS.md`.

Before a public release, still required:
- Trusted Authenticode signing and publisher verification for the Windows installer and app executable.
- Physical Windows clean-install/upgrade checks, including the transition from the last published v1.5.3 and real Solo/Live microphone/system-audio use.
- Actual Zoom/Meet/Teams share-preview checks; content protection is platform/mode-dependent and does not guarantee invisibility.
- Real hosted WSS/Mongo/Deepgram and provider-usage reconciliation if Managed AI is offered. The default desktop `managedApiBase` remains empty; guest mode bypasses account authentication, not the local UI/AI service.
- A final reviewed commit on `main` before running the release workflow. Do not create a release tag from this unmerged branch.

See `docs/RELEASE_CHECKLIST.md` and `docs/evidence/VALIDATION_STATUS.md` for the authoritative gates and evidence.