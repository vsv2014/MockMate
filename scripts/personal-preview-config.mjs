// Build-only personal preview configuration. Never commit its output to main.
// Keeps unsigned testing installs isolated from the signed MockMate product
// (app identity, executable, NSIS install, shortcuts and userData).
export function createPersonalPreviewConfig(pkg, lock, number) {
  const raw = String(number)
  if (!/^[1-9][0-9]{0,2}$/.test(raw)) throw new Error('Preview number must be a positive 1–999 integer')
  if (!/^\d+\.\d+\.\d+$/.test(String(pkg?.version || ''))) throw new Error('Base package.json version must be X.Y.Z')
  if (lock?.version !== pkg.version || lock?.packages?.['']?.version !== pkg.version) {
    throw new Error('Root package and lockfile versions must match before configuring preview')
  }
  if (pkg.build?.win?.verifyUpdateCodeSignature !== true) {
    throw new Error('Do not weaken signature verification in the signed release configuration')
  }
  const version = `${pkg.version}-personal.${raw}`
  const preview = structuredClone(pkg)
  const previewLock = structuredClone(lock)

  preview.version = version
  preview.personalPreviewBuild = true // Electron reads this from packaged package.json.
  preview.managedApiBase = '' // BYOK/local only: do not ship an unverified hosted gateway.
  preview.build.appId = 'com.mockmate.personal.preview'
  preview.build.productName = 'MockMate Personal Preview'
  preview.build.executableName = 'MockMatePersonalPreview'
  preview.build.win.artifactName = 'MockMate-Personal-Preview-${version}-UNSIGNED.${ext}'
  preview.build.nsis.shortcutName = 'MockMate Personal Preview'
  preview.build.nsis.uninstallDisplayName = 'MockMate Personal Preview ${version}'
  preview.build.nsis.deleteAppDataOnUninstall = false
  // Stable NSIS hook deletes the stable updater cache on uninstall. The preview
  // must not run stable-product install/uninstall hooks.
  delete preview.build.nsis.include
  // Preview builds have no GitHub updater feed; only the installer is distributed.
  delete preview.build.publish

  previewLock.version = version
  previewLock.packages[''].version = version
  return { pkg: preview, lock: previewLock, version, tag: `personal-v${pkg.version}-${raw}` }
}
