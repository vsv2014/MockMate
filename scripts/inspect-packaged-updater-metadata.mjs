#!/usr/bin/env node
// Prints exactly which updater metadata electron-builder embedded into the
// packaged app, and *why*.
//
// Unsigned/preview gates assert that `resources/app-update.yml` is absent. When
// that assertion fails, the job log alone must show the offending file plus the
// publish configuration that produced it - otherwise the packaged output is
// thrown away with the runner and the failure cannot be diagnosed.
//
// This is a diagnostic: it exits 0 even when it finds metadata, so it never
// masks the gate that follows it. Pass --fail-on-metadata to turn it into a
// gate itself.
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)

const UPDATER_METADATA_PATTERNS = [/^app-update\.yml$/, /^latest.*\.yml$/, /\.blockmap$/]
const TOKEN_ENV_VARS = ['GH_TOKEN', 'GITHUB_TOKEN', 'GITLAB_TOKEN', 'KEYGEN_TOKEN', 'BITBUCKET_TOKEN']

function parseArgs(argv) {
  const options = { releaseDir: 'release', unpackedDir: null, outDir: null, failOnMetadata: false }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const take = () => argv[++index]
    if (arg === '--release-dir') options.releaseDir = take()
    else if (arg === '--unpacked-dir') options.unpackedDir = take()
    else if (arg === '--out-dir') options.outDir = take()
    else if (arg === '--fail-on-metadata') options.failOnMetadata = true
    else if (arg === '--help' || arg === '-h') options.help = true
    else throw new Error(`Unknown argument: ${arg}`)
  }
  return options
}

function usage() {
  return [
    'Usage: node scripts/inspect-packaged-updater-metadata.mjs [options]',
    '',
    '  --release-dir <dir>    electron-builder output directory (default: release)',
    '  --unpacked-dir <dir>   unpacked app directory (default: <release-dir>/win-unpacked)',
    '  --out-dir <dir>        copy findings here for artifact upload (default: <release-dir>/updater-metadata-diagnostics)',
    '  --fail-on-metadata     exit 1 when updater metadata is found',
  ].join('\n')
}

// Long-lived CI tokens must never reach a public job log or artifact. Report
// only whether they are set, and scrub their values from anything we print.
function collectSecretValues(env) {
  return TOKEN_ENV_VARS
    .map((name) => String(env[name] || ''))
    .filter((value) => value.length >= 8)
    .sort((a, b) => b.length - a.length)
}

function redact(text, secrets) {
  let safe = String(text)
  for (const secret of secrets) safe = safe.split(secret).join('[REDACTED]')
  // Also scrub credentials embedded in remote/publish URLs.
  return safe.replace(/([a-z][a-z0-9+.-]*:\/\/)([^/\s:@]+):([^/\s@]+)@/gi, '$1$2:[REDACTED]@')
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

function listDir(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return null
  }
}

function isUpdaterMetadata(name) {
  return UPDATER_METADATA_PATTERNS.some((pattern) => pattern.test(name))
}

// Every file electron-builder treats as an update feed: the embedded
// app-update.yml plus the published latest*.yml/blockmap sidecars.
function findUpdaterMetadata(releaseDir, unpackedDir) {
  const findings = []

  const appUpdatePath = path.join(unpackedDir, 'resources', 'app-update.yml')
  findings.push({ kind: 'app-update.yml', path: appUpdatePath })

  for (const dir of [releaseDir, path.join(unpackedDir, 'resources')]) {
    const entries = listDir(dir)
    if (!entries) continue
    for (const entry of entries) {
      if (!entry.isFile() || !isUpdaterMetadata(entry.name)) continue
      const fullPath = path.join(dir, entry.name)
      if (fullPath === appUpdatePath) continue
      findings.push({ kind: 'feed-sidecar', path: fullPath })
    }
  }

  for (const finding of findings) {
    finding.exists = fs.existsSync(finding.path)
    if (!finding.exists) continue
    const buffer = fs.readFileSync(finding.path)
    finding.sizeBytes = buffer.length
    finding.sha256 = sha256(buffer)
    finding.contents = buffer.toString('utf8')
  }

  return findings
}

// electron-builder resolves the embedded updater feed in three steps, and only
// an explicit `null` short-circuits all of them:
//   undefined -> PublishManager infers a provider from GH_TOKEN/GITHUB_TOKEN,
//                then falls back to repository info;
//   []        -> getPublishConfigsForUpdateInfo() sees an empty list and falls
//                back to repository info (.git/config or package.json);
//   null      -> getPublishConfigs() returns null, no app-update.yml is written.
function describePublishRule(publish) {
  if (publish === null) {
    return {
      value: 'null',
      suppressesAppUpdateYml: true,
      reason: 'build.publish is explicitly null, so getPublishConfigs() returns null and no app-update.yml is written.',
    }
  }
  if (Array.isArray(publish)) {
    if (publish.length === 0) {
      return {
        value: '[]',
        suppressesAppUpdateYml: false,
        reason:
          'build.publish is an EMPTY ARRAY. getPublishConfigsForUpdateInfo() treats an empty list as "not configured" and re-derives a GitHub feed from repository info, so app-update.yml IS written. Use null to suppress it.',
      }
    }
    return {
      value: `array(${publish.length})`,
      suppressesAppUpdateYml: false,
      reason: 'build.publish declares explicit providers, so the first entry is embedded as app-update.yml.',
    }
  }
  if (publish === undefined) {
    return {
      value: 'undefined (deleted)',
      suppressesAppUpdateYml: false,
      reason:
        'build.publish is ABSENT. PublishManager infers a provider from GH_TOKEN/GITHUB_TOKEN and otherwise falls back to repository info, so app-update.yml IS written. Use null to suppress it.',
    }
  }
  return {
    value: JSON.stringify(publish),
    suppressesAppUpdateYml: false,
    reason: 'build.publish declares an explicit provider, so it is embedded as app-update.yml.',
  }
}

// Ask the installed electron-builder what it would embed, using the same code
// path the packager runs in onAfterPack. This turns "the file exists" into
// "the file exists because <resolved config>".
export async function resolveUpdaterFeedIntent(build, projectDir, secrets) {
  const result = { available: false }
  let publishManager
  let repositoryInfoModule
  try {
    publishManager = require('app-builder-lib/out/publish/PublishManager.js')
    repositoryInfoModule = require('app-builder-lib/out/util/repositoryInfo.js')
  } catch (error) {
    result.reason = `app-builder-lib not resolvable (${error.code || error.message})`
    return result
  }

  let repositoryInfo = null
  try {
    const pkgPath = path.join(projectDir, 'package.json')
    const pkg = fs.existsSync(pkgPath) ? JSON.parse(fs.readFileSync(pkgPath, 'utf8')) : null
    repositoryInfo = await repositoryInfoModule.getRepositoryInfo(projectDir, pkg, pkg)
  } catch (error) {
    result.repositoryInfoError = redact(error.message, secrets)
  }
  result.repositoryInfo = repositoryInfo ? { type: repositoryInfo.type, user: repositoryInfo.user, project: repositoryInfo.project } : null

  // Minimal stand-in for PlatformPackager/Packager: getAppUpdatePublishConfiguration
  // only reads config, platform-specific options, appInfo and repository info.
  // Platform.WINDOWS is matched by identity, so leaving it unset merely skips
  // the publisherName enrichment that unsigned builds never perform anyway.
  const packagerInfo = {
    repositoryInfo: Promise.resolve(repositoryInfo),
    config: {},
    appInfo: { channel: null },
  }
  const fakePackager = {
    config: build || {},
    platformSpecificBuildOptions: (build && build.win) || {},
    info: packagerInfo,
    appInfo: { updaterCacheDirName: 'inspect-updater-metadata', channel: null },
    expandMacro: (value) => value,
    isForceCodeSigningVerification: false,
  }

  try {
    const publishConfig = await publishManager.getAppUpdatePublishConfiguration(fakePackager, null, null, false)
    result.available = true
    result.wouldWriteAppUpdateYml = publishConfig != null
    result.publishConfig = publishConfig ? JSON.parse(redact(JSON.stringify(publishConfig), secrets)) : null
  } catch (error) {
    result.available = true
    result.error = redact(error.message, secrets)
  }
  return result
}

function readGitRemotes(projectDir, secrets) {
  const configPath = path.join(projectDir, '.git', 'config')
  if (!fs.existsSync(configPath)) return []
  return fs
    .readFileSync(configPath, 'utf8')
    .split('\n')
    .filter((line) => /^\s*url\s*=/.test(line))
    .map((line) => redact(line.replace(/^\s*url\s*=\s*/, '').trim(), secrets))
}

function printSection(log, title) {
  log('')
  log(`== ${title} ${'='.repeat(Math.max(0, 72 - title.length))}`)
}

export async function inspectPackagedUpdaterMetadata(options = {}, context = {}) {
  const projectDir = context.projectDir || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const env = context.env || process.env
  const log = context.log || console.log
  const secrets = collectSecretValues(env)

  const releaseDir = path.resolve(projectDir, options.releaseDir || 'release')
  const unpackedDir = path.resolve(projectDir, options.unpackedDir || path.join(releaseDir, 'win-unpacked'))
  const outDir = path.resolve(projectDir, options.outDir || path.join(releaseDir, 'updater-metadata-diagnostics'))

  const pkgPath = path.join(projectDir, 'package.json')
  const pkg = fs.existsSync(pkgPath) ? JSON.parse(fs.readFileSync(pkgPath, 'utf8')) : {}
  const build = pkg.build || {}

  const findings = findUpdaterMetadata(releaseDir, unpackedDir)
  const embedded = findings.filter((finding) => path.basename(finding.path) === 'app-update.yml')
  const appUpdate = embedded[0] || null
  const rule = describePublishRule(build.publish)
  const intent = await resolveUpdaterFeedIntent(build, projectDir, secrets)
  const present = findings.filter((finding) => finding.exists)

  log('Packaged updater metadata inspection')
  log(`project:      ${redact(projectDir, secrets)}`)
  log(`release dir:  ${redact(releaseDir, secrets)} (${fs.existsSync(releaseDir) ? 'exists' : 'MISSING'})`)
  log(`unpacked dir: ${redact(unpackedDir, secrets)} (${fs.existsSync(unpackedDir) ? 'exists' : 'MISSING'})`)

  printSection(log, 'embedded app-update.yml')
  if (appUpdate && appUpdate.exists) {
    log(`status: PRESENT at ${redact(appUpdate.path, secrets)}`)
    log(`size:   ${appUpdate.sizeBytes} bytes`)
    log(`sha256: ${appUpdate.sha256}`)
    log('--- contents begin ---')
    log(redact(appUpdate.contents, secrets).replace(/\s+$/, ''))
    log('--- contents end ---')
  } else if (appUpdate) {
    log(`status: ABSENT (${redact(appUpdate.path, secrets)})`)
  } else {
    log('status: ABSENT (unpacked resources directory not found)')
  }

  printSection(log, 'other update-feed artifacts')
  const sidecars = present.filter((finding) => finding.kind === 'feed-sidecar')
  if (sidecars.length === 0) {
    log('none found (no latest*.yml or *.blockmap in the release or resources directories)')
  }
  for (const sidecar of sidecars) {
    log(`${path.basename(sidecar.path)}  ${sidecar.sizeBytes} bytes  sha256=${sidecar.sha256}`)
    log(redact(sidecar.contents, secrets).replace(/\s+$/, '').split('\n').map((line) => `    ${line}`).join('\n'))
  }

  printSection(log, 'why: build.publish resolution')
  log(`package.json build.publish = ${rule.value}`)
  log(rule.reason)
  if (intent.repositoryInfoError) log(`repository info error: ${intent.repositoryInfoError}`)
  if (intent.repositoryInfo) {
    log(`repository info fallback: ${intent.repositoryInfo.type} ${intent.repositoryInfo.user}/${intent.repositoryInfo.project}`)
  } else if (!intent.repositoryInfoError) {
    log('repository info fallback: unavailable (no package.json "repository" and no parsable .git/config remote)')
  }
  const remotes = readGitRemotes(projectDir, secrets)
  for (const remote of remotes) log(`.git/config url: ${remote}`)
  if (intent.available) {
    if (intent.error) log(`electron-builder resolution error: ${intent.error}`)
    else {
      log(`electron-builder would write app-update.yml: ${intent.wouldWriteAppUpdateYml}`)
      log(`resolved publish config: ${intent.publishConfig ? JSON.stringify(intent.publishConfig) : 'null (suppressed)'}`)
    }
  } else {
    log(`electron-builder resolution unavailable: ${intent.reason || 'unknown'}`)
  }
  for (const name of TOKEN_ENV_VARS) {
    const value = String(env[name] || '')
    log(`env ${name}: ${value ? `set (${value.length} chars, value withheld)` : 'unset'}`)
  }

  // Persist everything for offline inspection once the runner is gone.
  let report = null
  if (context.writeReport !== false) {
    fs.mkdirSync(outDir, { recursive: true })
    for (const finding of present) {
      const destination = path.join(outDir, path.basename(finding.path))
      fs.copyFileSync(finding.path, destination)
      log(`copied ${path.basename(finding.path)} -> ${redact(destination, secrets)}`)
    }
    report = {
      generatedAt: new Date().toISOString(),
      releaseDir,
      unpackedDir,
      appUpdateYml: appUpdate
        ? {
            path: appUpdate.path,
            present: Boolean(appUpdate.exists),
            sizeBytes: appUpdate.sizeBytes ?? null,
            sha256: appUpdate.sha256 ?? null,
            contents: appUpdate.contents != null ? redact(appUpdate.contents, secrets) : null,
          }
        : null,
      feedSidecars: sidecars.map((sidecar) => ({
        name: path.basename(sidecar.path),
        sizeBytes: sidecar.sizeBytes,
        sha256: sidecar.sha256,
      })),
      buildPublish: {
        configuredValue: build.publish === undefined ? '__undefined__' : build.publish,
        suppressesAppUpdateYml: rule.suppressesAppUpdateYml,
        reason: rule.reason,
      },
      electronBuilderIntent: intent,
      gitRemotes: remotes,
      tokenEnvVarsPresent: TOKEN_ENV_VARS.filter((name) => Boolean(env[name])),
    }
    const reportPath = path.join(outDir, 'updater-metadata-report.json')
    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`)
    log(`report written: ${redact(reportPath, secrets)}`)
  }

  console.log('')
  if (present.length === 0) {
    log('RESULT: no updater metadata embedded - unsigned/preview gate expectation satisfied.')
  } else {
    log(`RESULT: ${present.length} updater metadata file(s) present - unsigned/preview gate will fail.`)
    log('FIX: set build.publish to null in the generated preview configuration. An absent')
    log('     or empty-array publish makes electron-builder re-derive a GitHub feed from the')
    log('     CI token or repository info and embed it as app-update.yml.')
  }

  return { report, findings, present, rule, intent }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

async function main() {
  let options
  try {
    options = parseArgs(process.argv.slice(2))
  } catch (error) {
    console.error(error.message)
    console.error(usage())
    process.exit(2)
  }
  if (options.help) {
    console.log(usage())
    process.exit(0)
  }
  const result = await inspectPackagedUpdaterMetadata(options)
  process.exit(options.failOnMetadata && result.present.length > 0 ? 1 : 0)
}

// Wrapped instead of using top-level await so the module stays importable by
// the vitest suite that drives resolveUpdaterFeedIntent() directly.
if (isMain) {
  main().catch((error) => {
    console.error(error)
    process.exit(1)
  })
}
