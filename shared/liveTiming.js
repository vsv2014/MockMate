// Keep the browser's hard backstop comfortably above the server's per-provider
// deadline. With the default three-provider BYOK setup, every configured family
// gets a real attempt before the UI aborts the request.
//
// LIVE_PROVIDER_ATTEMPT_TIMEOUT_MS is a time-to-first-token budget: a provider that
// has not produced any answer text by then is abandoned so failover can still run.
// It does not limit how long a healthy answer may keep streaming.
export const LIVE_PROVIDER_ATTEMPT_TIMEOUT_MS = 11_000
export const LIVE_HINT_OVERALL_TIMEOUT_MS = 40_000

// Once answer text is flowing the attempt can no longer fail over, so only a stall
// ends it: no new text for this long. Normal gaps between streamed tokens are well
// under a second, so long answers are never cut off for being long.
export const LIVE_STREAM_STALL_TIMEOUT_MS = 8_000

// Browser-side stall backstop after the first token: the server stall timeout plus
// margin for the SSE hop, so the server normally reports a stall first.
export const LIVE_HINT_STALL_TIMEOUT_MS = 12_000
