# Production diagnostics

MockMate writes privacy-safe structured events to:

`%APPDATA%\mockmate\logs\diagnostics.jsonl` on Windows.

The logger is buffered and best-effort: renderer actions enqueue metadata, Electron flushes in the
background every 500 ms, and no logging failure is allowed to block audio, screenshots or answers.
Files rotate at 5 MB and retain four generations (about 20 MB maximum).

## Correlation

- `sessionId` identifies a Live/Solo session.
- `requestId` identifies one API, auth or screenshot operation.
- Provider attempts include operation, provider, model, status class, duration, TTFT and usage.

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

Settings provides **Export logs** and **Clear**. Export creates a shareable JSONL bundle with a
privacy declaration plus the rotated event history. Clearing diagnostics does not delete interview
history.

## Future deep-debug mode

Raw transcript/question/answer capture must be a separate, explicit one-session QA mode that turns
off automatically and expires quickly. It must never be silently enabled by standard diagnostics.
