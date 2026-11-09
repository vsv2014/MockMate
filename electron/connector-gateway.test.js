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
  })
  it('refuses plaintext token storage when OS encryption is not available', () => {
    const blocked = createConnectorGateway({ userData: dir, safeStorage: {
      isEncryptionAvailable: () => false,
    }, openExternal: async () => {} })
    assert.throws(() => blocked.state('account-a'), /encryption unavailable/)
  })
})
