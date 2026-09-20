import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FactionTracker } from '../src/tracker.js';
import { factionKeyFor, colorKeyFromHex } from '../src/factions.js';
import { pickCandidates } from '../src/commander.js';
import { rolePlan, channelPlan } from '../src/setup.js';

test('factions are recognised by colour, game name, colour word or alias', () => {
  const scores = [
    { name: 'Lonestar', colorHex: '#2f6fd6' },
    { name: 'Valkyra', colorHex: '#d13b3b' },
    { name: 'Manticore', colorHex: '#3aa655' },
    { name: 'Faction X', colorHex: '#1e90ff' },
  ];
  // by colorHex of the matching factionScores row
  assert.equal(factionKeyFor('Faction X', {}, scores), 'blue');
  assert.equal(factionKeyFor('Valkyra', {}, scores), 'red');
  // by in-game name, no scores
  assert.equal(factionKeyFor('Lonestar'), 'blue');
  assert.equal(factionKeyFor('VALKYRA Coalition'), 'red');
  assert.equal(factionKeyFor('Manticore'), 'green');
  // by colour word
  assert.equal(factionKeyFor('Green Team'), 'green');
  // alias wins
  assert.equal(factionKeyFor('Team 3', { green: ['team 3'] }), 'green');
  // unassigned
  assert.equal(factionKeyFor(''), null);
  assert.equal(factionKeyFor('Spectator'), null);
});

test('colour classification', () => {
  assert.equal(colorKeyFromHex('#3a7bd5'), 'blue');
  assert.equal(colorKeyFromHex('#b33a3a'), 'red');
  assert.equal(colorKeyFromHex('#4caf50'), 'green');
  assert.equal(colorKeyFromHex('#808080'), null);
  assert.equal(colorKeyFromHex('nope'), null);
});

test('tracker: join, switch, leave with grace', () => {
  const t = new FactionTracker({ graceMs: 60_000 });
  let d = t.update([{ discordId: 'a', factionKey: 'blue' }], 0);
  assert.equal(d.get('a'), 'blue');
  d = t.update([{ discordId: 'a', factionKey: 'red' }], 5_000); // switch = immediate
  assert.equal(d.get('a'), 'red');
  d = t.update([], 30_000); // crashed: still red within grace
  assert.equal(d.get('a'), 'red');
  d = t.update([{ discordId: 'a', factionKey: null }], 50_000); // back but unassigned: grace continues
  assert.equal(d.get('a'), 'red');
  d = t.update([], 70_000); // grace over
  assert.equal(d.get('a'), null);
  d = t.update([], 75_000);
  assert.equal(d.has('a'), false); // forgotten, no repeated work
});

test('tracker: seeded role holder who is not online loses it after grace', () => {
  const t = new FactionTracker({ graceMs: 60_000 });
  t.seed('b', 'green', 0);
  assert.equal(t.update([], 10_000).get('b'), 'green');
  assert.equal(t.update([], 61_000).get('b'), null);
});

test('commander pick: best-rated pool members first, else anyone at random', () => {
  const players = [
    { discordId: '1', factionKey: 'blue' },
    { discordId: '2', factionKey: 'blue' },
    { discordId: '3', factionKey: 'red' },
    { discordId: null, factionKey: 'blue' },
    { discordId: '4', factionKey: 'blue' },
  ];
  const scores = { 1: 2, 2: 2, 4: 5 };
  const base = { players, faction: 'blue', scoreOf: (id) => scores[id] ?? 0 };

  // Pool members on the faction: the best rated ones (tie between 1 and 2, picked at random).
  let r = pickCandidates({ ...base, poolIds: new Set(['1', '2', '3']) });
  assert.equal(r.tier, 'pool');
  assert.deepEqual(r.candidates.map((p) => p.discordId), ['1', '2']);

  // A pool member beats a better-rated non-member.
  r = pickCandidates({ ...base, poolIds: new Set(['1']) });
  assert.deepEqual(r.candidates.map((p) => p.discordId), ['1']);

  // Nobody from the pool on this faction: anyone, at random (ratings don't matter).
  r = pickCandidates({ ...base, poolIds: new Set(['3']) });
  assert.equal(r.tier, 'random');
  assert.deepEqual(r.candidates.map((p) => p.discordId), ['1', '2', '4']);

  // Everyone excluded (passed): nobody.
  r = pickCandidates({ ...base, poolIds: new Set(), exclude: new Set(['1', '2', '4']) });
  assert.equal(r.tier, null);
});

test('setup plan only references roles it creates', () => {
  const roles = new Set(['@everyone', '@bot', ...rolePlan().map((r) => r.name)]);
  for (const cat of channelPlan()) {
    for (const name of Object.keys(cat.ow)) assert.ok(roles.has(name), name);
    for (const ch of cat.channels) for (const name of Object.keys(ch.ow ?? {})) assert.ok(roles.has(name), name);
  }
});

test('tracker: anyone holding a team role is tracked and loses it if not playing', () => {
  const t = new FactionTracker({ graceMs: 60_000 });
  t.seed('leftover', 'blue', 0); // e.g. role from practice mode, not linked
  assert.equal(t.update([], 30_000).get('leftover'), 'blue'); // grace
  assert.equal(t.update([], 61_000).get('leftover'), null);
  assert.equal(t.has('leftover'), false);
});

test('tracker: at match end, people not on the server lose their role at once', () => {
  const t = new FactionTracker({ graceMs: 60_000 });
  t.update([{ discordId: 'stay', factionKey: 'red' }, { discordId: 'gone', factionKey: 'blue' }], 0);
  t.update([{ discordId: 'stay', factionKey: 'red' }], 5_000); // 'gone' disconnected, in grace
  t.dropAbsent(new Set(['stay']));
  const d = t.update([{ discordId: 'stay', factionKey: null }], 10_000); // between matches, unassigned
  assert.equal(d.get('gone'), null);
  assert.equal(d.get('stay'), 'red'); // still connected: keeps it until the new side is known
  assert.equal(t.update([{ discordId: 'stay', factionKey: 'green' }], 15_000).get('stay'), 'green');
});

test('Verified role follows the link list', async () => {
  const { planVerified } = await import('../src/verified.js');
  const { add, remove } = planVerified({
    holders: new Set(['a', 'stale']),          // 'stale' unlinked since
    linked: new Set(['a', 'b', 'gone']),       // 'gone' left the Discord
    members: new Set(['a', 'b', 'stale']),
  });
  assert.deepEqual(add, ['b']);
  assert.deepEqual(remove, ['stale']);
  assert.ok(rolePlan().some((r) => r.name === 'Verified'));
});
