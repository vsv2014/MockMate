# MockMate documentation

This directory is intentionally small. Prefer updating an existing canonical document instead of creating a new one-off plan, audit snapshot, or phase file.

## Canonical docs

| Document | Purpose |
|---|---|
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | Current system architecture, runtime boundaries, ARCH, RAG, Electron, hosted API and mobile topology |
| [`ROADMAP.md`](ROADMAP.md) | Future product and engineering direction; completed implementation plans should be folded here or removed |
| [`DEPLOY_BACKEND.md`](DEPLOY_BACKEND.md) | Hosted backend/Vercel/Mongo deployment and verification |
| [`RELEASE.md`](RELEASE.md) | Release process and workflow behavior |
| [`RELEASE_CHECKLIST.md`](RELEASE_CHECKLIST.md) | Required pre-release/manual validation gates |
| [`RELEASE_NOTES_v1.5.2.md`](RELEASE_NOTES_v1.5.2.md) | Current release notes; older release history belongs in root `CHANGELOG.md` / GitHub Releases |
| [`MOBILE_BETA.md`](MOBILE_BETA.md) | Current mobile implementation/beta boundary |
| [`MOBILE_APP_PLAN.md`](MOBILE_APP_PLAN.md) | Longer-lived mobile product/delivery direction |
| [`DIAGNOSTICS.md`](DIAGNOSTICS.md) | Diagnostics, privacy-safe logging and support workflow |
| [`EVALS.md`](EVALS.md) | Evaluation harness and quality checks |
| [`INTERRUPTION_MATRIX.md`](INTERRUPTION_MATRIX.md) | Live interruption/regression scenarios |
| [`STEALTH_BROWSER_MATRIX.md`](STEALTH_BROWSER_MATRIX.md) | Capture-protection verification matrix |
| [`SECRET_ROTATION.md`](SECRET_ROTATION.md) | Secret rotation/security operations |
| [`SESSION_METRICS.md`](SESSION_METRICS.md) | Session metrics contract |
| [`BLAST_RADIUS_REVIEW.md`](BLAST_RADIUS_REVIEW.md) | Current v1.5.2 branch-wide release review summary |
| [`evidence/VALIDATION_STATUS.md`](evidence/VALIDATION_STATUS.md) | Authoritative packaged/manual validation status |

## Documentation rules

1. `README.md` at the repository root is the public entry point.
2. `ARCHITECTURE.md` describes what exists **now**; `ROADMAP.md` describes what comes next.
3. `CHANGELOG.md` + GitHub Releases own historical release notes. Do not keep a growing set of old `RELEASE_NOTES_vX.Y.Z.md` files in `docs/`.
4. Completed implementation plans (`*_PLAN.md`, `PHASE*.md`, `NEXT_PHASE.md`) should be folded into architecture/roadmap and deleted.
5. Temporary audit/remediation ledgers should be removed after closure; durable release evidence belongs under `docs/evidence/`.
6. Do not commit interview transcripts, candidate-specific autopsies, secrets, tokens, raw screenshots, audio, or other sensitive evidence.
7. Before adding a new Markdown file, ask whether an existing canonical document can own the content instead.

Git history preserves removed planning and audit documents when historical investigation is needed.
