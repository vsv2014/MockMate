# MockMate v1.6.0 — Source Release Notes

**Status (2026-10-11): PR #85 was merged and `v1.6.0` was tagged from commit `15133530c827d684941b27cf5160789026069f27`.** Its Windows workflow failed at the unavailable signing-settings gate before building, so that GitHub Release has no installer assets. The latest usable signed Windows installer remains **v1.5.3**. Version `1.6.1` corrects delivery by providing a strictly isolated unsigned pre-release fallback when no signing configuration exists.

This source release adds the Home → Interview Kits → Ready Room preparation journey while carrying forward the unreleased v1.5.5 candidate work and the Live/provider reliability work in PR #85. Version `1.6.1` can publish either a verified signed Windows NSIS release or, when all signing settings are absent, a clearly isolated unsigned BYOK pre-release with no updater feed. A green CI run is not a physical-device or hosted-provider certification.

## What’s new since the last published stable release

### Interview preparation workspace
- **Home** now brings active Interview Kits, recent sessions, and practice/readiness actions together.
- **Interview Kits** keep role/company, resume, job description, experience, interview type, language, voice style, focus notes, and supporting PDF/TXT/Markdown files together. Attachments are account-scoped and tied to one Kit; checked materials are available to that Kit’s practice and Live sessions only. Files stay in local storage, while retrieval may send selected content to the configured embedding/AI provider. Kit edits do not overwrite the shared profile.
- **Ready Room** provides pre-flight checks for local service availability, configured providers, a real AI response, voice transcription, and screen-share/privacy conditions. It distinguishes configuration from a successful test and explains when a provider test may use paid allowance.
- Solo drafts and saved-session snapshots can be scoped to a Kit. Kit sessions retrieve only selected document IDs owned by that Kit; the account-wide document library is excluded so another opportunity’s materials are not silently attached. Live/Solo Kit context returns to that Kit rather than overwriting the shared profile.
- The interactive design preview uses synthetic sample data only; Kit edits remain in memory, and AI/provider, microphone and OS-capture actions are disabled there.

### Live and provider reliability
- Classify quota, rate-limit, transient and mixed provider failures; propagate retry timing and avoid retrying providers that are cooling down.
- Preserve partial Live suggestions after stream errors, clear stuck loading state, and keep the no-silent-replay/no-second-paid-request safeguards.
- Retry Deepgram token-grant rate limits using provider retry metadata while keeping authentication and quota errors actionable.
- Keep the Live hard deadline above sequential provider attempt budgets, and wait for the local AI service to release its port before a key-change restart.
- Improve local service readiness, bounded renderer recovery and shutdown coordination while retaining packaged `child_process.fork()`; optional account-service startup remains separate from the required local UI/AI service.

### Accessibility and operational feedback
- Associate visible labels with Solo, Live, Career, Jobs, and provider-setting fields; add keyboard-operable tab groups, named choice groups, accessible upload buttons, and announced upload/error/progress states.
- Preserve native keyboard navigation for the AI-mode choice, surface updater/external-link and click-through failures, and prevent stale mouse-region IPC results from re-enabling click-through after it is switched off. Click-through will not enable if its Alt+C recovery shortcut is unavailable.
- Add an explicit one-request connection test for configured local AI keys. Its route is mounted only by the loopback desktop service, not the hosted managed backend; it is offered only in the desktop app, may incur provider usage, and is never called by normal routing.

### Carried forward from the unpublished v1.5.5 candidate
- More robust Live audio capture/reconnect, account-scoped read-only recovery notes, and the authenticated bounded managed-STT gateway.
- Account isolation for saved jobs, Resume Studio drafts, authentication responses and document/RAG work; safer recovery of corrupt local session/document data.
- Electron 44 / React 19 / Vite 8 / Vitest 5 / Express 5 upgrades and deployment/security hardening.

## Verification and release gates

The per-Kit attachment feature commit passes **86 test files / 644 tests**, API smoke **5/5**, production build, Vite-output verification, platform/React/Vitest/dev-tooling/auth-config/Express checks, and `git diff --check`. These ran under Node 22.22.3 in the sandbox; the release workflow pins Node 24. The aggregate `npm run verify` previously stopped before build/tests because `scripts/doctor.mjs` could not download the Electron runtime binary; this is an environment limitation, not a passing packaged-runtime check. Feature commit `0445a894107289fe140129f4d6474aad6971a33d` passed `verify-desktop`, `windows-tests`, and Vercel checks in [run 38126143427](https://github.com/vsv2014/MockMate/actions/runs/38126143427). CI is unsigned validation, not physical-install or signed-release certification. Full current evidence and outstanding device checks are in `docs/evidence/VALIDATION_STATUS.md`.

Before calling any build stable or production-certified, still required:
- Trusted Authenticode signing and publisher verification for the Windows installer and app executable. The v1.6.1 delivery correction may instead publish only a clearly labeled unsigned pre-release with a separate identity and no updater feed.
- Physical Windows clean-install/upgrade checks, including the transition from the last published v1.5.3 and real Solo/Live microphone/system-audio use. The unsigned pre-release can be used to perform these checks but is not certified by publication alone.
- Actual Zoom/Meet/Teams share-preview checks; content protection is platform/mode-dependent and does not guarantee invisibility.
- Real hosted WSS/Mongo/Deepgram and provider-usage reconciliation if Managed AI is offered. The default desktop `managedApiBase` remains empty; guest mode bypasses account authentication, not the local UI/AI service.
- Merge and review the v1.6.1 delivery correction on `main` before creating its new tag; never move or reuse the existing v1.6.0 tag.

See `docs/RELEASE_CHECKLIST.md` and `docs/evidence/VALIDATION_STATUS.md` for the authoritative gates and evidence.
