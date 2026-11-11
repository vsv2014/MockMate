const test = require('node:test')
const assert = require('node:assert/strict')
const { sourceCheck } = require('../electron/connector-gateway.cjs')

test('connector source IDs are never silently truncated into another source', () => {
  const longPath = 'owner/repo:' + 'a'.repeat(600) + '.md'
  assert.throws(() => sourceCheck('github', longPath), /Invalid connector source identifier/)
  assert.throws(() => sourceCheck('googledrive', 'x'.repeat(601)), /Invalid connector source identifier/)
})

test('connector source validation retains supported IDs and blocks traversal', () => {
  assert.equal(sourceCheck('github', 'owner/repo:docs/guide.md'), 'owner/repo:docs/guide.md')
  assert.throws(() => sourceCheck('github', 'owner/repo:../secrets.md'), /Unsafe GitHub path/)
  assert.throws(() => sourceCheck('googledrive', 'invalid/id'), /Invalid Drive file ID/)
  assert.throws(() => sourceCheck('github', null), /Invalid connector source identifier/)
})
