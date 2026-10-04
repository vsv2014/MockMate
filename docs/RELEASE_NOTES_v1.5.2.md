# MockMate v1.5.2 Release Notes

## Release scope

v1.5.2 is a **Windows-first public desktop release**. The current release workflow publishes the Windows NSIS installer. macOS/Linux source support remains, but this release does not claim automated public DMG/AppImage artifacts.

Validation baseline before tagging: **66 test suites / 478 tests**, exit 0, zero unhandled errors; `npm run build`, `npm run smoke:api`, Ubuntu CI and Windows CI are green. Packaged-Windows behavior and real meeting share-preview validation remain mandatory release gates.

## Windows overlay and capture

- Multi-monitor display preservation across app / overlay / teleprompter / pill modes.
- Camera-anchored `760×240` Teleprompter (`Alt+T`) with renderer/main-process mode sync.
- Overlay shortcuts (`Alt+T`, `Alt+R`, `Alt+Up`, `Alt+Down`) register only while overlay/teleprompter mode owns them.
- `F7` / `Ctrl+Shift+U` captures the selected display with bounded JPEG dimensions/size and remembers the selected display.
- OS content protection remains a **partial** protection mechanism on Windows/macOS and must be verified in the actual Zoom/Meet/Teams share preview. Linux Stealth is not supported.

## First-turn system audio

- System/loopback Turn 1 is handled explicitly as interviewer speech.
- Short imperative openers receive the Turn-1 boost; generic greetings/pleasantries do not.
- Finalize-on-pause is scoped to the first system-audio question and stays disabled after the first committed question across reconnects/source changes.

## Hybrid RAG and document grounding

- Layout-aware PDF extraction for multi-column resumes/technical documents.
- Section-inherited semantic chunks and hybrid lexical/vector retrieval.
- Persistent embedding cache stores provider + model identity and is invalidated on provider/model changes.
- Speculative RAG pre-warm is debounced/cancellable.
- Stale in-flight indexing cannot resurrect deleted/replaced private document text.
- Account deletion purges account-scoped local artifacts.
- Context Audit Trail badges surface which sources grounded an answer.

## Interview Playbook and UI

- `CustomPromptStudio` role playbooks and modular behavior blocks across Live and Solo.
- Account-scoped saved presets.
- Improved typography, focus-visible accessibility, coding view tabs, and refreshed brand icon.

## ARCH and Product Intelligence

ARCH is a **policy plane plus partial execution plane**. Transcription currently uses the ARCH fallback executor; LLM/embedding/vision pipelines still use their existing resilient adapters.

Product Intelligence in v1.5.2 is **local/runtime adaptive telemetry** with privacy-safe structural behavioral signals. It is **not hosted closed-loop analytics** and does not have production tenant-scoped persistence.

Adaptive lane promotion is operation-scoped, so slow vision/career/evaluate calls cannot contaminate a healthy interview lane.

## Managed auth, billing and STT hardening

- Hosted email-verification signup has an explicit verification-required response; desktop/mobile do not store a token until verification completes.
- Hosted verification refuses to boot without required mail-delivery configuration.
- Managed LLM usage is atomically reserved before provider spend.
- Streaming STT reserves a conservative ≤300s lease **before** minting the Deepgram grant and releases it if minting fails.
- Uploaded transcription server-probes MP4/M4A/WAV duration, reserves that duration + safety margin before Deepgram spend, releases on provider failure/abort, and reconciles unused/extra duration atomically.
- Mongo release counters clamp at zero to prevent negative usage balances.

## Vercel Hobby deployment

The original v1.5.2 API shape exceeded Vercel Hobby's 12-function limit. PR #46 consolidated four tiny career/resume wrappers into one `api/career.js` function and preserved the existing public URLs with rewrites:

- `/api/ats-score`
- `/api/referral`
- `/api/resume-latex`
- `/api/tailor-resume`

The deployable serverless count is now **12**. Public Vercel AI routes remain default-deny unless explicitly enabled.

## Mobile private beta

The Expo/React Native foundation now includes hosted auth, account/history surfaces, selected hosted text sources, text Mock/Answer Assist flows, transcript sync, and **microphone recording + authenticated `/transcribe` upload**.

It is still a private beta, not a store-ready claim. Physical-device interruption/background/network-loss testing, privacy labels, store certification, and real Duo pairing remain future gates.

## Release workflow

The Windows release workflow is version-generic:

- tag push `v*.*.*` or explicit workflow dispatch,
- dispatch tag is required with no stale default,
- tag must equal `package.json.version`,
- release source must be current/ancestral to `main`.

## Still required before public tag

- Packaged Windows clean-install smoke.
- `Alt+T → drag → Alt+T` behavioral check.
- Mic/system first-question check.
- `F7` repeat/display-memory check.
- Real meeting share-preview confirmation.
- One clean hosted deployment on the final public head.
- v1.5.1 → v1.5.2 updater validation.

See `docs/RELEASE_CHECKLIST.md` and `docs/evidence/VALIDATION_STATUS.md`.
