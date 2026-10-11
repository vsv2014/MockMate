// Build-only personal preview configuration. Never commit its output to main.
// Keeps unsigned testing installs isolated from the signed MockMate product
// (app identity, executable, NSIS install, shortcuts and userData).
function assertStableSource(pkg, lock) {
  if (!/^\d+\.\d+\.\d+$/.test(String(pkg?.version || ''))) throw new Error('Base package.json version must be X.Y.Z')
  if (lock?.version !== pkg.version || lock?.packages?.['']?.version !== pkg.version) {
    throw new Error('Root package and lockfile versions must match before configuring preview')
  }
  if (pkg.build?.win?.verifyUpdateCodeSignature !== true) {
    throw new Error('Do not weaken signature verification in the signed release configuration')
  }
  if (!String(pkg.build?.win?.signtoolOptions?.publisherName || '').trim()) {
    throw new Error('Stable release configuration must retain a Windows publisher identity')
  }
}

function createIsolatedUnsignedConfig(pkg, lock, version) {
  assertStableSource(pkg, lock)
  const preview = structuredClone(pkg)
  const previewLock = structuredClone(lock)

  preview.version = version
  preview.personalPreviewBuild = true // Electron reads this from packaged package.json.
  preview.productName = 'MockMate Personal Preview' // Electron app.getName/userData must not share stable app state.
  preview.managedApiBase = '' // BYOK/local only: do not ship an unverified hosted gateway.
  preview.build.appId = 'com.mockmate.personal.preview'
  preview.build.productName = 'MockMate Personal Preview'
  preview.build.executableName = 'MockMatePersonalPreview'
  preview.build.win.artifactName = 'MockMate-Personal-Preview-${version}-UNSIGNED.${ext}'
  // Do not let the isolated unsigned package inherit the stable product's
  // publisher identity. CI also disables certificate auto-discovery and then
  // proves both the installer and packaged executable are NotSigned.
  delete preview.build.win.signtoolOptions
  preview.build.nsis.shortcutName = 'MockMate Personal Preview'
  preview.build.nsis.uninstallDisplayName = 'MockMate Personal Preview ${version}'
  preview.build.nsis.deleteAppDataOnUninstall = false
  // Stable NSIS hook deletes the stable updater cache on uninstall. The preview
  // must not run stable-product install/uninstall hooks.
  delete preview.build.nsis.include
  // An explicit empty publisher list prevents electron-builder from inferring a
  // GitHub feed from the CI repository environment and embedding app-update.yml.
  preview.build.publish = []

  previewLock.version = version
  previewLock.packages[''].version = version
  return { pkg: preview, lock: previewLock, version }
}

export function createPersonalPreviewConfig(pkg, lock, number) {
  const raw = String(number)
  if (!/^[1-9][0-9]{0,2}$/.test(raw)) throw new Error('Preview number must be a positive 1–999 integer')
  const version = `${pkg.version}-personal.${raw}`
  const preview = createIsolatedUnsignedConfig(pkg, lock, version)
  return { ...preview, tag: `personal-v${pkg.version}-${raw}` }
}

// Used only when a normal vX.Y.Z release runs without any signing settings.
// The base version remains exact so the release tag and source provenance match,
// while the app identity and update channel remain isolated from stable MockMate.
export function createUnsignedReleaseConfig(pkg, lock) {
  const preview = createIsolatedUnsignedConfig(pkg, lock, pkg.version)
  return { ...preview, tag: `v${pkg.version}` }
}
