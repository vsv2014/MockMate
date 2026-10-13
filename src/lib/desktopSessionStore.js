import { activeAccountScope, scopedKey } from './accountScope.js'
const imported = new Map()
export async function sqliteEnabled() {
  const api = typeof window !== 'undefined' && window.electronAPI?.sessionStore
  if (!api) return false
  const result = await api.request({ op:'status' })
  if (result?.ok === false) throw new Error(result.code || 'sqlite_unavailable')
  return result?.enabled === true
}
export async function sqliteRequest(op, args = {}, scope = activeAccountScope()) {
  if (new TextEncoder().encode(JSON.stringify(args)).length > 32*1024*1024) throw new Error('payload_too_large')
  const result = await window.electronAPI.sessionStore.request({ ...args,op,scope })
  if (!result?.ok) throw Object.assign(new Error(result?.code || 'sqlite_unavailable'),{ code:result?.code || 'sqlite_unavailable' })
  if (scope !== activeAccountScope()) throw Object.assign(new Error('account_changed'),{ code:'account_changed' })
  return result.value
}
export async function ensureLegacyImport(scope = activeAccountScope()) {
  if (imported.has(scope)) return imported.get(scope)
  const task = (async () => {
    const raw = localStorage.getItem(scopedKey('mm-sessions',scope)) || '[]'
    return sqliteRequest('import',{ sourceKey:scopedKey('mm-sessions',scope),raw },scope)
  })()
  imported.set(scope,task)
  try { return await task } catch (error) { imported.delete(scope); throw error }
}
export async function appendCapturedTurns(runId, turns, scope) {
  if (!await sqliteEnabled()) return { enabled:false }
  await ensureLegacyImport(scope)
  return sqliteRequest('append',{ runId,turns },scope)
}
