# Releasing MockMate

How a new version actually reaches users. Read this before every release — the dangerous bugs
here are **infra/signing**, not code (tests + reviews pass while an update silently never lands).

## TL;DR — who gets auto-updates

| Platform | Auto-update on existing installs? | Why |
|---|---|---|
| **Windows** | ✅ Yes — silent background, installs on next launch | NSIS + `latest.yml` + `.blockmap`; works unsigned |
| **Linux** | ✅ Yes (AppImage) | `latest-linux.yml` |
| **macOS** | ❌ **No — users must manually re-download the `.dmg`** | Squirrel.Mac **refuses unsigned updates**; needs Apple Developer ID signing + notarization |

> Do **not** tell macOS users it auto-updates until the Apple secrets below are set. The README and
> landing page are written to reflect "Mac = manual" — keep them honest.

## Release steps

1. **Bump the version** in `package.json` (single source — artifact names use `${version}`).
   - It must be **strictly greater** than what users have installed, or electron-updater won't offer it.
   - Never re-release the same version number with new artifacts — existing installs won't update.
2. **Pre-flight (locally):**
   ```bash
   npm test           # must be green
   npm run build      # renderer builds clean
   git status         # confirm NO .env / secrets / keys are staged (.gitignore covers .env)
   ```
3. **Merge to `main`** (PR from your branch).
4. **Tag and push** — this triggers the release workflow (`.github/workflows/release.yml`):
   ```bash
   git tag v1.3.0     # tag = v + the package.json version
   git push origin v1.3.0
   ```
   (Or run the workflow manually via **Actions → Release → Run workflow** and enter the tag.)
5. CI builds Windows/Linux (always) + macOS (unsigned unless Apple secrets exist) and uploads the
   installers **and the `latest*.yml` update feeds** to a public GitHub Release via softprops.

## Verify after the release

- The GitHub Release exists, is **public, not a draft/prerelease**, tag `vX.Y.Z`.
- Assets include, per platform: the installer **and** its `latest*.yml` (the update feed) +
  Windows `.blockmap`. **No `latest.yml` ⇒ no auto-update**, even if the installer is there.
- Sanity-check auto-update on a real Windows install: open an older version, wait/relaunch, confirm
  it moves to the new version. (`%APPDATA%/MockMate/logs` or console shows `[updater] ready`.)

## Enabling macOS auto-update later (one-time)

CI already auto-signs + notarizes **when these repo secrets exist** (no code change needed):

| Secret | What |
|---|---|
| `MAC_CSC_LINK` | Developer ID Application cert (`.p12`) base64-encoded |
| `MAC_CSC_KEY_PASSWORD` | password for that `.p12` |
| `APPLE_ID` | Apple Developer account email |
| `APPLE_APP_SPECIFIC_PASSWORD` | app-specific password (appleid.apple.com) |
| `APPLE_TEAM_ID` | 10-char Team ID |

Requires the **Apple Developer Program ($99/yr)**. Once set, the next tagged release produces a
signed + notarized DMG/ZIP and macOS installs auto-update like Windows. Then update the README +
landing page to say macOS auto-updates.

## Things that silently break updates (the checklist that matters)

- ❌ Re-tagging the **same version** → no update offered.
- ❌ `latest*.yml` missing from the Release assets → clients can't see the new version.
- ❌ Release left as **draft** → electron-updater can't read it.
- ❌ macOS shipped unsigned but advertised as auto-updating → Mac users stuck on old version, silently.
- ❌ `build.publish` owner/repo not matching the actual repo → updater 404s.
- ❌ A committed `.env` → leaks keys **and** gets bundled. `.gitignore` covers it; double-check `git status`.
