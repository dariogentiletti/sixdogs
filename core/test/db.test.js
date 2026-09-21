// The built-in database lives in the container. On a host that rebuilds the
// container every deploy that means every verified player disappears on the
// next push, silently. These tests guard the detection that shouts about it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { looksEphemeral, createPool } from '../src/db.js';

test('the hosts that rebuild the container are recognised', () => {
  for (const env of [
    { RAILWAY_ENVIRONMENT: 'production' },
    { RAILWAY_PROJECT_ID: 'abc' },
    { RAILWAY_SERVICE_ID: 'def' },
    { FLY_APP_NAME: 'sixdogs' },
    { DYNO: 'web.1' },
    { RENDER: 'true' },
    { K_SERVICE: 'svc' },
  ]) {
    assert.equal(looksEphemeral(env), true, JSON.stringify(env));
  }
});

test('a normal machine is not mistaken for one', () => {
  assert.equal(looksEphemeral({}), false);
  assert.equal(looksEphemeral({ HOME: '/root', PATH: '/usr/bin' }), false);
});

test('Postgres is reported as persistent, and the password never reaches the log', () => {
  const lines = [];
  const log = { log: (m) => lines.push(String(m)), error: (m) => lines.push(String(m)) };
  // createPool imports pg lazily; stub the connection by checking the log only.
  return createPool('postgres://sixdogs:hunter2@db.internal:5432/railway', '/tmp/unused', { log, env: {} })
    .then((pool) => {
      assert.equal(pool.kind, 'postgres');
      const all = lines.join('\n');
      assert.match(all, /db\.internal:5432/, 'says where it connected');
      assert.doesNotMatch(all, /hunter2/, 'never prints the password');
      assert.match(all, /survive restarts and deploys/);
      return pool.end?.();
    });
});
