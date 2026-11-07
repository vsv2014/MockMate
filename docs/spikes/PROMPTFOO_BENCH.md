# Promptfoo production-hint benchmark spike

Status: **adapter and 12 synthetic smoke fixtures committed; real provider evaluation NOT RUN**.

## Existing MockMate implementation (verified)

- api/_lib/interview.js exports generateHint (blocking JSON) and streamHint (streaming).
- src/LiveCompanion.jsx performs renderer-side classification, RAG prefetch, speculative hint starts, cancellation and stream display.
- src/useSystemAudio.js provides system-audio/Deepgram capture.
- evals/run.mjs uses a simplified manually duplicated interview prompt and a 700-token answer budget; it is NOT production-path fidelity evidence.
- docs/EVALS.md defines 35-question recorded audio Gate 0, a ~90-minute session and a manual quality rubric.

## Implemented in this branch

- evals/promptfoo/provider.mjs: uses promptfoo JavaScript provider interface; calls actual generateHint from api/_lib/interview.js. Provider selection and answer validation stay in the actual production Node hint engine.
- env gate MOCKMATE_RUN_LLM_EVALS=1, plus a configured model key, is required before any paid request can be made.
- evals/promptfoo/tests.yaml: 12 *synthetic* smoke inputs, no candidate secrets. These test that generated responses are not skipped; they do not establish semantic correctness.
- evals/promptfoo/provider.test.js: deterministic guard and fixture option tests, no paid calls.
- evals/promptfoo/promptfooconfig.yaml: optional evaluation configuration.

## Fidelity boundary

The current Promptfoo adapter replays the **post-ASR, blocking JSON hint generator** only. It does not replay audio, STT transcription, renderer document selection/RAG retrieval, Live speculative streaming/cancellation, or overlay display. Thus it is not yet faithful end-to-end Live evaluation. Do not call this complete or count Gate 0 as passed.

Next engineering slice: a replay adapter for streamHint using fixed source artifacts, the exact ASR transcript produced by the Gate 0 audio, the same selected context and explicit provider/model. It must compare structured contracts (not literal prose) and verify provider fallback/cancellation behavior where instrumented.

## Running the isolated smoke experiment

From the repository root after reviewing currently supported promptfoo Node runtime and pinning a compatible version:

    MOCKMATE_RUN_LLM_EVALS=1 npx promptfoo eval -c evals/promptfoo/promptfooconfig.yaml

The above command makes real paid AI requests; it is deliberately NOT in npm test, npm run verify, CI or any release workflow. Set MOCKMATE_EVAL_PROVIDER to a provider supported by MockMate if needed. Model IDs and prices must be verified before spending.

Normal offline tests use npm test; only the unit adapter tests run. No real-provider test results are asserted by this branch.

## Work remaining before approval

1. Curate 50 human-labeled anonymized examples across DSA, behavioral, system design, technical concepts, short followups, corrections, topic switches and grounding.
2. Each case needs immutable ASR text, expected routing/classification, résumé/JD/doc source constraints, expected answer contract, negative regressions and rubric.
3. Seed and verify these 15 regression cases:
   - missing code block
   - truncated implementation
   - wrong explicit language
   - correction ignored (reachability vs minimum jumps)
   - code follow-up ignored
   - short follow-up loses context
   - new topic contaminated by stale context
   - fabricated personal employment/metrics
   - job requirement claimed as candidate experience
   - Mermaid diagram invalid/missing
   - blocking JSON output contract broken
   - streaming metadata leaks into visible text
   - model unavailable causes unintended generation duplication
   - partial stream silently auto-retries
   - logistical chatter produces an interview answer
4. Implement structural assertions for deterministic contracts and human-approved, bias-controlled rubrics for semantic correctness. Do not require literal model prose equality.
5. Estimate billable cost using actual token usage, model billing, retries, judge calls and selected models; enforce opt-in budget before every release eval.
6. Evaluate Level A deterministic contracts, Level B post-ASR Node generation/stream replay, and Level C real Windows audio-to-overlay playback separately.
7. Keep normal CI entirely mocked and free of real LLM calls. No new prompts or business logic should be duplicated inside Promptfoo.

**Exit:** 50 labeled cases, proven seeded regression detection, accurate cost reporting, baseline comparison and no Live runtime regression. This branch is an isolated experiment and not a production feature.
