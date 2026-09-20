// Simulates a match with fake Discord/core objects to exercise the offer flow.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CommanderManager } from '../src/commander.js';

function fakeWorld() {
  const roleMembers = new Map(); // roleId -> Map(memberId -> member)
  const roles = ['Blue Commander', 'Red Commander', 'Green Commander', 'Commander Pool'].map((name, i) => {
    const members = new Map();
    roleMembers.set(`r${i}`, members);
    return { id: `r${i}`, name, members };
  });
  const members = new Map();
  const mkMember = (id) => {
    const m = {
      id, dms: [],
      send: async (msg) => { m.dms.push(msg); },
      roles: {
        add: async (role) => { role.members.set(id, m); },
        remove: async (role) => { role.members.delete(id); },
      },
    };
    members.set(id, m);
    return m;
  };
  const voice = new Map();
  const channels = ['Blue', 'Red', 'Green'].map((f) => ({ id: `vc-${f}`, name: `${f} Command (listen)`, isVoiceBased: () => true }));
  const guild = {
    roles: { cache: { find: (fn) => roles.find(fn) } },
    channels: { cache: { find: (fn) => channels.find(fn) } },
    voiceStates: { cache: { get: (id) => (voice.has(id) ? { channelId: voice.get(id) } : undefined) } },
    members: { fetch: async (id) => members.get(id) ?? mkMember(id) },
  };
  const whispers = [];
  const logs = [];
  const core = {
    message: async (steamId, message) => { whispers.push({ steamId, message }); },
    commanderLog: async () => {},
  };
  return { guild, core, voice, roles, whispers, logs, mkMember };
}

const cfg = { commanderPoolRoleName: 'Commander Pool', commanderDelaySec: 60, commanderAcceptSec: 0.05, commanderAwaySec: 300 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MIN = 60_000;

function setup() {
  const w = fakeWorld();
  const cm = new CommanderManager({ core: w.core, config: cfg, log: async (t) => w.logs.push(t) });
  cm.attach(w.guild);
  cm.matchId = 1;
  const pool = (...ids) => ids.forEach((id) => w.roles[3].members.set(id, {}));
  // Players are linked + on the server; factionOf mirrors their current faction.
  let players = [];
  const set = (...list) => { players = list; };
  const factionOf = (id) => players.find((p) => p.discordId === id)?.factionKey ?? null;
  const tick = (now) => cm.tick(players, factionOf, now);
  return { w, cm, pool, set, tick, factionOf };
}
const P = (id, factionKey) => ({ discordId: id, steamId: `s${id}`, factionKey });

test('no offers while the match settles; empty faction fills when someone joins', async () => {
  const { w, cm, set, tick } = setup();
  const t0 = 1_000_000;
  await cm.onMatchChange(2, { now: t0 });
  set(P('A', 'blue'));
  await tick(t0 + 10_000);
  assert.equal(cm.state.blue.offer, null, 'still settling');

  await tick(t0 + 61_000);
  assert.equal(cm.state.blue.offer?.discordId, 'A');
  assert.equal(cm.state.red.offer, null);
  assert.match(w.logs.join('\n'), /nobody verified is on Red/);

  // 10 minutes in, someone joins Red -> offered straight away.
  set(P('A', 'blue'), P('V', 'red'));
  await tick(t0 + 10 * MIN);
  assert.equal(cm.state.red.offer?.discordId, 'V');
  await sleep(80); // let offers time out so no timers linger
});

test('pool first, timeout gets a cooldown, then asked again later', async () => {
  const { cm, pool, set, tick } = setup();
  pool('B');
  set(P('A', 'blue'), P('B', 'blue'));
  const now = Date.now();
  await tick(now);
  assert.equal(cm.state.blue.offer.discordId, 'B', 'pool member first');

  await sleep(80); // B times out -> A (random) is offered
  assert.equal(cm.state.blue.offer.discordId, 'A');
  await cm.decline('A'); // A says no -> nobody left right now
  assert.equal(cm.state.blue.offer, null);

  await tick(Date.now() + 6 * MIN); // B's 5-minute cooldown is over, A's 15 isn't
  assert.equal(cm.state.blue.offer?.discordId, 'B');
  const r = await cm.accept('B');
  assert.equal(r.ok, true);
  assert.equal(cm.state.blue.commanderId, 'B');
});

test('commander moved to another faction is replaced; offered player who leaves is skipped', async () => {
  const { w, cm, pool, set, tick } = setup();
  pool('A', 'B', 'C');
  set(P('A', 'blue'));
  await tick(Date.now());
  await cm.accept('A');
  assert.equal(cm.state.blue.commanderId, 'A');

  // Balancer moves A to Red; B and C are on Blue.
  set(P('A', 'red'), P('B', 'blue'), P('C', 'blue'));
  await tick(Date.now());
  assert.equal(cm.state.blue.commanderId, null);
  assert.equal(w.roles[0].members.has('A'), false, 'Blue commander role removed');
  assert.equal(cm.state.red.offer?.discordId, 'A', 'A can command their new faction');
  const offered = cm.state.blue.offer.discordId;
  assert.ok(['B', 'C'].includes(offered));

  // The Blue pick leaves the server before answering -> the other one is asked.
  set(P('A', 'red'), ...['B', 'C'].filter((x) => x !== offered).map((x) => P(x, 'blue')));
  await tick(Date.now());
  assert.notEqual(cm.state.blue.offer?.discordId, offered);
  assert.ok(cm.state.blue.offer);
  await sleep(80);
});

test('a sitting commander is not bumped; out of voice is fine; 5 minutes off the server replaces', async () => {
  const { w, cm, pool, set, tick } = setup();
  set(P('R', 'green'));
  await tick(Date.now());
  await cm.accept('R');
  pool('Q');
  set(P('R', 'green'), P('Q', 'green'));
  const now = Date.now();
  await tick(now);
  assert.equal(cm.state.green.commanderId, 'R', 'no bumping a sitting commander');

  await tick(now + 10 * MIN); // never joined voice: still commander
  assert.equal(cm.state.green.commanderId, 'R');

  set(P('Q', 'green')); // R leaves the server
  await tick(now + 11 * MIN);
  await tick(now + 14 * MIN);
  assert.equal(cm.state.green.commanderId, 'R', 'back within 5 minutes would keep it');
  set(P('R', 'green'), P('Q', 'green')); // R is back: timer resets
  await tick(now + 15 * MIN);
  set(P('Q', 'green'));
  await tick(now + 16 * MIN);
  await tick(now + 21.5 * MIN);
  assert.equal(cm.state.green.commanderId, null, 'gone for over 5 minutes');
  assert.equal(cm.state.green.offer?.discordId, 'Q');
  await sleep(80);
});

test('claim works when vacant; new match clears everything', async () => {
  const { w, cm, set, tick } = setup();
  set(P('C', 'red'));
  await tick(Date.now());
  await cm.decline('C');
  const c = await cm.claim('C');
  assert.equal(c.ok, true);
  assert.equal(cm.state.red.commanderId, 'C');
  await cm.onMatchChange(9);
  assert.equal(w.roles[1].members.size, 0);
  assert.equal(cm.state.red.commanderId, null);
});
