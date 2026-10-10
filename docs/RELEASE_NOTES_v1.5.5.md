# MockMate v1.5.5 — Release Candidate Notes

**Status (2026-10-10): prepared in source, not published or certified.** This is a Windows-first candidate. `package.json` and `package-lock.json` have version `1.5.5`; the latest actual public GitHub release remains `v1.5.3`. The v1.5.4 packaged-service hotfix was committed but not separately released.

The normal public release workflow builds **signed Windows x64 NSIS** and publishes `MockMate-Setup-1.5.5.exe`, `latest.yml`, and a blockmap only after signing/signature and packaged-runtime checks pass. The GitHub Actions PR installer is an **unsigned validation artifact**, not a trusted production update. The current workflow does not create macOS DMG or Linux AppImage releases.

## Optional no-cost personal unsigned pre-release

A separate, manual-only GitHub Actions workflow can publish a **BYOK-only Windows personal-test pre-release** tagged `v1.5.5-personal.1` (or another unused `-personal.N` suffix). The downloadable installer includes `UNSIGNED-PERSONAL` in its name. Only the EXE and SHA256 checksum are published; no auto-update manifests or blockmaps, and no packaged updater feed. This does **not** create a signed `v1.5.5` stable release, certify real-device behavior, or replace the managed-backend verification gates.

## User-facing improvements since v1.5.3

### Live interview continuity
- More resilient Deepgram transport and microphone/system-audio capture: bounded PCM buffering, safer reconnect/stream-completion handling, and improved recovery after device/audio tracks unexpectedly end. Reconnect behavior is guarded against stale capture sessions.
- Streaming suggestions distinguish incomplete output from finished answers and avoid silently issuing another paid answer request when streaming fails or returns a successful empty response.
- After an unexpected renderer exit, a **read-only recovered-notes** panel can show recent questions and AI hints from a bounded, account-scoped checkpoint retained for up to 12 hours. It does not reconstruct full audio, silently resume a session, or trigger provider charges.

### Privacy and local persistence
- Saved job bookmarks, application status, notes, and Resume Studio drafts are now account-scoped. A versioned v3→v4 migration copies prior global stores to the first authenticated account only if its account-scoped data does not already exist.
- Account-switching invalidates in-flight/cached document embeddings and earlier authentication responses, avoiding stale private text or responses from another login.
- If local session/document JSON is unreadable, MockMate attempts an account-scoped backup before replacing it; it refuses a destructive write if the backup fails.
- **Migration caveat:** installation-global legacy data has no recorded original owner. Test A/B sign-in and migration on a real shared-installation scenario before public rollout. The code-level tests do not prove ownership of previously global data.

### Managed STT and runtime hardening
- Hosted managed streaming now uses an authenticated **backend-to-Deepgram WebSocket gateway** rather than granting the desktop a long-lived direct provider socket. Each one-use ticket is checked against the authenticated account and backend quota, and streaming segments are bounded by elapsed time and allowed PCM. The BYOK local route remains separate.
- On a graceful backend shutdown, outstanding reservations/refunds are drained before MongoDB closes. **Abrupt crash recovery and real provider billing reconciliation remain unverified**; the gateway also requires real TLS WebSocket/Mongo/Deepgram testing with the selected hosting topology.
- Include the unreleased v1.5.4 packaged Windows child-process working-directory fix, v1.5.3 installer/updater handoff safeguards, and process-ownership protection for occupied local ports.
- Platform/toolchain refresh: Electron 44, React 19, Vite 8, Vitest 5, Express 5.2.1, dependency/security updates, and explicit packaged React-renderer checks.

## Evidence, not yet device certification

- Verified final code PR [#79](https://github.com/vsv2014/MockMate/pull/79): [Linux and Windows Desktop CI passed](https://github.com/vsv2014/MockMate/actions/runs/37877818087).
- Latest verified code baseline before release-documentation changes: **80 test files / 567 application tests**, plus backend tests, `npm run smoke:api`, production Vite build, Windows packaged renderer/runtime smoke and unsigned installer creation.
- These checks do **not** certify real headset/loopback hardware, Zoom/Meet/Teams share-preview invisibility, in-place NSIS updates, Authenticode signing with repository secrets, hosted WebSocket upgrades or long-session stability.

## Required before tagging v1.5.5

1. Confirm an actual trusted Windows Authenticode signing identity in GitHub Actions: `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD`, `MOCKMATE_WINDOWS_PUBLISHER`. Public release workflow must verify installer and app signatures.
2. Record a physical Windows **clean installation and v1.5.3→v1.5.5 upgrade**, including the older unsigned-to-signed update transition. Do not promise auto-update compatibility without the real trial.
3. Complete Solo and Live real-microphone/system-loopback smoke, reconnect/wake/device changes, session notes recovery, and at least one sustained Live run.
4. Record actual Zoom/Meet/Teams share-preview results. Content protection is OS/mode-dependent; Linux Stealth is unsupported.
5. Test first authenticated migration of existing global jobs/career drafts with two real accounts, then logout/relogin and delete-account cleanup.
6. If shipping Managed AI: deploy a real backend with MongoDB and HTTPS/WSS routing, exercise Deepgram tickets, session duration cap, reservations/refunds, and graceful + abrupt-stop recovery. Reconcile actual provider usage. Without verified hosted configuration, do not claim managed Live metering is production certified.
7. Verify the chosen `main` commit and exact version/tag, complete [the checklist](RELEASE_CHECKLIST.md), and record evidence in [validation status](evidence/VALIDATION_STATUS.md). Trigger the version-generic release workflow only after these checks.

## Publishing and upgrade boundary

- **Expected tag:** `v1.5.5` (not yet created at document preparation time).
- **Expected signed Windows artifact:** `MockMate-Setup-1.5.5.exe` after a successful release workflow.
- **Latest published release before tagging:** `v1.5.3`; no standalone `v1.5.4` GitHub Release.
- **Desktop:** Windows x64 public target. macOS/Linux are not emitted by this release workflow.
- **Mobile:** Expo private beta only, not a public iOS/Android store app.
- **Public release status:** **BLOCKED pending real-device and signing/provider verification.** A green CI run is necessary but not sufficient.

## Relevant merged pull requests

- Live capture and streaming: [#63–#67](https://github.com/vsv2014/MockMate/pulls?q=is%3Apr+is%3Amerged), [#73](https://github.com/vsv2014/MockMate/pull/73), [#75](https://github.com/vsv2014/MockMate/pull/75), [#76](https://github.com/vsv2014/MockMate/pull/76).
- Managed streaming and graceful quota settlement: [#72](https://github.com/vsv2014/MockMate/pull/72), [#74](https://github.com/vsv2014/MockMate/pull/74).
- Cross-account and local-data integrity: [#77](https://github.com/vsv2014/MockMate/pull/77), [#79](https://github.com/vsv2014/MockMate/pull/79).
- Signed-release gate and packaged renderer validation: [#68](https://github.com/vsv2014/MockMate/pull/68), [#70](https://github.com/vsv2014/MockMate/pull/70).
- Version-specific historical changes: [CHANGELOG](../CHANGELOG.md), [release process](RELEASE.md).
