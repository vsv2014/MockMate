# Test the integrated MockMate build locally (experimental)

Five PRs were integrated into `main` on 2026-11-09 by [PR #119](https://github.com/vsv2014/MockMate/pull/119). Their original PRs were closed as incorporated, not separately merged. The offline test scaffolds do **not** make the planned connector, VAD, agent or sync product features functional. `package.json` remains at version **1.6.6**; no public release was created by this merge.

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
git switch main
git pull --ff-only origin main
node --version
npm ci
npm --prefix backend ci
npm run verify
npm run smoke:api
npm run electron:dev
```

Use updated `main` for the integrated code. Keep the source-running development build separate from any installed stable MockMate application. For debugging the exact prior integration snapshot, the historical branch `test/all-open-prs-20261109` is still available.

You can run offline experiment tests without API keys:

```powershell
npx vitest run evals/voice/score.test.mjs
npx vitest run evals/promptfoo/contracts.test.mjs evals/promptfoo/blockingProvider.test.mjs
npx vitest run spikes/composio-compat/preview.test.mjs spikes/composio-compat/readPolicy.test.mjs
```

Promptfoo's **real provider** evaluation has usage costs and requires explicit opt-in; it is **not** triggered by the commands above. Composio does not connect to external accounts.

## Download the isolated portable Windows preview instead

Open [Build Portable Windows Local Preview](https://github.com/vsv2014/MockMate/actions/workflows/test-all-open-prs.yml), choose the desired branch and run the workflow. After the run succeeds, download the `mockmate-portable-windows-<run number>` artifact ZIP. Inside are a checksum, provenance notice, and `MockMate-Personal-Preview-<version>-<run number>-PORTABLE.zip`.

Verify the SHA-256 checksum using PowerShell `Get-FileHash`. Unzip the **inner** portable ZIP to a separate directory, e.g. `C:\MockMate-Preview\`, and run `MockMatePersonalPreview.exe`. This is **not** an NSIS installer; it runs unpacked. It has a separate app identity and **no auto updater**. Do not use it to test upgrade/migration behavior of a signed stable install.

Why portable? NSIS packaging on PR #118 failed on repeated HTTP 504 downloads from external builder resources even though Linux audits/tests and Windows unit tests/build passed. The manual portable workflow builds an **unpacked directory** and disables unsigned-executable resource editing only for this disposable preview, avoiding the NSIS distribution step. The normal signed and unsigned public release workflows are **not** changed.

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

PR #119 incorporated a **specific snapshot** of five PRs into `main`; future changes require new commits and re-validation. Always inspect the source ref and commit SHA in the CI artifact notice. A passing CI build is not proof of physical microphone, screen-sharing, low-end-device, hosted auth, or signed-updater readiness.
