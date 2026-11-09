# Run MockMate with all open-PR changes locally (experimental)

This is an **integration test snapshot** of MockMate `main` and five open PRs, created on 2026-11-09. It does **not** merge the PRs into main or turn their prototypes into finished integrations.

| Source | Included | What actually works |
|---|---|---|
| #118 | root/backend production dependency lockfiles | Current production advisory fixes; development-only package advisories may remain |
| #112 | `evals/voice/` | Synthetic/offline voice-scoring tests; **not** a VAD or Smart Turn integration |
| #108 | `evals/promptfoo/` | Synthetic fixture assertions and opt-in real `streamHint`/`generateHint` adapters; **not** full audio-to-answer replay |
| #109 | `spikes/composio-compat/` | Deterministic preview/permission helpers and tests; **no** OAuth or actual account import |
| #102 | five `docs/SESSION_*` and migration documents | Design reference; **no** automatic cross-device sync |

## Run immediately from source (Windows PowerShell)

Prerequisites: Git, Node.js **24.x**, npm, and a Windows desktop with a working microphone/system audio device for physical Live tests.

```powershell
git clone https://github.com/vsv2014/MockMate.git
cd MockMate
git fetch origin
git switch --track origin/test/all-open-prs-20261109
node --version
npm ci
npm --prefix backend ci
npm run verify
npm run smoke:api
npm run electron:dev
```

If you already have a clone, skip `git clone`, go to the existing clone, and run `git fetch origin` then `git switch -c test/all-open-prs-20261109 --track origin/test/all-open-prs-20261109` (or `git switch test/all-open-prs-20261109` if already created). Do not use this branch to replace your stable app installation.

You can run offline experiment tests without API keys:

```powershell
npx vitest run evals/voice/score.test.mjs
npx vitest run evals/promptfoo/contracts.test.mjs evals/promptfoo/blockingProvider.test.mjs
npx vitest run spikes/composio-compat/preview.test.mjs spikes/composio-compat/readPolicy.test.mjs
```

Promptfoo's **real provider** evaluation has usage costs and requires explicit opt-in; it is **not** triggered by the commands above. Composio does not connect to external accounts.

## Download the isolated portable Windows preview instead

Open [All Open PRs Local Test Build](https://github.com/vsv2014/MockMate/actions/workflows/test-all-open-prs.yml). After the branch workflow succeeds, download the `mockmate-all-prs-windows-<run number>` artifact ZIP. Inside are a checksum, provenance notice, and `MockMate-Personal-Preview-1.6.6-all-prs-<run number>-PORTABLE.zip`.

Verify the SHA-256 checksum using PowerShell `Get-FileHash`. Unzip the **inner** portable ZIP to a separate directory, e.g. `C:\MockMate-Preview\`, and run `MockMatePersonalPreview.exe`. This is **not** an NSIS installer; it runs unpacked. It has a separate app identity and **no auto updater**. Do not use it to test upgrade/migration behavior of a signed stable install.

Why portable? NSIS packaging on PR #118 failed on repeated HTTP 504 downloads from external builder resources even though Linux audits/tests and Windows unit tests/build passed. The branch-specific workflow builds an **unpacked directory** and disables unsigned-executable resource editing only for this disposable preview, avoiding the NSIS distribution step. The normal signed and unsigned public release workflows are **not** changed.

If the portable workflow fails (for example if another resource download is unavailable), run the source-based commands above. A CI artifact is available only after the workflow succeeds.

## Local functional acceptance

1. Ready Room → Live and Solo, basic question detection, stream/finish, reconnect, explicit Answer this.
2. New short follow-up and coding questions: verify language, fenced code completeness and absence of unsupported candidate claims.
3. Interview Kits: add/select/retrieve/delete only approved documents, account-switch privacy.
4. Settings: save/test/remove BYOK keys only in your local preview, no leaked key in diagnostics.
5. Windows overlay/resize/collapse and actual Teams/Zoom/Meet share-preview behavior.
6. Run all four offline experiment test commands above. Actual browser VAD, Pipecat Smart Turn, Composio OAuth, DSA execution sandboxes and cross-device sync are **not part of this snapshot**.

Record the exact branch commit, device, steps, expected behavior, observed behavior and relevant redacted diagnostics for each failure. Physical certification and any public release still require the separate `docs/RELEASE_CHECKLIST.md` gates.

## Updating the snapshot

This branch contains the **specific PR commits recorded at integration time**. It is not an automatic union that updates as PRs change. Later fixes need explicit re-integration and re-validation; never silently claim the ZIP contains a newer commit.
