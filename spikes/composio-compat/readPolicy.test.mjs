import { test } from 'vitest';
import assert from 'node:assert/strict';
import { authorizeSelectedRead } from './readPolicy.mjs';

const example = {
  authenticatedUserId: 'user-A', connectionOwnerId: 'user-A',
  toolkit: 'googledrive', action: 'get_selected_document',
  sourceId: 'google-doc-12', selectedByUser: true,
};

test('selected read is explicitly allowlisted', () => {
  const grant = authorizeSelectedRead(example);
  assert.equal(grant.sourceId, 'google-doc-12');
  assert.ok(Object.isFrozen(grant));
});
test('cross-account access rejected even when source ID is known', () => {
  assert.throws(() => authorizeSelectedRead({...example, authenticatedUserId:'user-B'}),/denied/);
});
test('tool is blocked if no source was explicitly selected', () => {
  assert.throws(() => authorizeSelectedRead({...example, selectedByUser:false}),/selection/);
  assert.throws(() => authorizeSelectedRead({...example, sourceId:''}),/source ID/);
});
test('sending messages and arbitrary toolkits are denied', () => {
  assert.throws(() => authorizeSelectedRead({...example, action:'send_email'}),/allowlisted/);
  assert.throws(() => authorizeSelectedRead({...example, toolkit:'gmail'}),/allowlisted/);
});
test('no renderer-asserted identity is accepted in place of backend identity', () => {
  assert.throws(() => authorizeSelectedRead({...example, authenticatedUserId:null}),/denied/);
});
