// Called on Windows CI only. The checked-in package/lock remain untouched.
import fs from 'node:fs'
import { createPersonalPreviewConfig } from './personal-preview-config.mjs'

const number = process.argv[2]
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'))
const lock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'))
const preview = createPersonalPreviewConfig(pkg, lock, number)

fs.writeFileSync('package.json', JSON.stringify(preview.pkg, null, 2) + '\n')
fs.writeFileSync('package-lock.json', JSON.stringify(preview.lock, null, 2) + '\n')
fs.writeFileSync('.env.production.local', 'VITE_MANAGED_AI_AVAILABLE=false\n')
console.log('Configured unsigned, BYOK-only personal preview:', preview.version)
console.log('Distinct app ID:', preview.pkg.build.appId)
console.log('Distinct executable:', preview.pkg.build.executableName)
