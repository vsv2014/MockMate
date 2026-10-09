// Safe recovery of account-scoped local JSON arrays.
//
// Corrupt or partially written JSON was previously interpreted as an empty
// collection. The next save would silently replace the only surviving bytes
// of a user's sessions/documents. Preserve those bytes in the *same* account
// scope before permitting a replacement. A different pre-existing backup
// must never be overwritten by a second corruption event.
import { getScopedItem, setScopedItem } from './accountScope.js'

export function readScopedArrayWithRecovery(key, backupKey) {
  const raw = getScopedItem(key, null)
  if (raw === null) return { items: [], writable: true, corrupted: false }
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) {
      return { items: parsed, writable: true, corrupted: false }
    }
  } catch {
    // The original text is still available below for backup.
  }
  const prior = getScopedItem(backupKey, null)
  const backedUp = prior === raw || (prior === null && setScopedItem(backupKey, raw))
  return { items: [], writable: Boolean(backedUp), corrupted: true }
}
