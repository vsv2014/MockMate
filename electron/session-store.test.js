import { beforeEach, afterEach, describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
const require = createRequire(import.meta.url)
const { SessionStore } = require('./session-store.cjs')
let folder, store
const key = Buffer.alloc(32,7)
const entry = { id:'one',ts:100,report:{ overallScore:null },transcript:[],captureStatus:'provisional',label:'Private Company' }
beforeEach(() => { folder=mkdtempSync(path.join(tmpdir(),'mm-sqlite-')); store=new SessionStore(path.join(folder,'sessions.db'),key) })
afterEach(() => { try { store.close() } catch {} rmSync(folder,{ recursive:true,force:true }) })
describe('transactional encrypted desktop sessions', () => {
  it('recovers candidate capture across a database reopen and keeps scopes separate', () => {
    store.save('guest',entry)
    store.append('guest','one',[{ id:'turn',seq:0,role:'candidate',text:'Private spoken answer' }])
    store.close(); store=new SessionStore(path.join(folder,'sessions.db'),key)
    expect(store.get('guest','one').captureStatus).toBe('interrupted')
    expect(store.get('guest','one').transcript[0].text).toBe('Private spoken answer')
    expect(store.list('other').sessions).toEqual([])
    const raw=Buffer.concat([readFileSync(path.join(folder,'sessions.db')),readFileSync(path.join(folder,'sessions.db-wal'))]).toString()
    expect(raw).not.toContain('Private spoken answer'); expect(raw).not.toContain('Private Company')
  })
  it('rolls back a whole batch if one turn is invalid and keeps earlier committed material', () => {
    store.save('guest',entry)
    store.append('guest','one',[{ id:'old',seq:0,role:'candidate',text:'Earlier' }])
    expect(() => store.append('guest','one',[{ id:'new',seq:1,role:'candidate',text:'New' },{ id:'invalid',seq:2,role:'hint',text:'not speech' }])).toThrow('invalid_turn')
    expect(store.get('guest','one').transcript.map(t => t.text)).toEqual(['Earlier'])
  })
  it('imports old and unscored rows without age/cap pruning and replay is idempotent', () => {
    const rows=Array.from({ length:70 },(_,i) => ({ ...entry,id:`old-${i}`,ts:i+1 }))
    const raw=JSON.stringify(rows)
    expect(store.import('guest','mm-sessions::guest',raw).count).toBe(70)
    expect(store.import('guest','mm-sessions::guest',raw).repeated).toBe(true)
    expect(store.list('guest').total).toBe(70)
    expect(() => store.import('guest','mm-sessions::guest','[]')).toThrow('legacy_source_changed')
    expect(store.list('guest').total).toBe(70)
  })
  it('does not commit partial imports or an import marker on validation failure', () => {
    const invalid=JSON.stringify([entry,{ id:'invalid',ts:0 }])
    expect(() => store.import('guest','mm-sessions::guest',invalid)).toThrow('invalid_session')
    expect(store.list('guest').total).toBe(0)
    expect(store.import('guest','mm-sessions::guest',JSON.stringify([entry])).verified).toBe(true)
  })
  it('rejects quota overflow without deleting sessions and applies capture quotas transactionally', () => {
    store.close(); store=new SessionStore(path.join(folder,'sessions.db'),key,{ maxSessions:1,maxSessionBytes:400,maxOwnerBytes:800 })
    store.save('guest',entry)
    expect(() => store.save('guest',{ ...entry,id:'two' })).toThrow('session_count_limit')
    expect(() => store.append('guest','one',[{ id:'large',seq:0,role:'candidate',text:'x'.repeat(1000) }])).toThrow('storage_budget_exceeded')
    expect(store.get('guest','one').transcript).toEqual([])
    expect(store.list('guest').total).toBe(1)
  })
  it('updates the same run, retains final report, rejects late capture and deletes only that scope', () => {
    store.save('guest',entry); store.save('other',entry)
    store.save('guest',{ ...entry,captureStatus:'captured',report:{ overallScore:80 },transcript:[{ role:'candidate',text:'Final' }] })
    expect(store.list('guest').total).toBe(1)
    expect(store.get('guest','one').report.overallScore).toBe(80)
    expect(() => store.append('guest','one',[])).toThrow('capture_already_finalized')
    store.purge('guest'); expect(store.list('guest').total).toBe(0); expect(store.list('other').total).toBe(1)
  })
  it('reports physical disk capacity failure and keeps the previous committed row', () => {
    store.save('guest',entry)
    const pages=store.db.prepare('PRAGMA page_count').get().page_count
    store.db.exec(`PRAGMA max_page_count=${pages}`)
    expect(() => store.save('guest',{ ...entry,id:'full',transcript:[{ role:'candidate',text:'x'.repeat(100_000) }] })).toThrow()
    expect(store.list('guest').total).toBe(1)
    expect(store.get('guest','one').label).toBe('Private Company')
  })
  it('paginates beyond 100 rows without pruning and does not include private bodies in summaries', () => {
    for (let i=0;i<101;i++) store.save('guest',{ ...entry,id:`row-${i}`,ts:i+1,transcript:[{ text:'Private answer' }] })
    expect(store.list('guest').sessions).toHaveLength(100)
    expect(store.list('guest').total).toBe(101)
    expect(store.list('guest',100).sessions).toHaveLength(1)
    expect(JSON.stringify(store.list('guest'))).not.toContain('Private answer')
  })
  it('refuses a newer schema without resetting it', () => {
    store.db.exec('PRAGMA user_version=99'); store.close()
    expect(() => new SessionStore(path.join(folder,'sessions.db'),key)).toThrow('schema_too_new')
  })
})


describe('desktop persistence selection', () => {
  it('selects SQLite without an opt-in flag and permits only an explicit legacy override', async () => {
    const main=readFileSync(new URL('./main.cjs',import.meta.url),'utf8')
    const start=main.indexOf("ipcMain.handle('session-store'")
    const source=main.slice(start,main.indexOf("ipcMain.handle('auth-get-token'",start))
    const mainFrame={},webContents={mainFrame}
    const scope={ mainWindow:{webContents},process:{env:{}},ipcMain:{handle(_name,fn){this.handler=fn}} }
    vm.runInNewContext(source,scope)
    const event={sender:webContents,senderFrame:mainFrame}
    expect(await scope.ipcMain.handler(event,{op:'status'})).toEqual({enabled:true})
    scope.process.env.MOCKMATE_SQLITE_PILOT='0'
    expect(await scope.ipcMain.handler(event,{op:'status'})).toEqual({enabled:false})
    expect(await scope.ipcMain.handler({sender:webContents,senderFrame:{}},{op:'status'})).toEqual({ok:false,code:'untrusted_sender'})
  })
})
