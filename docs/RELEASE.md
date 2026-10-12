# Signed public Windows release

Current target: **v1.6.2**, desktop package/lock version **1.6.2**. A source version is not proof of a signed or published installer.

The stable `release.yml` workflow is signed-only. Missing or incomplete signing settings fail before packaging; no unsigned fallback is permitted. Historical v1.6.1 was an isolated unsigned Personal Preview. Do not move or replace that tag.

## Signing configuration

Configure in GitHub repository Settings → Secrets and variables → Actions:

- Secret `WIN_CSC_LINK`: trusted Authenticode certificate PFX/P12 in electron-builder's supported format.
- Secret `WIN_CSC_KEY_PASSWORD`: certificate password.
- Variable `MOCKMATE_WINDOWS_PUBLISHER`: exact certificate subject expected by signature verification.

Do not put certificate material or passwords into source, chat, or logs. Merely configuring these names does not prove signature trust. CI verifies `Get-AuthenticodeSignature` is `Valid` for both the packaged app and installer and checks the certificate subject.

The optional `MOCKMATE_API_BASE` must be a valid non-loopback HTTPS backend when configured; otherwise the signed build remains BYOK/local. Signing and Managed AI availability are independent.

## Release sequence

1. Merge reviewed source into `main` after CI passes. Desktop `package.json`, root lock version and root lock package entry must all equal 1.6.2.
2. Verify signing settings and device acceptance. Use a new matching immutable v1.6.2 tag once. Never reuse or force-move an existing release tag.
3. Push the matching tag on the reviewed main commit, or dispatch `release.yml` from current main with tag `v1.6.2`; do not do both.
4. CI checks source/version provenance, signing configuration, dependency/platform checks, production audits, tests, API smoke, build output, actual signatures and the packaged Windows runtime.
5. Only after the build job passes, stage exactly `MockMate-Setup-1.6.2.exe`, `latest.yml` and its blockmap; publish a public stable release with `draft: false`, `prerelease: false`, `make_latest: true`.
6. Confirm the tag, artifact versions, Authenticode signer and updater hashes, then test clean installation, upgrade from stable, Settings scrolling/resizing, Solo, Live system audio/headphones and meeting share preview.

## Other distribution tracks

Existing `personal-preview.yml` and `unsigned-personal-prerelease.yml` are separate explicit manual preview workflows. They retain isolated identities, warning labels and disabled updater feeds. They are not the v1.6.2 signed-public release route and are not invoked as an automatic fallback.
