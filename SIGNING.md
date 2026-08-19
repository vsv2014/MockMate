# Code Signing (Windows + macOS)

Unsigned builds trigger OS trust walls:

| Platform | What users see | Fix |
|---|---|---|
| **Windows** | SmartScreen / **Smart App Control** block install or **uninstall** ("could not verify its publisher") | Authenticode-sign the NSIS setup + `MockMate.exe` + uninstaller |
| **macOS** | Gatekeeper: "Apple could not verify MockMate is free of malware" | Developer ID sign + notarize |

Do the setup once. After the secrets are in GitHub, every tagged release (`vX.Y.Z`) is signed by CI when the matching secrets exist. Missing secrets → build still succeeds, but ships **unsigned**.

---

## Windows Authenticode (fixes Smart App Control / SmartScreen)

### Prerequisites

1. An **Authenticode code-signing certificate** as a `.pfx` / `.p12`
   - **OV** works; **EV** builds SmartScreen reputation much faster.
   - Buy from a public CA (DigiCert, Sectigo, SSL.com, etc.). Azure Key Vault / cloud HSM certs also work if you can export or use a supported signing path.
2. The cert subject / organization name should match what you want users to see as publisher (we set `publisherName: "MockMate"` in `package.json` — update both when you have a legal entity name on the cert).

### Step 1 — Base64-encode the `.pfx`

```powershell
# PowerShell
[Convert]::ToBase64String([IO.File]::ReadAllBytes(".\codesign.pfx")) | Set-Clipboard
```

```bash
# macOS / Linux
base64 -i codesign.pfx | pbcopy   # or: base64 codesign.pfx
```

### Step 2 — Add GitHub repository secrets

Repo → **Settings → Secrets and variables → Actions → New repository secret**:

| Secret name            | Value                                      |
| ---------------------- | ------------------------------------------ |
| `WIN_CSC_LINK`         | Base64 of the `.pfx` / `.p12`              |
| `WIN_CSC_KEY_PASSWORD` | Password for that PKCS#12 file             |

CI (`.github/workflows/release.yml`) already passes these into `electron-builder` on the Windows job. No workflow edit needed after the secrets exist.

### Step 3 — Release

```bash
git tag v1.4.5
git push origin v1.4.5
```

The Windows job will Authenticode-sign `MockMate-Setup-*.exe`, the app executable, and the bundled uninstaller. After that:

- SmartScreen / Smart App Control can **verify the publisher**
- Uninstall from **Settings → Installed apps** works without the "publisher" block
- First-run "Windows protected your PC" warnings drop off as reputation builds (faster with EV)

### Verifying a Windows build

```powershell
Get-AuthenticodeSignature .\MockMate-Setup-1.4.5.exe | Format-List Status, SignerCertificate, StatusMessage
# Status should be Valid
```

### About "Modify" being greyed out

That is **expected** for our NSIS installer. Windows Installer **Modify/Repair** is an MSI concept; electron-builder NSIS registers `NoModify=1`. Reinstall / uninstall + install is the supported path. Signing does not enable Modify — and we intentionally leave it disabled so Settings doesn't offer a broken Modify action.

### Stuck unsigned uninstall (dev machine)

If an old unsigned install is blocked by Smart App Control:

1. **Settings → Privacy & security → Windows Security → App & browser control → Smart App Control** → Off (temporarily), then Uninstall, then turn SAC back on if desired.
2. Or run `scripts/force-uninstall-windows.ps1` (removes the app folder + ARP registry entry without running the unsigned uninstaller).

---

## macOS Developer ID + notarization

### Prerequisites

1. **Apple Developer Program membership** — $99/year.
   Enroll at https://developer.apple.com/programs/ (individual or organization).

### Step 1 — Create a "Developer ID Application" certificate

> Do this on a Mac (Keychain Access is required to export the `.p12`).

1. Go to https://developer.apple.com/account/resources/certificates/list
2. Click **+**, choose **Developer ID Application**, follow the prompts
   (you'll upload a Certificate Signing Request created via
   *Keychain Access → Certificate Assistant → Request a Certificate from a Certificate Authority*).
3. Download the resulting `.cer` and double-click to install it into your **login** keychain.
4. In **Keychain Access**, find *"Developer ID Application: <Your Name> (TEAMID)"*,
   right-click → **Export** → save as `cert.p12` and set an export password.

### Step 2 — Base64-encode the certificate

```bash
base64 -i cert.p12 | pbcopy   # copies the base64 blob to your clipboard
```

### Step 3 — Create an app-specific password for notarization

1. Sign in at https://account.apple.com → **Sign-In and Security → App-Specific Passwords**.
2. Generate one (label it e.g. "MockMate notarization"). Copy the value.

### Step 4 — Find your Team ID

It's the 10-character code shown at https://developer.apple.com/account
(top-right, "Membership details") — also the `(TEAMID)` in your certificate name.

### Step 5 — Add the GitHub repository secrets

| Secret name                   | Value                                                        |
| ----------------------------- | ------------------------------------------------------------ |
| `MAC_CSC_LINK`                | The base64 string from Step 2                                |
| `MAC_CSC_KEY_PASSWORD`        | The `.p12` export password you set in Step 1                 |
| `APPLE_ID`                    | Your Apple ID email                                          |
| `APPLE_APP_SPECIFIC_PASSWORD` | The app-specific password from Step 3                        |
| `APPLE_TEAM_ID`               | Your 10-character Team ID from Step 4                        |

### Step 6 — Release

```bash
git tag v1.4.5
git push origin v1.4.5
```

CI will build, **sign**, and **notarize** the macOS DMG when those secrets exist.

> **Signing is conditional.** If the platform secrets are **not** set, that platform still builds — it just ships **unsigned**.
> (`CSC_IDENTITY_AUTO_DISCOVERY` stays `false` in CI; signing turns on only when `WIN_CSC_*` / `MAC_CSC_*` secrets are present.)

### Verifying locally (optional, on a Mac)

```bash
codesign --verify --deep --strict --verbose=2 /Applications/MockMate.app
spctl --assess --type execute --verbose /Applications/MockMate.app   # accepted, Notarized Developer ID
xcrun stapler validate /Applications/MockMate.app                    # validated
```

### Notes

- Hardened runtime entitlements: `build/entitlements.mac.plist`
- `notarize: true` in `package.json` uses Apple's `notarytool` (electron-builder 26)
- Windows and macOS use **different** secret prefixes (`WIN_CSC_*` vs `MAC_CSC_*`) so both can be configured at once
