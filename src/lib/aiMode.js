// AI mode — managed-vs-BYOK, persisted per signed-in account.
import { getScopedItem, setScopedItem } from './accountScope'

export const MANAGED_AVAILABLE = String(import.meta.env?.VITE_MANAGED_AI_AVAILABLE || '').toLowerCase() === 'true'
const KEY = 'mm-ai-mode'
const GUEST_ACTIVE = 'mm-guest-active'
const GUEST_PREVIOUS = 'mm-guest-previous-ai-mode'

export function isGuestMode() {
  try { return localStorage.getItem(GUEST_ACTIVE) === '1' } catch { return false }
}

export function setGuestMode(active, previousMode = null) {
  try {
    if (active) {
      if (previousMode) localStorage.setItem(GUEST_PREVIOUS, previousMode === 'byok' ? 'byok' : 'managed')
      localStorage.setItem(GUEST_ACTIVE, '1')
    } else {
      const previous = localStorage.getItem(GUEST_PREVIOUS)
      localStorage.removeItem(GUEST_ACTIVE)
      localStorage.removeItem(GUEST_PREVIOUS)
      if (previous && MANAGED_AVAILABLE) setScopedItem(KEY, previous === 'byok' ? 'byok' : 'managed')
    }
  } catch {}
}

export function getAiMode() {
  if (!MANAGED_AVAILABLE || isGuestMode()) return 'byok'
  const mode = getScopedItem(KEY, 'managed')
  return mode === 'byok' ? 'byok' : 'managed'
}

export function setAiMode(mode) {
  // A guest has no managed JWT. Refuse a UI/settings toggle that would otherwise put the app
  // into a permanently failing managed mode until the user signs in again.
  if (isGuestMode()) return setScopedItem(KEY, 'byok')
  return setScopedItem(KEY, MANAGED_AVAILABLE && mode !== 'byok' ? 'managed' : 'byok')
}

export const isManaged = () => MANAGED_AVAILABLE && !isGuestMode() && getAiMode() === 'managed'
