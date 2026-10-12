# Small trial and regression review — 2026-10-12

## Recommendation

For 3–4 invited users, offer Managed AI backed by the existing authenticated backend, keeping BYOK as an optional alternative. Use one owner-funded paid Gemini project and Deepgram project initially. Do not distribute a shared master key in the installer. Provider keys identify accounts/projects; model access is resolved separately. Retiring a model normally requires a registry update, not generating another key.

BYOK is the lowest-hosting-effort option today and costs the app owner nothing for provider usage, but every tester must configure and fund accounts. Managed access gives consistent routing, centralized rotation and better diagnosis. OpenRouter is a useful later model-comparison option with per-key USD limits; it adds another dependency and still needs separate STT. Local models add hardware variability and are a poor default for this small Windows trial.

## Existing implementation and missing work

The backend already includes authentication, LLM usage metering and a Deepgram gateway with atomic audio quota reservations. Current plan caps are unsuitable for a focused trial: free allows only 30 minutes of STT, while pro/max allow 500 hours and 100,000 LLM units. Add an explicit invite-only trial entitlement, expiry, one active session per user and a total owner budget with admission reservations before enabling shared credentials. Call counts are not exact dollar budgets.

The unsigned installer explicitly sets managedApiBase empty and VITE_MANAGED_AI_AVAILABLE=false. Managed trial needs an independently validated hosted configuration and a new package; existing public download cannot gain managed support merely by setting server keys. No hosted setup or paid account was provisioned during this review.

## Initial provider candidate and cost model

Benchmark Gemini 3.8 Flash for answers; keep Deepgram Nova-3 for the first trial so speech and LLM changes can be measured separately. This is a candidate, not a claim of best measured quality. Use the paid Gemini tier for its documented training restriction; it is not a blanket zero-retention guarantee.

At checked promotional rates, Gemini 3.8 Flash is $0.75/M input and $3.75/M output tokens through December 31, 2026. Nova-3 monolingual streaming is $0.0048/min before add-ons. For 40 questions/hour, 8,000 input tokens/question and 800 billed output tokens/question: LLM $0.36/hour plus STT $0.288/hour = $0.648/hour. Four users at ten hours each = $25.92 usage. Allow $30–50 as a planning envelope, excluding hosting, taxes, add-ons, search, extra reasoning tokens, retries and long context. This is not a spending authorization or a measured bill. Recalculate when promotions end.

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

