# MockMate roadmap

## Strategy
MockMate is an interview-performance OS: prepare, practice, perform and learn across desktop and mobile. The durable advantages are answer quality, privacy, resilient multi-provider execution, resume/document grounding, and a content-protected Live experience on supported desktop platforms.

`docs/ARCHITECTURE.md` is the source of truth for **current implementation**. This roadmap contains future work and release gates only.

## Current v1.5.2 state

### Desktop
- [x] Windows multi-monitor overlay and 760×240 camera-anchored Teleprompter.
- [x] Mode-scoped overlay shortcuts (`Alt+T`, `Alt+R`, `Alt+Up/Down`) and bounded `F7` capture.
- [x] First-turn system-audio capture hardening.
- [x] Hybrid RAG with layout-aware PDF extraction, section-aware chunks, embedding-model-bound cache, speculative pre-warm, and Context Audit Trail.
- [x] Interview Playbook / `CustomPromptStudio` across Live and Solo.
- [x] Resume Studio, Jobs/Career, local history, diagnostics, and updater flows.
- [x] ARCH policy plane with operation-scoped adaptive routing.
- [x] Product Intelligence as **local/runtime adaptive telemetry** with privacy-safe behavioral signals.
- [ ] Hosted closed-loop Product Intelligence / tenant-scoped analytics. This is **not** a v1.5.2 capability.

### Managed backend and billing
- [x] Hosted-capable auth/JWT backend with Mongo support.
- [x] Managed LLM proxy with plan/model enforcement and atomic usage reservation.
- [x] Managed STT enforcement for both streaming grants and uploaded transcription; reserve-before-spend is atomic.
- [x] Stripe checkout/webhook/portal code paths.
- [x] Email-verification flow and boot-time prerequisite validation.
- [x] Vercel Hobby deployment shape reduced from 15 to **12 Serverless Functions** while preserving career/resume route URLs.
- [ ] Production Stripe configuration and failure/replay validation against the hosted service.
- [ ] Production email delivery/recovery and optional Google account linking validation.
- [ ] Exact per-second streamed STT reconciliation instead of the conservative ≤5-minute grant lease.

### Mobile private beta
- [x] Expo/React Native shell for iOS and Android.
- [x] Hosted signup/login, account/history surfaces, session setup and answer-depth/playbook snapshots.
- [x] Hosted text-source selection and grounding.
- [x] Text Mock and Answer Assist sessions with transcript sync.
- [x] Microphone recording with explicit consent and authenticated `/transcribe` upload.
- [ ] Physical-device interruption/background/network-loss validation.
- [ ] Production App Store / Play Store privacy labels and release certification.
- [ ] Real second-device pairing / Duo remote companion.
- [ ] Store-ready PDF/DOCX mobile upload/extraction path.

## Release gates for v1.5.2

- [x] 66 test suites / 478 tests, exit 0, zero unhandled errors.
- [x] `npm run build` and `npm run smoke:api`.
- [x] Ubuntu and Windows CI.
- [x] Version-generic Windows release workflow.
- [x] Vercel deployment constrained to Hobby's 12-function limit.
- [ ] One clean hosted deployment on the final public head.
- [ ] Packaged Windows clean-install smoke.
- [ ] Packaged Live: `Alt+T → drag → Alt+T`, mic/system first question, `F7` repeat/display memory.
- [ ] Real Zoom/Meet/Teams share-preview confirmation.
- [ ] v1.5.1 → v1.5.2 auto-update validation.
- [ ] Diagnostics export/redaction click-through on the packaged build.

See `docs/RELEASE_CHECKLIST.md` and `docs/evidence/VALIDATION_STATUS.md`.

## P0 — Public release reliability

- [ ] Complete the packaged Windows release checklist before creating the v1.5.2 tag.
- [ ] Add automated coverage for deployment-shape constraints so Hobby/serverless limits cannot regress silently.
- [ ] Verify process identity before `freePort()` kills listeners on ports 3002/4000; current behavior predates PR #45 and should be hardened separately.
- [ ] Add signed Windows installer/update channel when certificates are available.
- [ ] Establish staged rollout and rollback procedure.

## P1 — Hosted product hardening

- [ ] Production-grade password recovery and optional OAuth account linking.
- [ ] Stripe test-mode end-to-end validation including webhook replay/out-of-order events, cancellation and downgrade.
- [ ] Tenant-scoped, opt-in encrypted cloud history/profile sync with export/delete controls.
- [ ] Privacy-controlled centralized diagnostics with retention and deletion controls.
- [ ] Durable server-side session reconciliation and support correlation without raw interview content in telemetry.

## P2 — Voice and Live quality

- [ ] Exact Deepgram streamed-second reconciliation by account/session.
- [ ] Two-hour packaged soak with network interruption and provider failover.
- [ ] Expand STT/accent/noise evaluation fixtures using privacy-safe recordings or synthetic corpora.
- [ ] Certify Stealth/share-preview behavior per Windows/macOS + meeting-app/share-mode combination.
- [ ] Keep Linux Stealth explicitly unsupported until there is a real OS/compositor solution.

## P3 — Mobile practice MVP

- [ ] Ten-minute voice mock flows with robust interruption recovery.
- [ ] Push reminders for scheduled interviews and weak-area drills.
- [ ] Offline-safe cached profile/history with an explicit sync state.
- [ ] Physical-device matrix: at least one iPhone and two materially different Android devices.
- [ ] Store distribution only after privacy labels, account deletion, token expiry, background interruption and billing entitlements are verified.

## P4 — Second-device companion / Duo

- [ ] Pair desktop and mobile with authenticated short-lived QR/link/code.
- [ ] Mirror live transcript, current answer and session health to the phone.
- [ ] Remote controls: pause/resume, shorter/longer, repeat, skip, end.
- [ ] Mentor/helper join with explicit consent and revocable permissions.
- [ ] Audit every remote-control action.

## P5 — Interview Intelligence Graph

- [x] Normalize skills, concepts, question types, attempts, evidence and outcomes.
- [x] Track repeated misses, follow-up failures, over-explanation and unsupported claims locally.
- [x] Generate drills from evidence-backed weak areas.
- [ ] Cross-session longitudinal readiness without inventing a universal score.
- [ ] Export/delete controls for graph data.
- [ ] Any centralized analytics must be aggregate, consent-based and tenant-scoped.

## P6 — MockMate Code Arena

- [ ] Desktop/web Monaco workspace for JavaScript, TypeScript, Python and Java first.
- [ ] Hardened no-network runners with CPU/memory/process/time limits and ephemeral files.
- [ ] Progressive assistance: nudge → hint → approach → pseudocode → solution.
- [ ] Evaluate correctness, complexity, edge cases and explanation quality.
- [ ] Adaptive interviewer follow-ups and replay of where the candidate became stuck.
- [ ] System-design canvas and rubric.

## P7 — Career and referral workflow

- [ ] Local follow-up reminders for copied referral outreach.
- [ ] Optional Gmail/Outlook user-confirmed send in a later consented integration.
- [ ] Keep referral generation copy-only until explicit send permissions exist.
- [ ] Keep LinkedIn browser automation separate from the core MockMate product because it has distinct platform-policy and account-risk implications.

## P8 — Team / placement validation

- [ ] Run small paid pilots with a college/training/recruiting partner only after individual retention is proven.
- [ ] Aggregate cohort dashboards with student-controlled transcript sharing.
- [ ] Separate assessment workflows from undisclosed live-assistance positioning.

## Product experience and growth backlog — after release stabilization

These ideas were selected from the ParakeetAI comparison supplied by the user. They are future MockMate work, not verified competitor claims or shipped capabilities. P0 release reliability and Live transcription/recovery work take precedence; no release version or delivery date is committed here.

| Priority | Opportunity | Planned scope | Acceptance criteria |
|---|---|---|---|
| First product follow-up | Optional meeting detection | Investigate Zoom/Teams meeting-start detection and offer an explicit **Start Session** confirmation. | Opt-in and easy to disable; validate supported OS/app combinations, false positives and performance; never start capture or recording without confirmation. |
| First product follow-up | Company-specific Solo practice | Add a curated, searchable question bank with company, role, topic and difficulty filters, feeding Solo practice. | Record provenance and curation dates; distinguish representative practice questions from verified reports; do not claim frequency data without evidence; preserve resume/JD grounding and avoid fabricated experience. |
| Next voice improvement | Voice-first mock interviews | Build on existing Solo questions, follow-ups and evaluations with realistic spoken exchanges, interruption handling and replay of previous attempts. | Test turn-taking, interrupt/stop/resume, network loss and provider recovery; make transcripts and attempt replay available with retention/export/delete controls. Complements P2 and P3. |
| Next learning improvement | Post-interview insights | Strengthen session history with searchable transcripts, recurring weak areas and improvement across practice attempts. | Link insights to actual transcript/attempt evidence; compare consistent rubric dimensions over time without inventing a universal readiness score; preserve privacy and export/delete controls. Complements P5. |
| After packaged validation | Genuine product demonstrations | Create short demos of Live transcription, coding assistance and recovery after a network interruption. | Use synthetic or explicitly consented content; show actual tested behavior and platform limits; exclude unsupported invisibility, accuracy or outcome claims. |

Start future product implementation with meeting detection and company-specific Solo practice once stabilization gates are satisfied. Reliability, accurate personalized guidance and transparent privacy controls remain the product priorities.

## Non-negotiable product boundaries

- Never claim universal invisibility or Linux Stealth.
- Never fabricate candidate experience.
- Never embed platform provider keys into public installers.
- Never call Product Intelligence hosted/closed-loop until persistence, tenant scoping, privacy controls and a production bridge actually exist.
- Never call mobile store-ready without physical-device evidence.
- Never tag a release solely because unit/CI checks are green; packaged validation remains mandatory.
