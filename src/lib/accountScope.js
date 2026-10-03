// Account-scoped local persistence for desktop renderer state.
const ACTIVE_SCOPE_KEY = 'mm-active-account-scope'
const STORAGE_SCHEMA_VERSION = 3
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

export function scopedKey(base, scope = activeAccountScope()) { return `${base}::${cleanScope(scope)}` }

export function setActiveAccountScope(userId) {
  const scope = cleanScope(userId || 'guest')
  try { sessionStorage.setItem(ACTIVE_SCOPE_KEY, scope) } catch {}
  if (scope !== 'guest') migrateLegacyState(scope)
  return scope
}

export function clearActiveAccountScope() {
  try { sessionStorage.removeItem(ACTIVE_SCOPE_KEY) } catch {}
}

function safeJson(value, fallback) {
  try { return JSON.parse(value) } catch { return fallback }
}

function migrateVersion(scope, fromVersion) {
  // v1→v2: move installation-global renderer state into the authenticated account namespace.
  if (fromVersion < 2) {
    for (const key of LEGACY_KEYS) {
      const oldValue = localStorage.getItem(key)
      const nextKey = scopedKey(key, scope)
      if (oldValue !== null && localStorage.getItem(nextKey) === null) localStorage.setItem(nextKey, oldValue)
      if (oldValue !== null) localStorage.removeItem(key)
    }
  }
  // v2→v3: normalize containers so corrupted/old shapes cannot poison newer readers.
  if (fromVersion < 3) {
    for (const key of ['mm-docs', 'mm-sessions']) {
      const full = scopedKey(key, scope)
      const raw = localStorage.getItem(full)
      if (raw !== null && !Array.isArray(safeJson(raw, null))) localStorage.setItem(full, '[]')
    }
    const modeKey = scopedKey('mm-ai-mode', scope)
    const mode = localStorage.getItem(modeKey)
    if (mode !== null && !['managed', 'byok'].includes(mode)) localStorage.setItem(modeKey, 'byok')
  }
}

export function migrateLegacyState(scope = activeAccountScope()) {
  if (!scope || scope === 'guest') return false
  try {
    const marker = `mm-storage-schema::${scope}`
    const fromVersion = Math.max(0, Number(localStorage.getItem(marker) || 0))
    if (fromVersion >= STORAGE_SCHEMA_VERSION) return false
    migrateVersion(scope, fromVersion)
    localStorage.setItem(marker, String(STORAGE_SCHEMA_VERSION))
    // Retire the older one-shot marker after a successful schema migration.
    localStorage.removeItem(`mm-storage-migration::${scope}`)
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

export { STORAGE_SCHEMA_VERSION }
