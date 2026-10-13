# Signed public Windows release

Current source version: **1.6.4** (desktop package and lock). v1.6.3 is published only as an unsigned personal preview (see below); no signed v1.6.x build exists, and the latest signed stable installer is v1.5.3. A source version is not proof of a signed or published installer. In the steps below, `X.Y.Z` is the version being released.

The stable `release.yml` workflow is signed-only. Missing or incomplete signing settings fail before packaging; no unsigned fallback is permitted. v1.6.1, v1.6.2 and v1.6.3 are unsigned personal previews. Do not move or replace those tags.

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

This is the route used for v1.6.2 and v1.6.3. It is an explicit request, never a fallback from the signed workflow.

1. In a reviewed pull request, set `package.json`, the root lock version and the root lock package entry to `X.Y.Z`. Add the `CHANGELOG.md` section. Set `.github/unsigned-release-request.json` to `{ "tag": "vX.Y.Z", "mode": "unsigned-public", "source_commit": "<reviewed head>" }`. `source_commit` is informational provenance; the workflow does not check it.
2. Merge after CI passes. A push to `main` that changes the request file starts the workflow.
3. The workflow then:
   - refuses unless it runs on the current `main` head, the tag matches the package and lock versions, and the tag does not exist yet
   - runs platform, dependency, audit, test, API smoke and build checks
   - builds an isolated, unsigned personal-preview NSIS installer and runs the packaged smoke test
   - publishes a GitHub **pre-release** named `MockMate Personal Preview X.Y.Z (UNSIGNED)` with the EXE, `SHA256SUMS.txt` and a notice; updater metadata is never published
4. Confirm the tag points at the merge commit, the asset names and versions match, and the checksum matches the downloaded EXE.

Do not change `.github/release-request.json` for an unsigned preview: a push that changes it starts the signed `release.yml`.
