// Keep the browser's hard backstop comfortably above the server's per-provider
// deadline. With the default three-provider BYOK setup, every configured family
// gets a real attempt before the UI aborts the request.
export const LIVE_PROVIDER_ATTEMPT_TIMEOUT_MS = 11_000
export const LIVE_HINT_OVERALL_TIMEOUT_MS = 40_000

