# MockMate desktop release — signed or isolated unsigned Windows delivery

**Current correction target: v1.6.1. Latest usable signed installer: v1.5.3.**
**The v1.6.0 tag exists, but its release has no installer assets because the signing-only workflow failed before building.**

The [Release workflow](../.github/workflows/release.yml) publishes **Windows x64 NSIS only** and selects exactly one mode. When all three signing settings exist, it publishes a verified signed stable release with updater metadata. When all three are absent, it publishes a separate-identity, BYOK-only unsigned pre-release with no updater metadata. A partial signing configuration fails before the build.

## Unsigned pre-release mode (no signing settings)

The owner has explicitly approved skipping Windows signing while no certificate is available. This does not turn an unsigned executable into a production-certified or auto-updating stable release.

- Trigger with a new version tag matching `package.json` (currently `v1.6.1`) or dispatch that tag from current `main`.
- All dependency audits, application/API tests, builds and Windows packaged runtime/renderer smoke must succeed. Unsigned builds set Managed AI unavailable and omit the packaged update-feed configuration.
- Publication is a **public GitHub pre-release** with `make_latest: false`, not a stable update. Only `MockMate-Personal-Preview-*-UNSIGNED.exe`, `SHA256SUMS.txt`, and `UNSIGNED-RELEASE-NOTICE.txt` are released; no `latest.yml`, `app-update.yml`, or blockmap is published.
- These downloads lack Authenticode signatures and may be blocked by SmartScreen / Smart App Control. Windows device policy must be respected; manual test builds are **not certified** for audio/capture privacy or hosted billing. Back up local data before updating.
- The Personal Preview app ID, executable, shortcuts, and user-data directory are distinct from stable MockMate. Do not run both simultaneously because they share loopback service ports.

The separate manually numbered personal-preview workflows remain available for additional test iterations.

## Source and version prerequisites

1. Select the reviewed, immutable `main` commit. Both `package.json` and the root `package-lock.json` version must equal the target version (currently `1.6.1`). Use a new matching tag exactly once; do not replace an existing tag.
2. Confirm `CHANGELOG.md`, `README.md`, and [v1.6.0 feature/source notes](RELEASE_NOTES_v1.6.0.md) describe only the code actually present in the selected commit.
3. Confirm Linux and Windows Desktop CI passes: tests, API smoke, Vite build, packaged Windows renderer/runtime smoke. The latest pre-documentation baseline is [PR #79's successful CI](https://github.com/vsv2014/MockMate/actions/runs/37877818087): 80 application suites / 567 tests and packaged Windows validation.
4. For a signed stable release, complete the [real-device checklist](RELEASE_CHECKLIST.md) before publication. For an unsigned pre-release, use the published installer to perform and record those checks afterward; until then it remains explicitly unverified on physical hardware. An unsigned CI smoke cannot replace an installed Windows check.

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
| `WIN_CSC_LINK` | Optional GitHub Actions secret | Base64-encoded Windows Authenticode PFX/P12; set together with the next two values |
| `WIN_CSC_KEY_PASSWORD` | Optional GitHub Actions secret | Password for that certificate |
| `MOCKMATE_WINDOWS_PUBLISHER` | Optional GitHub Actions variable | **Exact** `SignerCertificate.Subject` of the trusted code-signing certificate |
| `MOCKMATE_API_BASE` | Optional Actions variable | Managed API HTTPS origin; omit for BYOK-only |

All three signing values must be either present or absent. With all present, the workflow signs the app and installer, verifies `Get-AuthenticodeSignature` is **Valid** and the publisher subject matches, checks the packaged runtime, and only then publishes a stable release. With all absent, it verifies both binaries are **NotSigned**, enforces the isolated preview identity/no-updater contract, and publishes only a pre-release. The connection used for PR work cannot inspect secret values; never mark signing as verified without a real workflow run.

## Triggering the v1.6.1 correction

**After this PR is merged and the source/automated gates pass:** A signed stable release additionally requires signing and physical acceptance before publication. The unsigned route may publish only as the limited pre-release described above, so the resulting installer can undergo physical acceptance.

1. Open [Build & Release MockMate (Windows)](https://github.com/vsv2014/MockMate/actions/workflows/release.yml).
2. Select **Run workflow** on current `main`, set the required tag input to **`v1.6.1`**, and run it.
3. Alternatively, push a new matching version tag on an eligible verified `main` commit. Do **not** do both.
4. The `provenance` job checks `v1.6.1` matches `package.json.version` and the source commit belongs to `main`.
5. Windows jobs select the mode, install/check dependencies, run production audits/tests/build, verify the resulting signed or unsigned identity, and smoke the packaged runtime.
6. Signed mode stages the installer plus `latest.yml` and blockmap. Unsigned mode stages only the `UNSIGNED` Personal Preview installer, checksum, and warning notice.
7. Only after all required jobs pass does the workflow publish the stable signed release or isolated unsigned pre-release.

If signing is partially configured, the hosted gateway is invalid, runtime smoke fails, or signature/unsigned-isolation checks fail, **fix and revalidate; never overwrite an existing release tag**.

## Post-publication verification

- Verify the published tag and artifact versions are `v1.6.1`, not merely the source `package.json` version.
- Download the public installer on a clean Windows machine. Verify the Authenticode signer for signed mode, or verify `SHA256SUMS.txt` plus the separate Personal Preview identity for unsigned mode; then install and exercise Solo and Live.
- Repeat upgrade from v1.5.3 with preserved local account documents/history/keys where applicable, capture Logs/Diagnostics without secrets, and record the selected screen-share preview results.
- Mark evidence rows PASS only with actual observation. Keep unresolved code/hardware/hosted billing issues open.

## Free, unsigned personal preview — separate distribution track

For additional numbered test iterations, the separate
[`Unsigned Personal Preview (Windows)`](../.github/workflows/personal-preview.yml)
workflow remains available alongside the versioned unsigned fallback. It is strictly a
**testing pre-release**, not a replacement for public, production-grade signed updates.

- The first merge of the new workflow into `main` initiates preview iteration `1`
  automatically. For a manual retry or an additional candidate, use **Run workflow**
  on `main` and enter an **unused** `preview_number`.
- For root version `1.6.1`, iteration `1` uses tag **`personal-v1.6.1-1`**
  and internal app version **`1.6.1-personal.1`**. This tag deliberately cannot
  match the signed release workflow's `v*.*.*` trigger.
- The build is **BYOK/local only**; it does not embed a managed hosted API or
  provider keys. It uses a different app ID, product name, executable, NSIS
  installer and per-app user-data directory from normal MockMate.
- The preview deliberately disables **all** automatic update checks, downloads,
  install prompts and manual update checks in the packaged runtime. Its GitHub
  pre-release contains only an **unsigned NSIS EXE, SHA256SUMS.txt and notice**;
  never `latest.yml`, `app-update.yml` or blockmaps.
- All normal code checks and the packaged Windows React renderer smoke run
  **before** the unsigned pre-release publishes. The signed branch of
  `release.yml` retains its certificate and publisher checks.
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
real-device evidence, and a future signed version tag.

## Diagnosing an embedded `app-update.yml`

Unsigned gates assert that `release/win-unpacked/resources/app-update.yml` does
not exist. Only one `build.publish` value actually suppresses that file, because
`app-builder-lib` resolves the embedded update feed in three steps:

| `build.publish` | electron-builder behaviour | `app-update.yml` |
| --- | --- | --- |
| deleted / absent | `PublishManager` infers a provider from `GH_TOKEN`/`GITHUB_TOKEN`, then falls back to repository info | **written** |
| `[]` | `getPublishConfigsForUpdateInfo()` treats an empty list as unconfigured and re-derives a GitHub feed from `package.json "repository"` or `.git/config` | **written** |
| `null` | `getPublishConfigs()` returns `null`, which is the only value that skips the file | not written |

`--publish never` does not help: it controls artifact uploading, not feed
generation, and it never reaches `config.publish`.

`scripts/configure-unsigned-release.mjs` and
`scripts/configure-personal-preview.mjs` therefore set `publish` to `null`.
`electron/updater-feed-suppression.test.js` drives the real `app-builder-lib`
resolution for all three cases so a regression fails in seconds rather than in a
45-minute Windows packaging job.

When a gate does fail, the packaged output dies with the runner, so every
unsigned/preview job runs `node scripts/inspect-packaged-updater-metadata.mjs`
**before** the assertion. It prints the embedded `app-update.yml` with its
SHA-256, the resolved publish configuration and the reason for it, and which CI
token variables are set (values are always redacted). Findings are copied to
`release/updater-metadata-diagnostics/` and uploaded as an artifact when the job
fails. Add `--fail-on-metadata` to use it as a gate instead of a diagnostic.

## Scope limits

- macOS signed/notarized DMG and Linux AppImage are **not** built by this public workflow.
- Linux screen-share content protection is unsupported.
- Screen protection depends on capture API/meeting share mode; it cannot guarantee invisibility.
- Green unit tests and Windows CI smoke do not prove end-to-end provider billing or physical audio behavior.

See [SIGNING.md](../SIGNING.md) for certificate configuration and [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md) for the full release matrix.
