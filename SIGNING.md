# macOS Code Signing & Notarization

The "Apple could not verify MockMate is free of malware" Gatekeeper block happens
because the DMG was shipped **unsigned and un-notarized**. This is the one-time setup
to fix it permanently so users can open MockMate with no warning.

You only need to do this once. After the secrets are in GitHub, every tagged release
(`vX.Y.Z`) is automatically signed and notarized by CI.

## Prerequisites

1. **Apple Developer Program membership** — $99/year.
   Enroll at https://developer.apple.com/programs/ (individual or organization).

## Step 1 — Create a "Developer ID Application" certificate

> Do this on a Mac (Keychain Access is required to export the `.p12`).

1. Go to https://developer.apple.com/account/resources/certificates/list
2. Click **+**, choose **Developer ID Application**, follow the prompts
   (you'll upload a Certificate Signing Request created via
   *Keychain Access → Certificate Assistant → Request a Certificate from a Certificate Authority*).
3. Download the resulting `.cer` and double-click to install it into your **login** keychain.
4. In **Keychain Access**, find *"Developer ID Application: <Your Name> (TEAMID)"*,
   right-click → **Export** → save as `cert.p12` and set an export password.

## Step 2 — Base64-encode the certificate

```bash
base64 -i cert.p12 | pbcopy   # copies the base64 blob to your clipboard
```

## Step 3 — Create an app-specific password for notarization

1. Sign in at https://account.apple.com → **Sign-In and Security → App-Specific Passwords**.
2. Generate one (label it e.g. "MockMate notarization"). Copy the value.

## Step 4 — Find your Team ID

It's the 10-character code shown at https://developer.apple.com/account
(top-right, "Membership details") — also the `(TEAMID)` in your certificate name.

## Step 5 — Add the GitHub repository secrets

Repo → **Settings → Secrets and variables → Actions → New repository secret**.
Add all five:

| Secret name                   | Value                                                        |
| ----------------------------- | ------------------------------------------------------------ |
| `MAC_CSC_LINK`                | The base64 string from Step 2                                |
| `MAC_CSC_KEY_PASSWORD`        | The `.p12` export password you set in Step 1                 |
| `APPLE_ID`                    | Your Apple ID email                                          |
| `APPLE_APP_SPECIFIC_PASSWORD` | The app-specific password from Step 3                        |
| `APPLE_TEAM_ID`               | Your 10-character Team ID from Step 4                        |

## Step 6 — Release

Push a version tag (or run the workflow manually):

```bash
git tag v1.1.0
git push origin v1.1.0
```

CI will build, **sign**, and **notarize** the macOS DMG. The notarization step adds a
few minutes (Apple's service has to scan the build). Once done, the published DMG opens
with no Gatekeeper warning.

> **Signing is conditional.** If the `MAC_CSC_LINK` + `APPLE_ID` secrets are **not** set,
> the macOS build still succeeds — it just ships **unsigned** (users clear it once with
> `xattr -dr com.apple.quarantine /Applications/MockMate.app`). Signing + notarization
> turn on automatically the moment the secrets exist. So a release never fails just
> because Apple isn't set up yet.

## Verifying locally (optional, on a Mac)

```bash
# After downloading the released DMG and copying MockMate.app to /Applications:
codesign --verify --deep --strict --verbose=2 /Applications/MockMate.app
spctl --assess --type execute --verbose /Applications/MockMate.app   # should say: accepted, source=Notarized Developer ID
xcrun stapler validate /Applications/MockMate.app                    # should say: validated
```

## Notes

- The hardened runtime entitlements live in `build/entitlements.mac.plist`
  (JIT for Electron + microphone access for the interview companion).
- `notarize: true` in `package.json` uses Apple's modern `notarytool` (built into
  electron-builder 24+). The legacy `altool` is not used.
- Signing/notarization only runs on the macOS CI job; Windows and Linux builds are
  unaffected.
