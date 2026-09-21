// The Worker is pasted into Cloudflare by hand, so it never runs in CI unless
// we run it here. Node 22 has Request/Response/URL, which is all it needs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../live-worker.js';

// A stand-in for the KV binding: one key, held in memory.
const kv = () => {
  const store = new Map();
  return { get: async (k) => store.get(k) ?? null, put: async (k, v) => void store.set(k, v), store };
};
const env = (over = {}) => ({ STATUS: kv(), PUSH_TOKEN: 'secret-token', ...over });
const get = (path, e) => worker.fetch(new Request(`https://live.sixdogs.gg${path}`), e);
const post = (path, body, e, token = 'secret-token') =>
  worker.fetch(new Request(`https://live.sixdogs.gg${path}`, {
    method: 'POST',
    headers: token ? { authorization: `Bearer ${token}` } : {},
    body: typeof body === 'string' ? body : JSON.stringify(body),
  }), e);

test('the root and /status are the same endpoint', async () => {
  const e = env();
  for (const path of ['/', '/status', '/status/', '']) {
    const res = await get(path, e);
    assert.equal(res.status, 200, `GET ${path || '(empty)'}`);
    assert.deepEqual(await res.json(), { v: 1, state: 'unknown' }, `GET ${path}`);
  }
});

test('anything else is a 404', async () => {
  const e = env();
  for (const path of ['/nope', '/status/extra', '/admin']) {
    assert.equal((await get(path, e)).status, 404, path);
  }
});

test('a push is stored and then served, from either path', async () => {
  const e = env();
  const summary = { v: 1, state: 'live', map: 'Harbor', players: { current: 9, max: 99 } };
  assert.equal((await post('/status', summary, e)).status, 200);
  assert.deepEqual(await (await get('/', e)).json(), summary, 'readable at the root');
  assert.deepEqual(await (await get('/status', e)).json(), summary, 'and at /status');

  // Pushing to the root works too.
  const later = { v: 1, state: 'offline' };
  assert.equal((await post('/', later, e)).status, 200);
  assert.deepEqual(await (await get('/', e)).json(), later, 'the newest push wins');
});

test('a push without the right token is refused', async () => {
  const e = env();
  assert.equal((await post('/status', { v: 1 }, e, 'wrong')).status, 401);
  assert.equal((await post('/status', { v: 1 }, e, '')).status, 401);
  // And nothing was stored.
  assert.deepEqual(await (await get('/', e)).json(), { v: 1, state: 'unknown' });
});

test('a worker with no secret set refuses every push', async () => {
  // Better to serve nothing than to let anyone write the server status.
  const e = env({ PUSH_TOKEN: undefined });
  assert.equal((await post('/status', { v: 1 }, e)).status, 401);
});

test('rubbish and oversized bodies are rejected', async () => {
  const e = env();
  assert.equal((await post('/status', 'not json at all', e)).status, 400);
  assert.equal((await post('/status', { v: 99 }, e)).status, 400, 'unknown format version');
  assert.equal((await post('/status', 'x'.repeat(20001), e)).status, 413);
});

test('the browser can read it cross-origin', async () => {
  const res = await get('/', env());
  assert.equal(res.headers.get('access-control-allow-origin'), '*');
  const pre = await worker.fetch(new Request('https://live.sixdogs.gg/', { method: 'OPTIONS' }), env());
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get('access-control-allow-origin'), '*');
});
