# Provider comparison baseline

This harness measures direct OpenAI-compatible streaming endpoints using five synthetic
fixtures. Text covers coding, SQL, architecture and behavioral answers. Vision uses
`screenshot.png`, a synthetic loop with an off-by-one error (expected fix `<`, sum `6`).
No real user transcripts, resumes, audio or screenshots are included.

## Offline default

```sh
node evals/models/benchmark.mjs --provider groq
node evals/models/benchmark.mjs --provider gemini_flash_lite --task vision
npm test -- evals/models/benchmark.test.mjs shared/modelLifecyclePolicy.test.js
```

Dry-run output contains the plan only, never simulated performance numbers. Tests inject
fake transports. Neither command above makes provider calls.

## Explicit live evaluation (billable, not run during implementation)

Supply the provider API key through the environment. Do not put secrets in command
arguments, reports or git. No dotenv file is loaded automatically.

```sh
MOCKMATE_RUN_MODEL_BENCHMARK=1 node evals/models/benchmark.mjs --live --provider groq --model openai/gpt-oss-120b --repeats 5 --out /tmp/groq-text.json
MOCKMATE_RUN_MODEL_BENCHMARK=1 node evals/models/benchmark.mjs --live --provider cerebras --model gpt-oss-120b --repeats 5 --out /tmp/cerebras-text.json
MOCKMATE_RUN_MODEL_BENCHMARK=1 node evals/models/benchmark.mjs --live --provider gemini_flash_lite --model gemini-3.5-flash-lite --task vision --repeats 5 --out /tmp/gemini-vision.json
```

The provider must be a registry alias. An explicit `--model` overrides the catalog default;
normal deployment model environment overrides are intentionally not used. Known deprecated
models are rejected. Verify account access and modality before a live run. Each run is
serial, limited to 1..5 repeats (maximum 20 text calls or 5 vision calls), 1024 output tokens
per call, and a 30-second deadline. SDK retries and cross-provider fallback are disabled.
The count/token caps are not a dollar cap. Provider reasoning billing and token-budget
semantics differ. A model rejecting these parameters is recorded as failed without retry.
Existing output files are not overwritten. Failed samples produce a nonzero CLI exit.

## Interpretation and acceptance

- `firstContentMs` measures first non-whitespace content arrival, including connection
  setup. It excludes separate reasoning fields, but cannot identify inline reasoning or
  assess semantic usefulness. It is not UI paint time or first useful answer time.
- Record requested and returned model IDs. Aliases may change underlying versions.
- p50/p95 include successful samples only; always inspect failure count alongside them.
  Five repeats per case are a smoke comparison, not statistically strong production p95.
- Read every answer with the same rubric: correctness, completeness, relevance, clarity,
  each 0..2. For coding/SQL, check executable correctness and edge cases separately.
  For screenshots, require the correct bound and expected sum. A nonempty answer is
  not a quality pass. Manual quality and useful-answer latency remain null until reviewed.
- Usage is retained only if returned. Cost remains null until reconciled against the
  model's current pricing and actual billed usage. Missing usage is never zero cost.
- Before promotion, require no critical correctness errors, no unsupported-image or
  empty-output failures, and a documented latency/cost improvement over the current
  route without quality regression. Expand the corpus and concurrency before rollout.

This is a provider transport baseline. It does not exercise MockMate prompt preparation,
retrieval, Managed auth/metering/fallback, desktop rendering, screenshot capture/queueing,
or speech recognition. The existing `evals/promptfoo/provider.mjs` separately exercises
`streamHint` after synthetic ASR. Full Live acceptance still requires packaged desktop
measurements from end of question to first useful rendered answer, cancellation/reset,
Indian accents and technical terminology, outage tests and the deployed Managed path.

## Lifecycle correction

Cerebras documents `zai-glm-4.7` as deprecated on 2026-08-17:
https://inference-docs.cerebras.ai/support/deprecation

The source-backed registry exclusion is provider-specific. It removes curated eligibility,
rejects saved dynamic selections, and overrides discovery even when metadata says active
or contains only an ID. `gpt-oss-120b` remains the existing default. Its alternative field
is an application suggestion, not an assertion of an official migration recommendation.
Deprecation does not establish that all existing requests fail. Other providers hosting
GLM are not globally blocked by this Cerebras-specific notice.

Future lifecycle entries must include an official source, status, announcement date and
verification date. This patch does not claim an automatic provider-documentation monitor
or a comprehensive audit of every provider model.
