# Promptfoo evaluation spike

Status: implementation scaffold and **12 labelled synthetic fixtures** only. This is NOT a 50-case benchmark, actual Gate 0 audio replay, or proven model-quality improvement.

The optional Promptfoo custom provider imports the **real** MockMate `streamHint` from `api/_lib/interview.js`. It does not duplicate prompts, but it intentionally bypasses ASR, renderer-side document retrieval, speculative starts, and the actual Windows overlay. Do not describe it as full-pipeline parity.

## Deterministic smoke (free)
Run `node --test evals/promptfoo/contracts.test.mjs` from repo root. No additional dependency, key or remote service.

## Real-provider smoke (paid; manual only)
Install a reviewed/pinned Promptfoo CLI version on a dev machine. Set `MOCKMATE_RUN_LLM_EVALS=1`, `MOCKMATE_EVAL_PROVIDER` to a configured explicit provider/model ID, and its API credentials. Then run `promptfoo eval -c evals/promptfoo/promptfooconfig.yaml` from repo root. This run is explicitly paid, contains 12 labelled prompts, and may make additional attempts under existing fallback rules. Never add it to routine CI. Check provider prices and limits first.

Assertions check **structure only** (complete fenced code, language tag, selected required/forbidden phrases), not algorithmic or factual correctness. No résumé or other personal data in these fixtures.

Next steps: 50 curated labelled cases, deliberate mutation tests for all seeded bugs in the spike spec, verified post-ASR production parity with real consented recordings, capped release-only provider runs, and packaged Windows Gate 0 validation. No ARCH/ABL file edits on this branch.
