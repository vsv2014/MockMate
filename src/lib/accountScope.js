// Account-scoped local persistence for desktop renderer state.
// The active account id is tab/session scoped; durable data is stored under keys suffixed with that id.
// Legacy unscoped keys are migrated once into the first authenticated account that opens the app.
const ACTIVE_SCOPE_KEY = 'mm-active-account-scope'
const MIGRATION_VERSION = '2'
const LEGACY_KEYS = [
  'peerMockProfile', 'mm-docs', 'mm-sessions', 'mm-ai-mode', 'mm-answer-style',
  'mm-screenshot-speed', 'mm-auto-skip', 'mm-doc-threshold', 'llmProvider',
]

function cleanScope(value) {
  const s = String(value || '').trim()
  return s ? s.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 160) : 'guest'
}

export function activeAccountScope() {
  try { return cleanScope(sessionStorage.getItem(ACTIVE_SCOPE_KEY) || 'guest') } catch { return 'guest' }
}

export function scopedKey(base, scope = activeAccountScope()) {
  return `${base}::${cleanScope(scope)}`
}

export function setActiveAccountScope(userId) {
  const scope = cleanScope(userId || 'guest')
  try { sessionStorage.setItem(ACTIVE_SCOPE_KEY, scope) } catch {}
  if (scope !== 'guest') migrateLegacyState(scope)
  return scope
}

export function clearActiveAccountScope() {
  try { sessionStorage.removeItem(ACTIVE_SCOPE_KEY) } catch {}
}

export function migrateLegacyState(scope = activeAccountScope()) {
  if (!scope || scope === 'guest') return false
  try {
    const marker = `mm-storage-migration::${scope}`
    if (localStorage.getItem(marker) === MIGRATION_VERSION) return false
    for (const key of LEGACY_KEYS) {
      const oldValue = localStorage.getItem(key)
      const nextKey = scopedKey(key, scope)
      if (oldValue !== null && localStorage.getItem(nextKey) === null) localStorage.setItem(nextKey, oldValue)
      if (oldValue !== null) localStorage.removeItem(key)
    }
    localStorage.setItem(marker, MIGRATION_VERSION)
    return true
  } catch { return false }
}

export function getScopedItem(base, fallback = null) {
  try {
    const value = localStorage.getItem(scopedKey(base))
    return value === null ? fallback : value
  } catch { return fallback }
}

export function setScopedItem(base, value) {
  try { localStorage.setItem(scopedKey(base), String(value)); return true } catch { return false }
}

export function removeScopedItem(base) {
  try { localStorage.removeItem(scopedKey(base)); return true } catch { return false }
}
