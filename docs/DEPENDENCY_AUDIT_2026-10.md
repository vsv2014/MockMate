# Dependency audit — 2026-10

This ledger records the dependency/security cleanup stacked after the Electron 44, Vite 8, React 19 and Vitest 5 modernization chain.

## Before cleanup

Root audit:
- 11 total advisories
- 7 high
- 3 moderate
- 1 low
- 0 critical

Backend audit:
- 6 total advisories
- 6 moderate
- 0 high / critical

Affected packages included transitive/direct findings through axios, body-parser, concurrently/shell-quote, DOMPurify, Express/qs, ip-address, joi, js-yaml, undici, Mongoose and Multer.

## Same-major remediation applied

Root package floors were refreshed without crossing majors:
- @livekit/components-react 2.9.24
- @sentry/electron 7.20.0
- @sentry/node 10.76.0
- concurrently 9.2.4
- express 4.22.3
- express-rate-limit 8.7.0
- helmet 8.3.0
- livekit-client 2.22.3
- livekit-server-sdk 2.19.1
- mongoose 8.24.4
- openai 6.49.0

Backend package floors refreshed:
- express 4.22.3
- mammoth 1.13.0
- mongoose 8.24.4
- multer 2.4.0

Locks were regenerated and compatible `npm audit fix --package-lock-only` remediation was applied. No prerelease packages were introduced.

## After cleanup

Fresh CI audit after the lock refresh reports:
- root: **0 vulnerabilities**
- backend: **0 vulnerabilities**

The desktop CI and release workflows are hardened to run `npm audit --audit-level=low` for both the root and backend, so any future low/moderate/high/critical advisory blocks validation/publication until explicitly resolved.

## Remaining latest-major opportunities

These are no longer security blockers; they are breaking-change modernization work and must retain separate rollback boundaries:
- @sentry/electron 7.20.0 -> 8.x
- @sentry/node 10.76.0 -> 11.x
- bcryptjs 2.4.3 -> 3.x (root + backend)
- concurrently 9.2.4 -> 10.x
- dotenv 16.6.1 -> 18.x (root + backend)
- Express 4.22.3 -> 5.x (root + backend)
- Mongoose 8.24.4 -> 9.x (root + backend)
- OpenAI SDK 6.49.0 -> 7.x
- pdfjs-dist 4.10.38 -> 6.x
- Stripe 17.7.0 -> 23.x
- wait-on 8.0.5 -> 9.x

Electron-builder/updater npm `latest` dist-tags may report older values than the approved stable pins. Keep the independently verified Electron platform contract rather than downgrading those packages to match a stale dist-tag.

## Required gates for every follow-up major

- no prerelease dependency versions
- zero root/backend npm advisories
- 67 test files / 482 tests unless an intentional test change is explained
- API smoke
- Vite/Rolldown output verification
- Linux package + ASAR entrypoint verification
- Windows NSIS build
- packaged `MockMate.exe` runtime smoke with required local services
- desktop-sensitive dependency changes remain independently revertible
