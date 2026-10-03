// AI mode — managed-vs-BYOK, persisted per signed-in account.
import { getScopedItem, setScopedItem } from './accountScope'

export const MANAGED_AVAILABLE = String(import.meta.env?.VITE_MANAGED_AI_AVAILABLE || '').toLowerCase() === 'true'
const KEY = 'mm-ai-mode'

export function getAiMode() {
  if (!MANAGED_AVAILABLE) return 'byok'
  const mode = getScopedItem(KEY, 'managed')
  return mode === 'byok' ? 'byok' : 'managed'
}
export function setAiMode(mode) {
  setScopedItem(KEY, MANAGED_AVAILABLE && mode !== 'byok' ? 'managed' : 'byok')
}
export const isManaged = () => MANAGED_AVAILABLE && getAiMode() === 'managed'
