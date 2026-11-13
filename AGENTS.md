# MockMate agent workflow

MockMate is an Electron, React, Node.js, and Express interview companion. Treat
provider/model behavior, Live streaming, audio capture, screenshots, local data,
desktop updates, and packaging as release-critical surfaces.

## Evidence rules

- Inspect the actual implementation and current branch before making claims.
- Distinguish verified behavior from planned, mocked, or physically unverified work.
- Do not call a release ready without evidence from the exact candidate commit and
  the applicable real Windows/macOS package, install, update, smoke, and rollback checks.
- Extend existing modules and test harnesses. Avoid parallel replacements of working paths.
- Preserve user data and privacy boundaries. Never log prompts, answers, credentials,
  resume contents, audio, screenshots, or other customer content.

## Development workflow

For a reproducible defect, use the project roles in `.codex/config.toml`:

1. `explorer` traces the execution path and records the concrete trigger.
2. `qa` adds a failing regression to the nearest existing harness.
3. `implementer` makes the smallest compatible fix.
4. `reviewer` checks correctness, coupling, and test quality.
5. Add `security` for auth, provider keys, uploads, quotas, local data, or updates.
6. Add `release_guard` when behavior affects packaging, installers, updates, deployment,
   rollback, or release evidence.

Run independent roles in parallel only when they own separate files or are read-only.
The parent agent resolves conflicts, checks the final diff, and owns all external writes.

## Required checks

- Bug fixes must demonstrate red before green when a deterministic reproduction is possible.
- Run focused tests during development, then `npm test`, `npm run build`, and
  `npm run doctor` before a PR that changes runtime behavior.
- Run `npm audit --omit=dev --audit-level=high` for dependency or security-sensitive work.
- Treat mocked provider tests as contract evidence, not proof that live credentials work.
- Treat Linux Electron tests as local evidence, not Windows/macOS certification.
- Keep PRs draft while required physical or hosted release gates remain unverified.

## Repository boundaries

- `api/`: provider routing, model compatibility, streaming, vision, and serverless APIs.
- `backend/`: hosted auth, metering, managed STT, storage, uploads, and billing.
- `electron/`: desktop lifecycle, IPC, updater, local persistence, packaging behavior.
- `src/`: renderer UI and client orchestration.
- `shared/`: cross-runtime contracts and registries.
- `evals/`: model and prompt regression evidence.
- `docs/evidence/`: version-specific manual and physical verification records.

Do not merge, tag, publish installers, deploy, or mark release gates complete without the
user's authorization and evidence appropriate to that action.
