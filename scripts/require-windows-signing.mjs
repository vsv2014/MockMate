import { pathToFileURL } from 'node:url'
import fs from 'node:fs'

export function requireWindowsSigning(env, pkg) {
  const missing = ['WIN_CSC_LINK', 'WIN_CSC_KEY_PASSWORD', 'SIGNING_PUBLISHER'].filter(name => !String(env[name] || '').trim())
  if (missing.length) throw new Error(`Signed public release blocked: configure ${missing.join(', ')}. Unsigned fallback is disabled.`)
  if (pkg.personalPreviewBuild || pkg.build?.win?.forceCodeSigning !== true || pkg.build?.win?.verifyUpdateCodeSignature !== true || !pkg.build?.publish) {
    throw new Error('Stable package must require signing and retain the verified updater identity.')
  }
  return true
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  requireWindowsSigning(process.env, JSON.parse(fs.readFileSync('package.json', 'utf8')))
  console.log('Signing configuration present; actual certificate trust will be checked after packaging.')
}
