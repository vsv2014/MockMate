# Production diagnostics

MockMate writes privacy-safe structured events to:

`%APPDATA%\mockmate\logs\diagnostics.jsonl` on Windows.

The logger is buffered and best-effort: renderer actions enqueue metadata, Electron flushes in the
background every 500 ms, and no logging failure is allowed to block audio, screenshots or answers.
Files rotate at 5 MB and retain four generations (about 20 MB maximum).

## Correlation

- `sessionId` identifies a Live/Solo session.
- `requestId` identifies one API, auth or screenshot operation.
- Provider attempts include operation, provider, model, status class, duration, TTFT and usage. They also carry `attemptIndex` (0 for the first provider tried; higher values are fallbacks) and `contextChars`, the length of the JSON-serialized request messages including the system prompt. `contextChars` is a size signal, not a token count.
- Blocking JSON calls emit `request_usage` for each successful provider request in an attempt, including JSON-repair requests. `requestIndex` numbers every request in the attempt from 0, failed retries included, so a value above 0 means a retry or JSON repair happened. Token counts a provider does not return are recorded as `null` (unknown), never `0`.
- Streamed `attempt_timed_out` events carry `timeoutKind`:
  - `first_token`: no answer text before the per-provider budget, so failover runs.
  - `stall`: no new text for the stall window after the answer had started; the partial answer is kept.
- `thinking_setting_rejected` means Anthropic refused the low-latency thinking setting for a model, and the request was retried once without it.
- Live `speculative_hint` events record the early answer start: `outcome` (`started`, `claimed` or `cancelled`), `reason` and `phase` for cancellations, `leadMs` for how far ahead a claimed request started, and `ageMs` for cancelled ones. They never include question or answer text. Setting `localStorage['mm-live-early-answer']` to `'0'` disables the feature for troubleshooting.

## Covered events

- App/backend startup and shutdown
- Authentication request outcome and timeout (never the JWT)
- API route, method, mode, status and latency (never request bodies)
- Deepgram grant/fallback, socket, reconnect, confidence and degradation
- LLM attempt correlation and terminal lifecycle (success, failure, timeout or cancellation),
  including provider-family fallback counts in the final session summary
- Session question capture/reject, generation cancellation, TTFT and summary counters
- Screenshot request, dimensions, continuation/cache/outcome (never image or OCR content)
- LLM provider/model attempt, failover class, TTFT and token counts
- Model discovery/selection reason, embedding dimensions and RAG document/chunk/hit counts
- Audio source lane, model, confidence and buffered/dropped byte counts (never audio content)
- Auto-update availability/download/check/errors

## Privacy contract

Both renderer and Electron redact. The following are excluded: API keys, authorization headers,
tokens, passwords, cookies, secrets, credentials, résumé, transcripts, prompts, full answers,
screenshot/base64 data and audio. Strings, arrays, nesting, event size and queue size are bounded.

Settings provides **Export logs** and **Clear**, plus the **ARCH · Product Intelligence** inspector
(`shared/productIntelligence.js`, `src/components/ProductIntelligencePanel.jsx`), which summarizes
redacted funnel conversion (`live_interview`, `solo_practice`, `screen_solve`), sequence patterns
(such as `overlay_resize → teleprompter_toggle`), rage clicks, and closed-loop `ARCH` latency
promotions (`reasoningPolicy` promoting `'balanced'` to `'fast'` when `p95` TTFT breaches the
declarative `arch/mockmate.abl.json` threshold). Interaction breadcrumb replay is **OFF** by default
and requires explicit opt-in in Settings. Clearing diagnostics does not delete interview history.

## Future deep-debug mode

Raw transcript/question/answer capture must be a separate, explicit one-session QA mode that turns
off automatically and expires quickly. It must never be silently enabled by standard diagnostics.
