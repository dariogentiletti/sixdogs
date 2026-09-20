import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarize, buildBoard, pickScore } from '../src/liveboard.js';

const state = {
  ok: true, matchId: 12, clockDirection: 'down', serverId: 'abc-123',
  status: {
    serverName: 'SIXDOGS', map: 'Madrid', matchSeconds: 600, scoreCap: 100,
    players: { current: 5, max: 6 },
    factionScores: [
      { name: 'Lonestar', colorHex: '#2f6fd6', score: 63 },
      { name: 'Valkyra', colorHex: '#d13b3b', score: 51 },
      { name: 'Manticore', colorHex: '#3aa655' },
    ],
  },
  players: [
    { name: 'Rook', faction: 'Lonestar', kills: 9, discordId: '1' },
    { name: 'Vex', faction: 'Lonestar', kills: 3 },
    { name: 'Mako', faction: 'Valkyra', kills: 12 },
    { name: 'Juno', faction: 'Manticore', kills: 0 },
    { name: 'Tally', faction: '', kills: 1 },
  ],
};

test('pickScore finds the undocumented score field', () => {
  assert.equal(pickScore({ points: 4 }), 4);
  assert.equal(pickScore({ name: 'x' }), null);
});

test('summary: teams, lead, time, slots, top players', () => {
  const now = 1_000_000_000_000;
  const s = summarize(state, { now, commanderOf: (k) => (k === 'blue' ? '1' : null) });
  const blue = s.teams.find((t) => t.key === 'blue');
  assert.deepEqual([blue.players, blue.score, blue.commanderId, blue.linked], [2, 63, '1', 1]);
  assert.equal(s.lead.team.key, 'blue');
  assert.equal(s.lead.by, 12);
  assert.equal(s.endsAt, now + 600_000);
  assert.deepEqual(s.top.map((p) => p.name), ['Mako', 'Rook', 'Vex']);

  const b = buildBoard(s, { now, links: { play: 'https://example.com' } }).embeds[0];
  assert.match(b.description, /Ends <t:\d+:R>/);
  assert.match(b.description, /1 slot open/);
  assert.match(b.fields.find((f) => f.name === 'How to join').value, /abc-123/);
  assert.match(b.fields[0].value, /<@1>/);
  assert.match(b.fields[2].value, /No commander/);
});

test('board when offline or not connected', () => {
  assert.match(buildBoard(summarize({ ok: false }), {}).embeds[0].title, /Offline/);
  assert.match(buildBoard(null, { notConnected: true }).embeds[0].description, /isn't connected/);
});

test('board shows the invite domain', () => {
  const b = buildBoard(summarize(state), { inviteDomain: 'sixdogs.gg' }).embeds[0];
  assert.match(b.fields.at(-1).value, /sixdogs\.gg/);
});
