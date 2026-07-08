# MockMate model evals

Benchmark candidate models on real interview questions so the default model is chosen from **data**, not vibes. For each `(model × question)` it generates an answer, an LLM judge scores it against `rubric.md`, and you get a scoreboard of **quality / latency (p50, p95) / est. cost**.

## Run
```bash
# from the repo root — only candidates whose key is set are run
OPENAI_API_KEY=sk-...  ANTHROPIC_API_KEY=sk-ant-...  node evals/run.mjs
```
Output: a `console.table` scoreboard + `evals/results.json`.

## Files
- **`questions.json`** — the question set (behavioral / coding / system-design / company / technical-knowledge). **Expand this** — 16 is a starting point; ~75 across your real interview mix gives stable numbers. Each entry: `{ type, role, q }`.
- **`rubric.md`** — the judge's grading criteria (relevance, correctness, structure, specificity, conciseness → overall). Tune it to your bar.
- **`run.mjs`** — the runner. Edit `CANDIDATES` (add/remove models, set prices, add a `baseURL` for OpenAI-compatible providers like Groq/Gemini) and `JUDGE`.

## How to read it
- **avgQuality** — mean overall (1–5) from the judge. Primary signal.
- **p50ms / p95ms** — generation latency. For **live** interviews, p95 is the one that matters — a great answer that arrives late is useless. Solo practice can ignore it.
- **costPerSet** — cost to run all questions once, per model. Multiply out to a per-interview estimate; prompt caching (resume + system prefix) cuts input cost ~90% in production.
- **Pick:** highest `avgQuality` within your live-latency budget, then cheapest.

## Notes
- The `answerPrompt` in `run.mjs` should mirror your **production** interview-copilot prompt for a faithful benchmark — update `RESUME` and the system text if yours differ.
- The judge is one fixed model so scores are comparable across candidates; spot-check a few answers by hand to trust it, and consider a second judge model for high-stakes calls.
- Re-run whenever a new model drops (`api/_lib/core.js` `listModels()` shows what's live) — this is how you keep the default current instead of stuck on whatever you picked first.
