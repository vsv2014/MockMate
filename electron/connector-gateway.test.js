import { describe, it, beforeEach } from 'vitest'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const assert = require('node:assert/strict')
const { mkdtempSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const path = require('node:path')
const { createConnectorGateway, normalizedText, sourceCheck } = require('./connector-gateway.cjs')
let dir, gateway, requests
function fakeResponse(object, status = 200) {
  return new Response(JSON.stringify(object), { status, headers: { 'content-type': 'application/json' } })
}
function init() {
  dir = mkdtempSync(path.join(tmpdir(), 'mockmate-connectors-'))
  requests = []
  const safeStorage = { isEncryptionAvailable: () => true,
    encryptString: s => Buffer.from('encrypted:' + s),
    decryptString: buf => { const text = buf.toString(); if (!text.startsWith('encrypted:')) throw Error('corrupted'); return text.slice(10) },
  }
  gateway = createConnectorGateway({
    userData: dir, safeStorage, openExternal: async () => {},
    fetchImpl: async (url, options) => {
      requests.push({ url, options })
      if (url.includes('/login/device/code')) return fakeResponse({
        device_code: 'dc', user_code: 'ABC-123', expires_in: 900, interval: 5,
      })
      if (url.includes('/login/oauth/access_token')) return fakeResponse({
        access_token: 'secret-example', token_type: 'bearer', scope: 'read:user',
      })
      if (url === 'https://api.github.com/user') return fakeResponse({ id: 1234, login: 'dev' })
      if (url === 'https://api.github.com/repos/acme/repo') return fakeResponse({ default_branch: 'main' })
      if (url.includes('/repos/acme/repo/git/trees/main')) return fakeResponse({
        tree: [{ path: 'README.md', type: 'blob', sha: 'sha1', size: 100 },
          { path: 'secrets.env', type: 'blob', size: 100 }, { path: 'huge.md', type: 'blob', size: 300000 }],
      })
      if (url.includes('/repos/acme/repo/contents/README.md')) return fakeResponse({
        type: 'file', name: 'README.md', size: 70, sha: 'sha1', encoding: 'base64',
        content: Buffer.from('This is a test description of backend architecture.').toString('base64'),
      })
      throw new Error('Unexpected endpoint: ' + url)
    },
  })
}
describe('native connected account security and sync', () => {
  beforeEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); init() })
  it('never accepts unsafe source paths or unsupported formats', () => {
    assert.throws(() => sourceCheck('github', 'acme/repo:../../env.txt'))
    assert.throws(() => sourceCheck('googledrive', 'bad/../id'))
    assert.throws(() => sourceCheck('googlecalendar', 'bad:event:other'))
    assert.throws(() => normalizedText('x\0y'))
  })
  it('authorizes device flow and keeps connected credentials out of account metadata', async () => {
    const { flowId, userCode } = await gateway.startGithub('account-a', 'Iv1abcdef12345')
    assert.equal(userCode, 'ABC-123')
    const result = await gateway.pollFlow('account-a', flowId)
    assert.equal(result.status, 'connected')
    assert.equal(result.account.label, 'dev')
    assert.equal(JSON.stringify(gateway.state('account-a')).includes('secret-example'), false)
    assert.deepEqual(gateway.state('account-b').accounts, [])
    const accountId = result.account.id
    assert.throws(() => gateway.setActive('account-b', 'github', accountId))
    await assert.rejects(gateway.verifyAccount('account-b', 'github', accountId), /not owned/)
    const verified = await gateway.verifyAccount('account-a', 'github', accountId)
    assert.equal(verified.ok, true)
    assert.equal(verified.account.subject, '1234')
    assert.equal(JSON.stringify(verified).includes('secret-example'), false)
    const listed = await gateway.listSources('account-a', 'github', accountId, 'acme/repo')
    assert.deepEqual(listed.sources.map(x => x.title), ['README.md'])
    const item = await gateway.readSource('account-a', 'github', accountId, listed.sources[0].sourceId)
    assert.match(item.text, /backend architecture/)
    gateway.subscribe('account-a', { importId: 'imp_123abc', provider: 'github', accountId,
      sourceId: item.sourceId, sha256: 'a'.repeat(64) })
    const sync = await gateway.syncNow('account-a')
    assert.equal(sync.updates.length, 1)
    gateway.acknowledgeSync('account-a', 'imp_123abc', sync.updates[0].sha256)
    assert.equal((await gateway.syncNow('account-a')).updates.length, 0)
    gateway.setLivePaused(true)
    assert.equal((await gateway.syncNow('account-a')).paused, true)
    gateway.setLivePaused(false)
    gateway.removeAccount('account-a', 'github', accountId)
    assert.deepEqual(gateway.state('account-a').subscriptions, [])
    gateway.purgeOwner('account-a')
    assert.deepEqual(gateway.state('account-a').accounts, [])
  })
  it('fairly rotates more than 30 approved subscriptions and persists sync progress', async () => {
    const { flowId } = await gateway.startGithub('account-a', 'Iv1abcdef12345')
    const connected = await gateway.pollFlow('account-a', flowId)
    const accountId = connected.account.id
    for (let i = 0; i < 35; i++) {
      gateway.subscribe('account-a', {
        importId: 'imp_batch_' + i, provider: 'github', accountId,
        sourceId: 'acme/repo:README.md', sha256: 'a'.repeat(64),
      })
    }
    const first = await gateway.syncNow('account-a')
    assert.equal(first.checked, 30)
    assert.equal(first.deferred, 5)
    assert.equal(first.updates.length, 30)
    const second = await gateway.syncNow('account-a')
    assert.equal(second.checked, 30)
    assert.equal(second.deferred, 5)
    const visited = new Set([...first.updates, ...second.updates].map(x => x.importId))
    assert.equal(visited.size, 35, 'sources outside the initial batch must not starve')
    const subscription = gateway.state('account-a').subscriptions.find(s => s.importId === 'imp_batch_34')
    assert.ok(subscription.lastCheckedAt)
    assert.equal(subscription.lastError, null)
    assert.ok(subscription.pendingSha)
    assert.throws(() => gateway.acknowledgeSync('account-a', 'imp_batch_34', 'b'.repeat(64)),
      /outdated source revision/)
    gateway.acknowledgeSync('account-a', 'imp_batch_34', subscription.pendingSha)
    const applied = gateway.state('account-a').subscriptions.find(s => s.importId === 'imp_batch_34')
    assert.ok(applied.lastSyncedAt)
    assert.equal(applied.indexStatus, 'rebuild_on_retrieval')
    assert.equal(applied.pendingSha, null)
  })

  it('persists a source-specific, safe failure status instead of reporting a successful sync', async () => {
    const { flowId } = await gateway.startGithub('account-a', 'Iv1abcdef12345')
    const connected = await gateway.pollFlow('account-a', flowId)
    gateway.subscribe('account-a', {
      importId: 'imp_missing', provider: 'github', accountId: connected.account.id,
      sourceId: 'acme/repo:missing.md', sha256: 'a'.repeat(64),
    })
    const result = await gateway.syncNow('account-a')
    assert.equal(result.checked, 1)
    assert.equal(result.failures.length, 1)
    assert.equal(result.failures[0].code, 'fetch_failed')
    const sub = gateway.state('account-a').subscriptions[0]
    assert.equal(sub.lastErrorCode, 'fetch_failed')
    assert.ok(sub.lastCheckedAt)
    assert.equal(sub.lastSyncedAt, null)
    assert.equal(sub.pendingSha, undefined)
  })

  it('manually refreshes an auto-sync-disabled source without opting it into background polling', async () => {
    const { flowId } = await gateway.startGithub('account-a', 'Iv1abcdef12345')
    const connected = await gateway.pollFlow('account-a', flowId)
    const accountId = connected.account.id
    gateway.subscribe('account-a', { importId: 'imp_disabled', provider: 'github', accountId,
      sourceId: 'acme/repo:README.md', sha256: 'a'.repeat(64), autoSync: false })
    assert.equal((await gateway.syncNow('account-a')).checked, 0)
    const checked = await gateway.syncNow('account-a', { manual: true, importId: 'imp_disabled' })
    assert.equal(checked.checked, 1)
    assert.equal(checked.updates.length, 1)
    assert.equal(gateway.state('account-a').subscriptions[0].autoSync, false)
    assert.throws(() => gateway.acknowledgeSync('account-a', 'imp_disabled', 'a'.repeat(64)), /no matching pending/)
    gateway.acknowledgeSync('account-a', 'imp_disabled', checked.updates[0].sha256)
    assert.equal((await gateway.syncNow('account-a', { manual: true, importId: 'imp_disabled' })).updates.length, 0)
  })

  it('limits targeted refresh and cannot inspect another account or nonexistent import', async () => {
    const { flowId } = await gateway.startGithub('account-a', 'Iv1abcdef12345')
    const connected = await gateway.pollFlow('account-a', flowId)
    for (const id of ['imp_one', 'imp_two']) gateway.subscribe('account-a', {
      importId: id, provider: 'github', accountId: connected.account.id,
      sourceId: 'acme/repo:README.md', sha256: 'a'.repeat(64), autoSync: false })
    const baseline = requests.length
    const result = await gateway.syncNow('account-a', { manual: true, importId: 'imp_two' })
    assert.deepEqual(result.updates.map(x => x.importId), ['imp_two'])
    assert.equal(requests.length - baseline, 1)
    await assert.rejects(gateway.syncNow('account-b', { manual: true, importId: 'imp_two' }), /not connected/)
    await assert.rejects(gateway.syncNow('account-a', { manual: true, importId: 'imp_unknown' }), /not connected/)
  })

  it('persists local apply failure without storing raw exception or clearing the pending update', async () => {
    const { flowId } = await gateway.startGithub('account-a', 'Iv1abcdef12345')
    const connected = await gateway.pollFlow('account-a', flowId)
    gateway.subscribe('account-a', { importId: 'imp_apply', provider: 'github',
      accountId: connected.account.id, sourceId: 'acme/repo:README.md', sha256: 'a'.repeat(64) })
    await gateway.syncNow('account-a')
    const before = gateway.state('account-a').subscriptions[0]
    assert.ok(before.pendingSha)
    gateway.reportApplyFailure('account-a', 'imp_apply')
    const after = gateway.state('account-a').subscriptions[0]
    assert.equal(after.lastErrorCode, 'local_apply_failed')
    assert.match(after.lastError, /persistence failed/i)
    assert.equal(after.pendingSha, before.pendingSha)
    assert.equal(after.lastSyncedAt, null)
    assert.throws(() => gateway.reportApplyFailure('account-b', 'imp_apply'), /not found/)
  })

  it('completes Google Desktop PKCE callback with state verification and encrypted identity', async () => {
    const opened = []
    const safeStorage = {
      isEncryptionAvailable: () => true,
      encryptString: value => Buffer.from('safe:' + value),
      decryptString: buf => buf.toString().slice(5),
    }
    const google = createConnectorGateway({
      userData: dir, safeStorage,
      openExternal: async url => { opened.push(url) },
      fetchImpl: async url => {
        if (url === 'https://oauth2.googleapis.com/token') return fakeResponse({
          access_token: 'GOOGLE_PRIVATE_ACCESS_TOKEN', refresh_token: 'GOOGLE_PRIVATE_REFRESH',
          expires_in: 3600, scope: 'openid email profile',
        })
        if (url === 'https://www.googleapis.com/oauth2/v3/userinfo') return fakeResponse({
          sub: 'google-sub-123', email: 'dev@example.test',
        })
        throw Error('Unexpected external URL ' + url)
      },
    })
    try {
      const flow = await google.startGoogle('account-a', 'googledrive', '123456-mockmate.apps.googleusercontent.com')
      assert.equal(flow.status, 'pending')
      assert.equal(opened.length, 1)
      const auth = new URL(opened[0])
      assert.equal(auth.searchParams.get('code_challenge_method'), 'S256')
      assert.match(auth.searchParams.get('scope'), /drive.readonly/)
      const redirect = auth.searchParams.get('redirect_uri')
      assert.match(redirect, /^http:\/\/127\.0\.0\.1:[0-9]+\/oauth\/callback$/)
      const invalid = await fetch(redirect + '?state=wrong&code=invalid')
      assert.equal(invalid.status, 400)
      const good = await fetch(redirect + '?state=' + encodeURIComponent(auth.searchParams.get('state')) + '&code=authorized')
      assert.equal(good.status, 200)
      let result
      for (let i = 0; i < 25; i++) {
        result = await google.pollFlow('account-a', flow.flowId)
        if (result.status === 'connected') break
        await new Promise(resolve => setTimeout(resolve, 10))
      }
      assert.equal(result.status, 'connected')
      assert.equal(result.account.label, 'dev@example.test')
      const verified = await google.verifyAccount('account-a', 'googledrive', result.account.id)
      assert.equal(verified.account.subject, 'google-sub-123')
      assert.equal(JSON.stringify(verified).includes('GOOGLE_PRIVATE'), false)
      assert.deepEqual(google.state('account-b').accounts, [])
      assert.equal(JSON.stringify(google.state('account-a')).includes('GOOGLE_PRIVATE'), false)
    } finally { google.close() }
  })

  it('refuses plaintext token storage when OS encryption is not available', () => {
    const blocked = createConnectorGateway({ userData: dir, safeStorage: {
      isEncryptionAvailable: () => false,
    }, openExternal: async () => {} })
    assert.throws(() => blocked.state('account-a'), /encryption unavailable/)
  })
})
