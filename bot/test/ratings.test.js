import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ballot, readBallot } from '../src/ratings.js';
import { pickCandidates } from '../src/commander.js';

const toKey = (s) => ({ Lonestar: 'blue', Valkyra: 'red', Manticore: 'green' }[s] ?? null);

test('selection prefers the best-rated pool member', () => {
  const players = ['A', 'B', 'C'].map((id) => ({ discordId: id, factionKey: 'blue' }));
  const base = { players, faction: 'blue', poolIds: new Set(['A', 'B', 'C']), voiceOf: () => 'vc', voiceChannelId: 'vc' };
  const scores = { A: 2, B: 7, C: -3 };
  let r = pickCandidates({ ...base, scoreOf: (id) => scores[id] ?? 0 });
  assert.deepEqual(r.candidates.map((p) => p.discordId), ['B']);
  // ties are kept together for a random pick
  r = pickCandidates({ ...base, scoreOf: (id) => ({ A: 4, B: 4, C: 1 }[id]) });
  assert.deepEqual(r.candidates.map((p) => p.discordId), ['A', 'B']);
  // a new commander (0) ranks above a badly rated one
  r = pickCandidates({ ...base, poolIds: new Set(['A', 'C']), scoreOf: (id) => ({ C: -3 }[id] ?? 0) });
  assert.deepEqual(r.candidates.map((p) => p.discordId), ['A']);
  // being in voice doesn't matter any more: rating decides within the pool
  r = pickCandidates({ ...base, voiceOf: (id) => (id === 'C' ? 'vc' : null), scoreOf: (id) => scores[id] });
  assert.deepEqual(r.candidates.map((p) => p.discordId), ['B']);
});

test('ballot: one DM, one row per commander, votes survive a rebuild', () => {
  const entries = [{ roundId: 7, name: 'Rook', minutes: 25 }, { roundId: 8, name: 'Vex', minutes: 31 }];
  const b = ballot({ faction: 'blue', matchId: 37, entries, voteMinutes: 30 });
  assert.equal(b.embeds[0].title, 'How were your commanders?');
  assert.match(b.embeds[0].description, /Match #37/);
  assert.equal(b.components.length, 2);
  const row = b.components[0].toJSON().components;
  assert.equal(row[0].label, 'Rook · 25 min');
  assert.equal(row[0].disabled, true);
  assert.deepEqual(row.slice(1).map((c) => c.custom_id), ['rate:7:good', 'rate:7:poor', 'rate:7:toxic']);

  // Pretend Discord sent it back after a vote on Rook, then read it and vote on Vex.
  const voted = ballot({ faction: 'blue', matchId: 37, entries, voteMinutes: 30, chosen: { 7: 'good' } });
  const state = readBallot({ components: voted.components, embeds: voted.embeds });
  assert.deepEqual(state.entries, entries);
  assert.deepEqual(state.chosen, { 7: 'good' });
  assert.equal(state.matchId, 37);
  const both = ballot({ faction: 'blue', matchId: 37, entries, voteMinutes: 30, chosen: { ...state.chosen, 8: 'toxic' } });
  assert.equal(both.embeds[0].fields[0].value, '👍 **Rook**: Good calls\n🚫 **Vex**: Toxic');
  assert.ok(!/[—–]/.test(JSON.stringify(both.embeds)));
});

test('ballot with a single commander keeps full button labels', () => {
  const b = ballot({ faction: 'red', matchId: 3, entries: [{ roundId: 1, name: 'Rook', minutes: 42 }], voteMinutes: 30 });
  assert.equal(b.embeds[0].title, 'How was your commander?');
  assert.deepEqual(b.components[0].toJSON().components.slice(1).map((c) => c.label), ['Good calls', 'Not great', 'Toxic']);
});
