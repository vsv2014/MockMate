// AI mode — managed-vs-BYOK, persisted locally.
//
// Managed AI is LIVE (default). Locally it auto-routes across the keys the server is configured
// with (no key entry / no model picker in the UI). The hosted proxy (2b) swaps those for
// MockMate's own keys + metering so end users need nothing — same client experience.
export const MANAGED_AVAILABLE = true

const KEY = 'mm-ai-mode'

export function getAiMode() {
  try { return localStorage.getItem(KEY) === 'byok' ? 'byok' : 'managed' } catch { return 'managed' }
}
export function setAiMode(mode) {
  try { localStorage.setItem(KEY, mode === 'byok' ? 'byok' : 'managed') } catch {}
}
export const isManaged = () => MANAGED_AVAILABLE && getAiMode() === 'managed'
