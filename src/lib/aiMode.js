// AI mode — managed-vs-BYOK, persisted locally.
//
// Public builds only expose Managed AI when release CI baked a hosted endpoint into the app.
// Local developers can opt in with VITE_MANAGED_AI_AVAILABLE=true.
export const MANAGED_AVAILABLE = String(import.meta.env?.VITE_MANAGED_AI_AVAILABLE || '').toLowerCase() === 'true'

const KEY = 'mm-ai-mode'

export function getAiMode() {
  if (!MANAGED_AVAILABLE) return 'byok'
  try { return localStorage.getItem(KEY) === 'byok' ? 'byok' : 'managed' } catch { return 'managed' }
}
export function setAiMode(mode) {
  try { localStorage.setItem(KEY, MANAGED_AVAILABLE && mode !== 'byok' ? 'managed' : 'byok') } catch {}
}
export const isManaged = () => MANAGED_AVAILABLE && getAiMode() === 'managed'
