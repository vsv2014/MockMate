# MockMate — Interview Performance Companion

MockMate is a desktop-first interview preparation and live-performance companion. It combines Solo practice, Resume Studio, Job Matching, Documents, session history, and a content-protected Live overlay that can transcribe interview audio and generate resume-grounded guidance.

## Release status — v1.6.1 delivery correction

- **Source version:** PR [#85](https://github.com/vsv2014/MockMate/pull/85) was merged and `v1.6.0` was tagged, but that release has no binaries because its workflow required unavailable Windows signing settings. The delivery correction bumps the desktop source to `1.6.1`.
- **Latest published Windows installer:** [v1.5.3](https://github.com/vsv2014/MockMate/releases/tag/v1.5.3) (`MockMate-Setup-1.5.3.exe`). The v1.5.4 hotfix and v1.5.5 source candidate were never published as stable releases.
- **Next Windows artifact:** `v1.6.1` uses a signed stable installer only when all signing settings exist. With no certificate configured, the same workflow safely publishes an isolated, BYOK-only **unsigned pre-release** instead.
- **macOS/Linux:** source support exists; the current public release workflow only publishes Windows NSIS. Linux overlay content protection is not supported.
- **Mobile:** iOS/Android remains a private beta foundation, not a store release.
- **Hosted API:** the desktop default `managedApiBase` remains empty; the local UI/AI service is still required, and Guest mode bypasses account authentication only. Managed AI uses hosted configuration only when intentionally configured.
- **Validation:** source tests, API smoke, production build, Vite-output verification, and packaged Windows smoke remain mandatory before either release mode publishes. Physical Windows audio, screen-reader, share-preview, and live-provider checks remain separate acceptance gates. See [validation evidence](docs/evidence/VALIDATION_STATUS.md).

## Optional unsigned personal test pre-release

If no Windows code-signing settings exist, the versioned [release workflow](.github/workflows/release.yml) now selects an isolated unsigned mode automatically. The existing [Build Unsigned Personal Pre-release](.github/workflows/unsigned-personal-prerelease.yml) remains available for extra manually numbered personal-test iterations. Both unsigned routes publish a **GitHub pre-release**, never a stable signed update, and are BYOK-only.

The versioned unsigned installer is named `MockMate-Personal-Preview-1.6.1-UNSIGNED.exe`; it is **not Authenticode-signed**, so Windows SmartScreen / Smart App Control may warn or block it. The release includes a SHA256 checksum and warning notice but **no `latest.yml`, `app-update.yml`, or blockmap**. Install updates manually. This is public on GitHub but **not certified for production use**. Do not manually bypass device security policies. See [release process](docs/RELEASE.md).

## Download and platforms

Until a `v1.6.1` artifact passes the workflow, use the direct [v1.5.3 release](https://github.com/vsv2014/MockMate/releases/tag/v1.5.3) for the latest usable signed installer. The public `v1.6.0` release contains source archives only and must not be treated as an installer release.

| Platform | Current availability | Artifact / limitation |
|---|---|---|
| Windows | v1.5.3 signed installer; v1.6.0 has no binaries; v1.6.1 is the correction | Signed `MockMate-Setup-1.5.3.exe`; next artifact is signed when credentials exist, otherwise isolated `MockMate-Personal-Preview-1.6.1-UNSIGNED.exe` |
| macOS | Not produced by current automated public release workflow | Source/developer build; signed/notarized DMG not published through this workflow |
| Linux | Not produced by current automated public release workflow | Source/developer build; screen-share content protection not supported |
| iOS / Android | Private beta foundation | No public store release |

> Stable auto-updating Windows releases require a trusted Authenticode certificate. Without one, MockMate publishes only an isolated, manual-update, unsigned pre-release. See [`SIGNING.md`](SIGNING.md) and [`docs/RELEASE.md`](docs/RELEASE.md).

## What v1.6.0 adds over the last published installer

- **Interview workspace:** new Home, Interview Kits and Ready Room screens, integrated with the existing desktop shell and navigation.
- **Opportunity-safe preparation:** account-scoped Kits hold role/company, resume/JD, experience, preferences, focus notes, and selected local supporting files. Kit attachments are used only by that Kit in practice/Live; the shared document library and shared profile remain separate.
- **Pre-flight clarity:** Ready Room separates service availability, configured providers, real AI/voice tests and meeting share-preview/privacy checks, and discloses possible provider usage.
- **Live/provider resilience:** better quota/rate-limit classification, retry timing and failover; partial streamed hints survive errors without a silent second paid request; Deepgram grant retry and local-service restart/readiness handling are improved.
- **Privacy and platform updates carried forward from the unpublished v1.5.5 candidate:** account-scoped saved jobs/Resume Studio drafts, stale-auth/RAG isolation, read-only Live recovery notes, authenticated bounded managed-STT gateway, and refreshed desktop stack.

## Features introduced in v1.5.2 and retained

- 760×240 camera-anchored Teleprompter mode and multi-monitor support.
- First-turn system-audio question capture and mode-scoped shortcuts.
- Layout-aware PDF extraction, hybrid RAG, section-aware chunks, persisted embedding cache, speculative pre-warm and source badges.
- Interview Playbook / `CustomPromptStudio` templates and account-scoped presets.
- Solo, Live, Resume Studio, job matching, career tools and mobile beta foundations.
- ARCH adaptive routing and **local/runtime** Product Intelligence; not hosted closed-loop analytics.

For the detailed candidate release notes, see [`docs/RELEASE_NOTES_v1.6.0.md`](docs/RELEASE_NOTES_v1.6.0.md) and [`CHANGELOG.md`](CHANGELOG.md).

## Unsigned Windows personal preview (no certificate needed)

For personal testing without a paid Windows code-signing certificate, MockMate
has a separate [**Unsigned Personal Preview** workflow](.github/workflows/personal-preview.yml).
Once the candidate has passed that workflow, look under
[**GitHub pre-releases**](https://github.com/vsv2014/MockMate/releases)
for **MockMate Personal Preview**. It is not the same as the signed/stable
release channel and is not linked from `releases/latest`.

- **Free, unsigned installer:** Windows may warn or block it; verify the
  `SHA256SUMS.txt` asset and do not override managed security policies.
- **Separate installation:** `MockMate Personal Preview` uses its own app
  identity, shortcut, executable and local user-data directory. Your normal
  installation stays separate. Don't run both apps at the same time because
  their local service ports overlap.
- **Bring your own keys:** Preview is local/BYOK only, with no included API
  credentials or unverified hosted Managed AI configuration.
- **Manual upgrades:** Automatic updating is disabled, and the pre-release
  does not publish `latest.yml` or blockmaps. Download future preview
  versions manually.
- **Validation scope:** CI tests and an unpacked Windows runtime/React smoke
  pass before the pre-release workflow publishes; physical installer,
  microphone, meeting share-preview, and two-account migration checks are
  not certified by that smoke alone.

The versioned [**Windows release workflow**](.github/workflows/release.yml)
retains strict signature verification when all certificate settings exist and
otherwise selects the isolated unsigned pre-release path described above. See
[`docs/RELEASE.md`](docs/RELEASE.md).

## AI modes

MockMate supports:

1. **MockMate AI / managed mode** — when a hosted managed backend is configured, provider credentials stay server-side and plan limits are enforced.
2. **Bring your own key (BYOK)** — OpenAI, Anthropic, Gemini, Groq, Cerebras, and Deepgram credentials can be stored locally for private/local use.

## Live Interview Companion

- Floats over Zoom / Google Meet / Microsoft Teams.
- Captures selected system audio or microphone input and transcribes with Deepgram.
- Streams resume/document-grounded guidance with source badges.
- Supports Concise / Balanced / Detailed answer depth and Answer / Coach behavior.
- `Alt+T` toggles camera-anchored Teleprompter mode.
- `Alt+R` commits the current question and answers immediately.
- `F7` / `Ctrl+Shift+U` captures the selected display for coding/vision help.

### Screen protection

| Platform | Protection |
|---|---|
| Windows | Electron `setContentProtection` / `WDA_EXCLUDEFROMCAPTURE`; verify in the real meeting share preview |
| macOS | Electron `setContentProtection`; verify in the real meeting share preview |
| Linux | **Not supported**; overlay may be visible in screen share |

Content protection is partial, not universal invisibility. Always dry-run your exact Zoom/Meet/Teams share mode before relying on it.

## Solo Practice

Solo uses the same Interview Playbook and selected-document grounding model as Live. It generates role-calibrated questions, follow-ups, and an end-of-session evaluation report.

## Resume Studio and Jobs

- ATS-style advisory resume match score.
- Role/JD-tailored summaries and bullets without fabricating experience.
- PDF / text / LaTeX export.
- Referral-message drafting is **copy-only**; MockMate does not silently send email or LinkedIn messages.
- Job listings can be ranked against resume evidence and handed into Solo/Live context.

## Mobile private beta

The Expo/React Native app in [`mobile/`](mobile/) supports hosted sign-up/sign-in, session setup, account/history surfaces, selected hosted text sources, text Mock/Answer Assist, and **microphone recording + authenticated `/transcribe` upload**. It is not store-ready yet: physical-device interruption/background/network-loss testing, production privacy labels, and real Duo pairing remain release gates.

See [`docs/MOBILE_BETA.md`](docs/MOBILE_BETA.md) and [`docs/ROADMAP.md`](docs/ROADMAP.md).

## Run from source

```bash
git clone https://github.com/vsv2014/MockMate
cd MockMate
npm install
cp .env.example .env
npm run electron:dev
```

Linux development may require the no-sandbox script documented in `package.json`.

## Developer configuration

Copy `.env.example` to `.env` for local development. Public installers must never embed provider secrets. Managed deployments keep platform credentials server-side.

Useful variables include LLM provider keys, `DEEPGRAM_API_KEY`, optional `TAVILY_API_KEY`, optional `LIVEKIT_*`, and hosted-mode settings such as `MOCKMATE_HOSTED`, `JWT_SECRET`, MongoDB, CORS, email-verification, and billing configuration.

## Hosted deployment

The Vercel deployment uses the `api/` serverless shape and is intentionally constrained to Hobby limits. Four career/resume routes are rewritten into one consolidated `api/career.js` function so the deployment stays at **12 Serverless Functions** while preserving the public URLs:

- `/api/ats-score`
- `/api/referral`
- `/api/resume-latex`
- `/api/tailor-resume`

For managed auth/sessions/documents/billing/transcription, use the hosted Express backend configuration described in [`docs/DEPLOY_BACKEND.md`](docs/DEPLOY_BACKEND.md) and [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Release verification

Before tagging a public release, follow [`docs/RELEASE_CHECKLIST.md`](docs/RELEASE_CHECKLIST.md). Code review and green CI do not replace packaged Windows validation.

Current evidence: [`docs/evidence/VALIDATION_STATUS.md`](docs/evidence/VALIDATION_STATUS.md).

## Architecture

[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) is the authoritative description of current system behavior. Future work belongs in [`docs/ROADMAP.md`](docs/ROADMAP.md).

## License

MIT
