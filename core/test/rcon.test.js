// The action methods must refuse anything /v1/capabilities didn't advertise,
// and must never reach the network when they do refuse.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RconClient, RconError } from '../src/rcon.js';

function clientWith(routes) {
  const c = new RconClient({ baseUrl: 'http://127.0.0.1:1', password: 'secret' });
  c.routes = new Set(routes);
  c.capabilities = { apiVersion: '1', build: 'test', routes };
  // Any call that gets this far would be a real request; fail loudly instead.
  c.request = async (method, path) => ({ called: `${method} ${path}` });
  return c;
}

const FULL = [
  'POST /v1/players/{steamId}/message',
  'POST /v1/broadcast',
  'POST /v1/players/{steamId}/kick',
  'PATCH /v1/players/{steamId}',
  'POST /v1/match/end',
];

test('a full build reports every action and calls the right route', async () => {
  const c = clientWith(FULL);
  assert.deepEqual(c.supportedActions(), {
    message: true, broadcast: true, kick: true, move: true, endMatch: true,
  });
  assert.equal((await c.kick('76561198000000001', 'why')).called, 'POST /v1/players/76561198000000001/kick');
  assert.equal((await c.setFaction('76561198000000001', 'Valkyra')).called, 'PATCH /v1/players/76561198000000001');
  assert.equal((await c.endMatch()).called, 'POST /v1/match/end');
});

test('a read-only build refuses each action without calling out', async () => {
  const c = clientWith(['GET /v1/status', 'GET /v1/players']);
  assert.deepEqual(c.supportedActions(), {
    message: false, broadcast: false, kick: false, move: false, endMatch: false,
  });
  let reached = false;
  c.request = async () => { reached = true; };

  for (const call of [
    () => c.kick('76561198000000001', 'x'),
    () => c.setFaction('76561198000000001', 'Valkyra'),
    () => c.endMatch(),
    () => c.broadcast('hi'),
    () => c.message('76561198000000001', 'hi'),
  ]) {
    await assert.rejects(async () => call(), (err) => {
      assert.ok(err instanceof RconError);
      assert.equal(err.code, 'unsupported');
      return true;
    });
  }
  assert.equal(reached, false, 'a refused action must not hit the network');
});

test('a build with some actions but not others gates them one by one', () => {
  const c = clientWith(['POST /v1/broadcast', 'POST /v1/match/end']);
  assert.deepEqual(c.supportedActions(), {
    message: false, broadcast: true, kick: false, move: false, endMatch: true,
  });
});

test('the password is not an enumerable property', () => {
  const c = clientWith(FULL);
  assert.equal(Object.keys(c).includes('_auth'), false);
  assert.equal(JSON.stringify(c).includes('secret'), false);
});

test('a route is found whatever the build calls its path parameter', () => {
  // The same route, spelled four ways. All of them must be recognised: a build
  // that says {steam_id} still serves the route, and reporting it as missing
  // would switch off verification and kicks for no reason.
  for (const spelling of [
    'POST /v1/players/{steamId}/message',
    'POST /v1/players/{steam_id}/message',
    'POST /v1/players/{id}/message',
    'POST /v1/players/:steamId/message',
  ]) {
    const c = clientWith([spelling]);
    assert.equal(c.has('POST', '/v1/players/{steamId}/message'), true, spelling);
    assert.equal(c.supportedActions().message, true, spelling);
  }
});

test('loose matching does not blur different routes', () => {
  const c = clientWith([
    'POST /v1/players/{id}/message',
    'GET /v1/status',
  ]);
  // Same shape, different tail.
  assert.equal(c.has('POST', '/v1/players/{steamId}/kick'), false);
  // Same path, different method.
  assert.equal(c.has('PATCH', '/v1/players/{steamId}'), false);
  assert.equal(c.has('GET', '/v1/players/{steamId}/message'), false);
  // A parameter must not swallow a fixed segment.
  assert.equal(c.has('GET', '/v1/health'), false);
  assert.deepEqual(c.supportedActions(), {
    message: true, broadcast: false, kick: false, move: false, endMatch: false,
  });
});
