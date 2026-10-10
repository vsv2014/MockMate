# MockMate desktop release — signed Windows gate

**Candidate version: v1.5.5 (not yet published). Latest published installer: v1.5.3.**
**Do not tag or publicly publish until real Windows-device checks and trusted signing are complete.**

The current [Release workflow](../.github/workflows/release.yml) publishes **Windows x64 NSIS only**. CI-generated PR installers are **unsigned, validation-only** artifacts; they are not production updates. This document describes the release process, not evidence that a signed v1.5.5 installer already exists.

## Exception: unsigned personal-testing pre-release (no signing secrets)

For personal BYOK testing only, use the **separate** [Build Unsigned Personal Pre-release (Windows)](../.github/workflows/unsigned-personal-prerelease.yml) GitHub Actions workflow. This does **not** relax or alter the signed production release workflow described below.

- Dispatch manually from the current `main` branch with a **new** `v1.5.5-personal.1` tag (or next unused `-personal.N` suffix). **Never use the stable `v1.5.5` tag** for this route; it is reserved for a future signed release.
- All dependency audits, application/API tests, builds and Windows packaged runtime/renderer smoke must succeed. Personal builds set Managed AI unavailable and omit the packaged update-feed configuration.
- Publication is a **public GitHub pre-release** with `make_latest: false`, not a stable update. Only the installer named with `UNSIGNED-PERSONAL` and `SHA256SUMS.txt` are released; no `latest.yml` or blockmap is published. No automatic updates are supported.
- These downloads lack Authenticode signatures and may be blocked by SmartScreen / Smart App Control. Windows device policy must be respected; manual test builds are **not certified** for audio/capture privacy or hosted billing. Back up local data before updating.
- A versioned release/tag already created by this workflow is never overwritten or reused. Re-run with a fresh `-personal.N` value if a newly built candidate must be published.

This exception is **not** approval to call v1.5.5 a production-certified signed release. All formal release gates below still apply to the stable signed version.

## Source and version prerequisites

1. Select the reviewed, immutable `main` commit. Both `package.json` and the root `package-lock.json` version must equal the target version (currently `1.5.5`). Use a new `v1.5.5` tag exactly once; do not replace an existing tag.
2. Confirm `CHANGELOG.md`, `README.md`, and [v1.5.5 candidate release notes](RELEASE_NOTES_v1.5.5.md) describe only the code actually present in the selected commit.
3. Confirm Linux and Windows Desktop CI passes: tests, API smoke, Vite build, packaged Windows renderer/runtime smoke. The latest pre-documentation baseline is [PR #79's successful CI](https://github.com/vsv2014/MockMate/actions/runs/37877818087): 80 application suites / 567 tests and packaged Windows validation.
4. Run the [real-device checklist](RELEASE_CHECKLIST.md). Record the results in [validation evidence](evidence/VALIDATION_STATUS.md). An unsigned PR smoke cannot replace a signed, installed Windows check.

## Physical Windows release gate

Required minimum: clean install and upgrade from the latest *actually published* installer (v1.5.3); sign-in, two-account legacy jobs/Resume Studio migration, Solo, microphone/system-audio Live, overlay modes, transcript/hint recovery, network blips, device switching, sleep/wake, diagnostics redaction, and a longer Live run. Check Zoom/Meet/Teams **actual share previews** by window/full-display mode; never claim universal invisibility.

Installer/update transition needs particular care: existing unsigned builds cannot be assumed to accept future signed updates with publisher verification. Use a manually downloaded, verified signed installer when the older updater cannot establish a safe upgrade path; do not silently uninstall local user state.

## Managed STT production gate

The old direct-to-Deepgram desktop hosted grant flow has been replaced in `main` (PR #72) by an authenticated backend WebSocket gateway using one-use tickets and bounded PCM/time segments. Graceful backend shutdown drains pending reservations/refunds before Mongo closes (PR #74). Do **not** describe the new gateway as the previous client-side grant reuse system.

Before a public **Managed AI** deployment, exercise the real hosted backend with MongoDB, HTTPS **and WSS upgrade routing**, Deepgram credentials, actual audio, end/reconnect/stop, plan caps, quota settlement, concurrent sessions, and the chosen ticket-store topology. Abrupt process failure may still leave in-flight reservations requiring durable reconciliation; compare provider-billed duration against the backend's usage counts. Code tests alone cannot certify production billing.

BYOK local/provider operation is a separate mode; do not imply it is subject to hosted monthly billing in the same way.

## Required GitHub Actions configuration

| Setting | Type | Purpose |
|---|---|---|
| `WIN_CSC_LINK` | GitHub Actions secret | Base64-encoded Windows Authenticode PFX/P12 |
| `WIN_CSC_KEY_PASSWORD` | GitHub Actions secret | Password for that certificate |
| `MOCKMATE_WINDOWS_PUBLISHER` | GitHub Actions variable | **Exact** `SignerCertificate.Subject` of the trusted code-signing certificate |
| `MOCKMATE_API_BASE` | Optional Actions variable | Managed API HTTPS origin; omit for BYOK-only |

The release workflow fails closed when required signing settings are absent. It signs the app and installer, verifies `Get-AuthenticodeSignature` is **Valid** and the publisher subject matches, checks the packaged runtime, and only then publishes the GitHub Release. The connection used for PR work cannot inspect GitHub secret values; never mark signing as verified without a real workflow run.

## Triggering the v1.5.5 release

**Only after all gates pass:**

1. Open [Build & Release MockMate (Windows)](https://github.com/vsv2014/MockMate/actions/workflows/release.yml).
2. Select **Run workflow** on current `main`, set the required tag input to **`v1.5.5`**, and run it.
3. Alternatively, push a new matching version tag on an eligible verified `main` commit. Do **not** do both.
4. The `provenance` job checks `v1.5.5` matches `package.json.version` and the source commit belongs to `main`.
5. Windows jobs install/check dependencies, run production audits/tests/build, configure the optional managed HTTPS API origin, sign the NSIS installer, verify signatures, smoke the packaged runtime, and stage `MockMate-Setup-1.5.5.exe`, `latest.yml`, and `*.blockmap`.
6. Only after all required jobs pass does the workflow publish the GitHub Release.

If the signing provider, hosted gateway, runtime smoke, or certificate checks fail, **fix and revalidate; do not upload an unsigned fallback or overwrite a release tag**.

## Post-publication verification

- Verify the published tag and artifact versions are `v1.5.5`, not merely the source `package.json` version.
- Download the public installer on a clean Windows machine, verify its signer, install and exercise Solo and Live.
- Repeat upgrade from v1.5.3 with preserved local account documents/history/keys where applicable, capture Logs/Diagnostics without secrets, and record the selected screen-share preview results.
- Mark evidence rows PASS only with actual observation. Keep unresolved code/hardware/hosted billing issues open.

## Free, unsigned personal preview — separate distribution track

When a trusted Windows code-signing certificate is unavailable, use the separate
[`Unsigned Personal Preview (Windows)`](../.github/workflows/personal-preview.yml)
workflow instead of weakening the signed release workflow. It is strictly a
**testing pre-release**, not a replacement for public, production-grade signed updates.

- The first merge of the new workflow into `main` initiates preview iteration `1`
  automatically. For a manual retry or an additional candidate, use **Run workflow**
  on `main` and enter an **unused** `preview_number`.
- For root version `1.5.5`, iteration `1` uses tag **`personal-v1.5.5-1`**
  and internal app version **`1.5.5-personal.1`**. This tag deliberately cannot
  match the signed release workflow's `v*.*.*` trigger.
- The build is **BYOK/local only**; it does not embed a managed hosted API or
  provider keys. It uses a different app ID, product name, executable, NSIS
  installer and per-app user-data directory from normal MockMate.
- The preview deliberately disables **all** automatic update checks, downloads,
  install prompts and manual update checks in the packaged runtime. Its GitHub
  pre-release contains only an **unsigned NSIS EXE, SHA256SUMS.txt and notice**;
  never `latest.yml`, `app-update.yml` or blockmaps.
- All normal code checks and the packaged Windows React renderer smoke run
  **before** the unsigned pre-release publishes. Public signed release and
  certificate checks in `release.yml` remain unchanged.
- Install the preview manually, and do not run it simultaneously with stable
  MockMate: the two desktop applications share loopback service ports.
- The preview has separate local keys and history. It does **not** import existing
  production user data automatically. The preview uninstall does not deliberately
  delete its user-data directory; back up personal session data before uninstall
  or migration.
- Windows Defender SmartScreen/Smart App Control may block an unsigned installer.
  Do not bypass an organization-managed security policy. Only install an artifact
  whose GitHub source and SHA-256 you have independently verified.
- Missing real Windows microphone/system-audio checks, screen-share preview tests,
  signed upgrade tests and hosted usage reconciliation remain explicit limitations.

The unsigned pre-release is **not** shown on GitHub's `releases/latest` stable
download endpoint. Future production builds still require the trusted signer,
real-device evidence, and the `v1.5.5` signed version tag.

## Scope limits

- macOS signed/notarized DMG and Linux AppImage are **not** built by this public workflow.
- Linux screen-share content protection is unsupported.
- Screen protection depends on capture API/meeting share mode; it cannot guarantee invisibility.
- Green unit tests and Windows CI smoke do not prove end-to-end provider billing or physical audio behavior.

See [SIGNING.md](../SIGNING.md) for certificate configuration and [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md) for the full release matrix.
