# Small trial and regression review — 2026-10-12

## Recommendation (updated October 12)

For one occasional personal user, retain direct BYOK and Deepgram. Do not add managed hosting or require a second paid account. Gemini is the proposed default; Anthropic is optional if separately configured. This recommendation does not change the provider registry or enable billing. OpenRouter remains a possible future optional connection, not a requirement.

Provider choice cannot establish whether the reported answer regressions are fixed. First preserve the complete current question, carry previous suggestions as explicitly labelled AI context, and share history assembly and output budgets across streaming and blocking hints. Existing fallback and diagnostics should be extended rather than duplicated. Screenshots must retain a vision-capable route.

## Estimate, not a bill

For four 90-minute sessions, each with 40 questions at 1,500 input / 300 billed output tokens, three screenshots at an assumed 1,000 input tokens each, and 10% extra LLM usage: 277,200 input and 52,800 output tokens. At Gemini $0.75/M input and $3.75/M output, LLM usage is $0.4059. One 360-minute Nova-3 monolingual streaming channel at $0.0048/min is $1.728. Total is about $2.13 before taxes and fees. Diarization, if enabled, adds $0.72. Replacing 30% of LLM traffic with Sonnet at $2/M input and $10/M output adds about $0.20 under identical token assumptions. Sonnet is billed per token, not per audio minute. Reasoning tokens, longer answers, parallel audio streams, add-ons, and retries can change these totals. INR exchange rates and tax treatment are not verified here.

## Context fixes added after the initial PR

- The client requested includeLastAnswer but the state implementation ignored it. Completed suggestions are now included only when requested, clearly labelled as AI text, never candidate speech.
- Both hint transports use the same context builder: complete current question, up to 12 recent speech turns plus one suggestion, and a 24,000-character history budget. Whole older turns are omitted when they do not fit; retained code is not clipped at 300 characters.
- Both transports use the same style/tier output budgets.
- Metadata-only diagnostics add assembled context character counts and attempt indexes. Blocking request usage is recorded when provided, including repair requests; missing streaming token usage is null rather than a misleading zero. No transcript, resume, question, or key is logged.

## Patches in this branch

- Windows transparent window starts and stays natively non-resizable; custom bounded resize IPC remains available. This avoids the documented native transparency/resizability conflict. Actual Windows drag/collapse rendering remains unverified.
- Short explicit format requests such as draw/show the snippet/explain architecture refine the current question.
- Coding/design stream budget grows from 900 to 2,400 tokens; concise strong requests retain 1,800 rather than 650. Simple questions keep their existing budget. Concise instructions now require complete requested code/design.
- Definition answers lead with a direct definition instead of being instructed to start mid-thought and avoid definitions.

## Required acceptance before another release

Replay fragmented definitions, topic changes, duplicate STT, coding corrections and short follow-ups through capture and generation. Benchmark the same input/context with the same provider against the working release. Record selected model, TTFT, completion/truncation status, capture-to-answer latency and cost without storing private transcript content in diagnostics. Verify Windows collapse/drag/expand/resize, page zoom, microphone and system playback on a real device. The microphone manual-confirm policy is unchanged; evaluate an explicit automatic microphone option separately, since microphone diarization cannot reliably identify interviewer vs candidate by itself.

## Sources checked

- https://www.electronjs.org/docs/latest/tutorial/custom-window-styles
- https://releases.electronjs.org/pr/51175
- https://ai.google.dev/gemini-api/docs/pricing
- https://ai.google.dev/gemini-api/docs/zdr
- https://deepgram.com/pricing
- https://openrouter.ai/docs/api/api-reference/api-keys/create-keys

