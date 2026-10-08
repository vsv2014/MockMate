# MockMate desktop release — signed Windows gate

**No public release until the signed installer and real-device Live verification both pass.**

This document reflects the current `.github/workflows/release.yml`: it builds and
publishes **Windows NSIS only**. A PR's unsigned Windows CI installer is for
validation, **not** for distributing as a trusted production update.

## Before publication

1. Merge the chosen release candidate into `main` and use a new version/tag.
   Never overwrite a tag or ship changed binaries with an existing version.
2. Confirm Desktop CI is green on Linux and Windows: tests, API smoke, renderer
   build, packaged Windows runtime smoke and Linux entrypoint verification.
3. Run the real packaged-device matrix in
   [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md) and record evidence. At minimum:
   microphone and system audio Live, several actual interview turns, network
   disconnect/recovery, sleep/wake, device changes, end/restart, screen-share
   preview in Zoom/Meet/Teams, and a longer soak.
4. Confirm hosted STT grants have the intended monthly reservation policy.
   Deepgram grant **reuse** avoids charging another 300-second reservation for
   every reconnect while the existing grant is valid. This is *not* a precise
   recording-duration billing system: one new grant still reserves up to 300s.
5. Configure repository Actions secrets and variable **before** running Release:

| Setting | Where | Meaning |
|---|---|---|
| `WIN_CSC_LINK` | GitHub Actions secret | Base64-encoded Authenticode PFX/P12 |
| `WIN_CSC_KEY_PASSWORD` | GitHub Actions secret | Certificate password |
| `MOCKMATE_WINDOWS_PUBLISHER` | GitHub Actions variable | **Exact** Windows certificate `SignerCertificate.Subject` string |
| `MOCKMATE_API_BASE` | Optional Actions variable | Hosted HTTPS managed API; unset = BYOK-only |

The release workflow fails closed if the signing configuration is absent.
It configures the publisher embedded in the update metadata, signs the installer,
and requires `Get-AuthenticodeSignature` to report **Valid** for both the
NSIS installer and unpacked application executable. A signing failure prevents
GitHub Release publication.

## Build and publish

- Bump `package.json` to the version intended for the next installer; update
  changelog and evidence. CI verifies the tag and version match.
- Push a tag from an eligible `main` commit (or dispatch the release workflow
  from current `main` with the same tag).
- CI runs tests, builds, verifies signatures, performs packaged runtime smoke,
  and uploads `MockMate-Setup-*.exe`, `latest.yml`, and `*.blockmap`.
- Inspect the published GitHub Release assets and run a real-device smoke.
  Check the installed app's updater **against another signed test release**
  before promising automatic updates.

## Migration from old unsigned Windows builds

Previously published unsigned installers may have update metadata that disables
signature verification. Installing a newly signed app does not retroactively
secure an older binary's update path. Verify the transition on a physical
Windows host; use a manually downloaded **signed** installer if necessary.
Once the signed application is installed, future NSIS updates must pass
publisher signature verification.

## What release CI cannot prove

- Actual Zoom/Teams/Meet screen-share privacy behavior for each sharing mode
- Real microphone/loopback drivers, USB/Bluetooth changes, audio interruptions,
  and difficult-accent/noisy interviews
- macOS notarization or Linux AppImage publication (not in this workflow)
- Accurate per-second reconciliation of direct-to-Deepgram streaming usage

See [SIGNING.md](../SIGNING.md) for certificate setup and
[RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md) for manual evidence.
