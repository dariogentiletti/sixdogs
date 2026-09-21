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
      id, dms: [], displayName: `Member${id}`,
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
  const broadcasts = [];
  const core = {
    message: async (steamId, message) => { whispers.push({ steamId, message }); },
    broadcast: async (message) => { broadcasts.push(message); },
    commanderLog: async () => {},
  };
  return { guild, core, voice, roles, whispers, logs, broadcasts, mkMember };
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
const P = (id, factionKey, name = `Player${id}`) => ({ discordId: id, steamId: `s${id}`, name, factionKey });

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

test('a restart mid-match keeps the sitting commanders; a new match clears them', async () => {
  const { w, cm, set, tick } = setup();
  const t0 = 2_000_000;

  // Blue and Red are commanding when the bot goes down.
  const blueRole = w.roles[0];
  const redRole = w.roles[1];
  blueRole.members.set('A', w.mkMember('A'));
  redRole.members.set('B', w.mkMember('B'));
  set(P('A', 'blue'), P('B', 'red'), P('C', 'green'));

  // Bot starts again and sees the same match still running.
  await cm.onMatchChange(7, { firstSeen: true, now: t0 });

  assert.equal(cm.state.blue.commanderId, 'A', 'blue commander kept');
  assert.equal(cm.state.red.commanderId, 'B', 'red commander kept');
  assert.ok(blueRole.members.has('A'), 'blue still holds the role');
  assert.ok(redRole.members.has('B'), 'red still holds the role');
  assert.equal(cm.state.green.commanderId, null, 'green was empty and stays empty');

  // Nobody is offered a job that is already taken.
  await tick(t0 + 20_000);
  assert.equal(cm.state.blue.offer, null, 'no offer for a faction that has a commander');
  assert.equal(cm.state.red.offer, null);

  // A real match change still clears everyone.
  await cm.onMatchChange(8, { now: t0 + 60_000 });
  assert.equal(cm.state.blue.commanderId, null, 'new match clears blue');
  assert.equal(cm.state.red.commanderId, null, 'new match clears red');
  assert.equal(blueRole.members.size, 0, 'blue role removed on a new match');
  assert.equal(redRole.members.size, 0, 'red role removed on a new match');
});

test('a restart with two holders of one commander role keeps exactly one', async () => {
  const { w, cm, set } = setup();
  const blueRole = w.roles[0];
  blueRole.members.set('A', w.mkMember('A'));
  blueRole.members.set('D', w.mkMember('D'));
  set(P('A', 'blue'), P('D', 'blue'));

  await cm.onMatchChange(9, { firstSeen: true, now: 3_000_000 });

  assert.equal(blueRole.members.size, 1, 'one commander left on blue');
  assert.equal(cm.state.blue.commanderId, 'A');
  assert.ok(blueRole.members.has('A'));
});

test('the whole server is told who the new commander is, by in-game name', async () => {
  const { w, cm, set, tick } = setup();
  const t0 = 4_000_000;
  await cm.onMatchChange(11, { now: t0 });
  set(P('A', 'blue', 'Rook'));

  await tick(t0 + 61_000);
  await cm.accept('A');

  assert.deepEqual(w.broadcasts, ['A new Blue commander has been chosen: Rook'],
    'announced once, using the name the rest of the server sees');

  // The commander also gets their own whisper, with the new wording.
  const own = w.whispers.filter((x) => /you are blue commander/i.test(x.message));
  assert.equal(own.length, 1);
  assert.match(own[0].message, /read team chat for comms/);
  assert.doesNotMatch(own[0].message, /tower/i);
});

test('the in-game offer never tells anyone to type /accept', async () => {
  const { w, cm, set, tick } = setup();
  const t0 = 5_000_000;
  await cm.onMatchChange(12, { now: t0 });
  set(P('A', 'blue', 'Rook'));
  await tick(t0 + 61_000);

  const offer = w.whispers.find((x) => /picked as blue commander/i.test(x.message));
  assert.ok(offer, 'the pick is whispered in-game');
  assert.doesNotMatch(offer.message, /\/accept/, 'people were typing it into the game');
  assert.match(offer.message, /Discord/);
});

test('a restart mid-match announces nothing: nobody changed', async () => {
  const { w, cm, set } = setup();
  w.roles[0].members.set('A', w.mkMember('A'));
  set(P('A', 'blue', 'Rook'));

  await cm.onMatchChange(13, { firstSeen: true, now: 6_000_000 });

  assert.equal(cm.state.blue.commanderId, 'A', 'still commanding');
  assert.deepEqual(w.broadcasts, [], 'no announcement for a commander who never changed');
});

test('a server that cannot broadcast still gets its commander', async () => {
  const { w, cm, set, tick } = setup();
  // An older build: core has no broadcast at all.
  delete cm.core.broadcast;
  const t0 = 7_000_000;
  await cm.onMatchChange(14, { now: t0 });
  set(P('A', 'blue', 'Rook'));
  await tick(t0 + 61_000);

  await assert.doesNotReject(async () => cm.accept('A'));
  assert.equal(cm.state.blue.commanderId, 'A', 'the grant still happened');
  assert.ok(w.roles[0].members.has('A'), 'and they got the role');
});

test('a broadcast that fails does not stop someone becoming commander', async () => {
  const { w, cm, set, tick } = setup();
  cm.core.broadcast = async () => { throw new Error('game server said no'); };
  const t0 = 8_000_000;
  await cm.onMatchChange(15, { now: t0 });
  set(P('A', 'blue', 'Rook'));
  await tick(t0 + 61_000);

  await assert.doesNotReject(async () => cm.accept('A'));
  assert.equal(cm.state.blue.commanderId, 'A');
});

test('someone not in the player list is announced by their Discord name', async () => {
  const { w, cm, set, tick } = setup();
  const t0 = 9_000_000;
  await cm.onMatchChange(16, { now: t0 });
  set(P('A', 'blue', 'Rook'));
  await tick(t0 + 61_000);
  // They drop off the server list between being picked and accepting.
  cm.latest.players = [];
  await cm.accept('A');

  assert.equal(w.broadcasts.length, 1, 'still announced');
  assert.match(w.broadcasts[0], /A new Blue commander has been chosen: /);
});
