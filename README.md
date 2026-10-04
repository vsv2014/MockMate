# MockMate — Interview Performance Companion

MockMate is a desktop-first interview preparation and live-performance companion. It combines Solo practice, Resume Studio, Job Matching, Documents, session history, and a content-protected Live overlay that can transcribe interview audio and generate resume-grounded guidance.

## v1.5.2 public release status

- **Public desktop artifact:** Windows NSIS installer (`MockMate-Setup-1.5.2.exe`).
- **macOS/Linux:** source support exists, but v1.5.2 does **not** claim automated public DMG/AppImage artifacts from the current release workflow.
- **Mobile:** iOS/Android Expo app is a **private beta foundation**, not an App Store/Play Store release.
- **Hosted API:** Vercel Hobby deployment is kept at **12 Serverless Functions** by consolidating four career/resume endpoints behind rewrites. Public Vercel AI routes remain default-deny unless explicitly enabled.
- **Validation:** 66 test suites / 478 tests, production build, API smoke, Ubuntu CI, and Windows CI are green. Packaged-Windows behavior and share-preview validation remain release gates.

## Download

Use the [Releases page](https://github.com/vsv2014/MockMate/releases/latest).

| Platform | v1.5.2 status | Artifact |
|---|---|---|
| Windows | Public release target | `MockMate-Setup-1.5.2.exe` |
| macOS | Not part of current automated v1.5.2 public release | Build from source / future signed DMG |
| Linux | Not part of current automated v1.5.2 public release | Build from source; Stealth not supported |

> Windows installers are currently unsigned unless Authenticode secrets are configured. SmartScreen may warn. See [`SIGNING.md`](SIGNING.md).

## What v1.5.2 adds

- 760×240 camera-anchored Teleprompter mode with multi-monitor preservation.
- Hands-free overlay shortcuts scoped only to active overlay/teleprompter modes.
- First-turn system-audio question-capture fixes.
- Layout-aware PDF extraction and hybrid RAG with section-aware chunks, persistent embedding cache, speculative pre-warm, and context-source badges.
- Interview Playbook / `CustomPromptStudio` templates and account-scoped presets.
- Resume Studio, job matching, career tools, and private-beta mobile foundations.
- ARCH policy plane with operation-scoped adaptive routing.
- **Product Intelligence as local/runtime adaptive telemetry**. It is not hosted closed-loop analytics.
- Managed STT quota enforcement with atomic reserve-before-spend for both streaming grants and uploaded transcription.

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
