# Signed public Windows release

Current source version: **1.6.9** (desktop package and lock), prepared as an **unsigned Personal Preview candidate** for the Live transcript/candidate-capture fixes (#129). The prior [unsigned Personal Preview v1.6.8](https://github.com/vsv2014/MockMate/releases/tag/v1.6.8) was published on November 9, 2026 and contains the Ready Room UI/audio fixes. Version 1.6.9 has **not yet been published or physically tested**. It does not add simultaneous interviewer-plus-microphone capture, nor guarantee accurate transcription or AI round-trip reliability. The last signed stable remains v1.5.3; no signed v1.6.x release exists.

The stable `release.yml` workflow is signed-only. Missing or incomplete signing settings fail before packaging; no unsigned fallback is permitted. v1.6.1 through v1.6.8 are historical/published unsigned preview tracks; v1.6.5 is the v1.6.4 hotfix preview. Do not move or replace any existing tags.

## Signing configuration

Configure in GitHub repository Settings → Secrets and variables → Actions:

- Secret `WIN_CSC_LINK`: trusted Authenticode certificate PFX/P12 in electron-builder's supported format.
- Secret `WIN_CSC_KEY_PASSWORD`: certificate password.
- Variable `MOCKMATE_WINDOWS_PUBLISHER`: exact certificate subject expected by signature verification.

Do not put certificate material or passwords into source, chat, or logs. Merely configuring these names does not prove signature trust. CI verifies `Get-AuthenticodeSignature` is `Valid` for both the packaged app and installer and checks the certificate subject.

The optional `MOCKMATE_API_BASE` must be a valid non-loopback HTTPS backend when configured; otherwise the signed build remains BYOK/local. Signing and Managed AI availability are independent.

## Release sequence

1. Merge reviewed source into `main` after CI passes. Desktop `package.json`, root lock version and root lock package entry must all equal X.Y.Z.
2. Verify signing settings and device acceptance. Use a new matching immutable vX.Y.Z tag once. Never reuse or force-move an existing release tag.
3. Push the matching tag on the reviewed main commit, or dispatch `release.yml` from current main with tag `vX.Y.Z`; do not do both.
4. CI checks source/version provenance, signing configuration, dependency/platform checks, production audits, tests, API smoke, build output, actual signatures and the packaged Windows runtime.
5. Only after the build job passes, stage exactly `MockMate-Setup-X.Y.Z.exe`, `latest.yml` and its blockmap; publish a public stable release with `draft: false`, `prerelease: false`, `make_latest: true`.
6. Confirm the tag, artifact versions, Authenticode signer and updater hashes, then test clean installation, upgrade from stable, Settings scrolling/resizing, Solo, Live system audio/headphones and meeting share preview.

## Other distribution tracks

Existing `personal-preview.yml` and `unsigned-personal-prerelease.yml` are separate explicit manual preview workflows. They retain isolated identities, warning labels and disabled updater feeds. They are not the signed-public release route and are not invoked as an automatic fallback.

## Unsigned public preview (`unsigned-public.yml`)

This is the route used for v1.6.2, v1.6.3, v1.6.4 and v1.6.5. It is an explicit request, never a fallback from the signed workflow.

1. In a reviewed pull request, set `package.json`, the root lock version and the root lock package entry to `X.Y.Z`. Add the `CHANGELOG.md` section. Set `.github/unsigned-release-request.json` to `{ "tag": "vX.Y.Z", "mode": "unsigned-public", "source_commit": "<reviewed head>" }`. `source_commit` is informational provenance; the workflow does not check it.
2. Merge after CI passes. A push to `main` that changes the request file starts the workflow.
3. The workflow then:
   - refuses unless it runs on the current `main` head, the tag matches the package and lock versions, and the tag does not exist yet
   - runs platform, dependency, audit, test, API smoke and build checks
   - builds an isolated, unsigned personal-preview NSIS installer and runs the packaged smoke test
   - publishes a GitHub **pre-release** named `MockMate Personal Preview X.Y.Z (UNSIGNED)` with the EXE, `SHA256SUMS.txt` and a notice; updater metadata is never published
4. Confirm the tag points at the merge commit, the asset names and versions match, and the checksum matches the downloaded EXE.

Do not change `.github/release-request.json` for an unsigned preview: a push that changes it starts the signed `release.yml`.


## Install and test every new development build (manual isolated preview)

The separate `.github/workflows/manual-personal-preview.yml` workflow is a **manual, unsigned, BYOK-only Windows testing channel**. It is not the signed public release path and does not publish a GitHub Release. Once this workflow has been reviewed and merged to the default branch:

1. Open GitHub **Actions → Build Isolated Windows Test Preview → Run workflow**. Choose the exact branch containing the code you want to test, not necessarily `main`. It creates an installer from that selected commit.
2. Leave **allow_known_advisories** unchecked for a clean audit. If a known vulnerability blocks the experimental artifact, inspect the reported advisories first. The optional override explicitly permits a **private testing artifact only**; it never disables the stable release audit. Avoid production/sensitive accounts when advisories are unresolved.
3. Wait for the **isolated-personal-preview** Windows job to succeed. Download the `mockmate-isolated-windows-test-<run number>` artifact from the run page (artifact retention: 14 days). This is a ZIP containing an unsigned `MockMate-Personal-Preview-*-UNSIGNED.exe`, a SHA-256 checksum and a notice with the exact commit SHA.
4. Verify the checksum and install manually. Windows SmartScreen may warn because the preview is unsigned. The preview has a **separate application ID, shortcut and user-data directory**, preserving the existing signed MockMate install. There is no auto-update feed; install a fresh preview artifact to test later commits. Back up preview data before changing versions, and do not assume rollback/migration works without checking.
5. Test Live, Solo, Settings, Interview Kits, key storage, app restart, overlay, logs and any changes under review. Record the source commit, device, observed outcome and reproduction steps in the release evidence log.

All application tests, build and packaged-runtime smoke checks are **hard requirements** to upload a new manual preview. Only the dependency-advisory check permits the explicitly labeled, test-only override. Every advisory is still recorded in a separate artifact. The signed `release.yml` and public unsigned `unsigned-public.yml` security/release gates are **unchanged**.

**Important:** `desktop-ci.yml` also produces validation installers attached to PR checks, but those use the normal MockMate application identity and should be tested only in an isolated Windows VM/profile, not installed over a stable installation. Prefer the manual isolated preview channel for routine local testing.

GitHub CI packaged smoke is automated validation, **not** evidence of real Windows hardware or Zoom/Teams/Meet share-preview certification. A failed workflow does not produce a supported installer. The latest source/branch is not automatically a published release.
