# Voice turn-detection scoring contract

This is an **offline annotation/metric utility only**, intended for future comparison of current Deepgram capture, browser VAD and Pipecat Smart Turn. It is NOT a VAD or Smart Turn integration. No microphone access, networking, models, or voice data are introduced.

- Input: independent human-labelled reference question IDs on the **same** fixed consented or synthetic recording, per-question missed flag, count of false commits, correction attempts and user overrides, and first-useful-answer latency if available.
- Main metric: total user-visible errors = missed + false commits + correction attempts + user overrides. Also report unique affected questions and rates. A single question can cause several distinct interruptions; this is intentional.
- Comparison requires matching named recording/reference IDs, strictly fewer total errors, no false-commit increase, and candidate p95 no more than 50ms above baseline. The 50ms is a **provisional experiment tolerance** to agree on before replay, not a product promise.
- If latency isn't available, decision is inconclusive. No audio, no benchmark claim. Low baseline error counts demand more recorded samples before asserting percentage improvements.
- A human still needs to label the recordings and validate that false commits that don't attach to any reference question are included (e.g. via an explicit orphan event track in a future revision). Current schema only counts false commits assigned to reference turns.
- Before VAD adoption, add first-question capture, silence gaps, interruptions, correction replay and different Windows hardware to the playback suite. Compare against actual packaged Windows behavior per `docs/EVALS.md`.

Run `npx vitest run evals/voice/score.test.mjs` or use existing `npm test` CI. This folder is additive and never executes on the Live hot path.
