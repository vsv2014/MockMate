import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadSessionsAsync, saveSessionAsync } from '../history.js'
import { activeAccountScope } from './accountScope.js'

let request, local, scopes
beforeEach(() => {
  local=new Map(); scopes=new Map()
  vi.stubGlobal('localStorage',{ getItem:key => local.get(key) ?? null,setItem:(key,value) => local.set(key,String(value)),removeItem:key => local.delete(key) })
  vi.stubGlobal('sessionStorage',{ getItem:key => scopes.get(key) ?? null,setItem:(key,value) => scopes.set(key,value),removeItem:key => scopes.delete(key) })
  request=vi.fn(async ({op}) => op==='status' ? { enabled:true } : op==='import' ? { enabled:true,ok:true,value:{ verified:true } } : op==='get' ? { enabled:true,ok:true,value:null } : { enabled:true,ok:true,value:{ sessions:[],total:0 } })
  vi.stubGlobal('window',{ electronAPI:{ sessionStore:{ request } } })
})
afterEach(() => vi.unstubAllGlobals())
describe('desktop SQLite adapter boundary', () => {
  it('uses the raw legacy array without calling the age/pruning reader or deleting source', async () => {
    const raw=JSON.stringify([{ id:'old',ts:1,transcript:[],report:{ overallScore:null } }])
    local.set('mm-sessions::guest',raw)
    await loadSessionsAsync()
    const imported=request.mock.calls.find(([arg]) => arg.op==='import')?.[0]
    expect(imported.raw).toBe(raw)
    expect(local.get('mm-sessions::guest')).toBe(raw)
  })
  it('does not downgrade a failed SQLite save into a localStorage write', async () => {
    request.mockImplementation(async ({op}) => op==='status' ? { enabled:true } : op==='save' ? { enabled:true,ok:false,code:'disk_full' } : { enabled:true,ok:true,value:null })
    expect(await saveSessionAsync({ runId:'sqlite-run',report:{ overallScore:80 },transcript:[] })).toBeNull()
    expect(local.has('mm-sessions::guest')).toBe(false)
  })
  it('does not write an old-account request after scope changes during the status await', async () => {
    request.mockImplementation(async () => { scopes.set('mm-active-account-scope','new-account'); return { enabled:true } })
    expect(activeAccountScope()).toBe('guest')
    expect(await saveSessionAsync({ runId:'old',report:{ overallScore:1 } })).toBeNull()
    expect(request).toHaveBeenCalledTimes(1)
  })
})
