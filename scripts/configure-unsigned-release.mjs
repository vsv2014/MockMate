// Called by release CI only when all Windows signing settings are absent.
// The checked-in package/lock retain the stable signed configuration.
import fs from 'node:fs'
import { createUnsignedReleaseConfig } from './personal-preview-config.mjs'

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'))
const lock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'))
const preview = createUnsignedReleaseConfig(pkg, lock)

fs.writeFileSync('package.json', JSON.stringify(preview.pkg, null, 2) + '\n')
fs.writeFileSync('package-lock.json', JSON.stringify(preview.lock, null, 2) + '\n')
fs.writeFileSync('.env.production.local', 'VITE_MANAGED_AI_AVAILABLE=false\n')
console.log('Configured isolated unsigned BYOK release:', preview.version)
console.log('Distinct app ID:', preview.pkg.build.appId)
console.log('Updater feed suppressed (build.publish === null):', preview.pkg.build.publish === null)
