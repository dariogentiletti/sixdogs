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
  // Ranked by kills, and anyone on zero is left out.
  assert.deepEqual(s.top.map((p) => p.name), ['Mako', 'Rook', 'Vex', 'Tally']);

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

test('the top list stops at five, best first', () => {
  const many = {
    ...state,
    players: Array.from({ length: 9 }, (_, i) => ({ name: `P${i}`, faction: 'Lonestar', kills: i })),
  };
  const top = summarize(many, { now: 1_000_000_000_000 }).top;
  assert.equal(top.length, 5, 'five at most');
  assert.deepEqual(top.map((p) => p.name), ['P8', 'P7', 'P6', 'P5', 'P4']);
  assert.ok(top.every((p) => p.kills > 0), 'nobody on zero kills is listed');
});

// Taken from the real server on 2026-09-21: idle, nobody on, and the build
// does not report matchSeconds. The only "clock" available is when the bot
// first noticed the match, six hours earlier.
const IDLE_REAL = {
  ok: true, matchId: 1, clockDirection: null, serverId: '41186c61-6d6b-4149-ace0-375bacdee3f8',
  matchStartedAt: '2026-09-21T02:20:12.669Z',
  status: {
    serverName: 'SIXDOGS.gg | *NEW* Commander Mode | Hardcore  (Join Discord)',
    map: 'Bakurani',
    players: { current: 0, max: 100 },
    factionScores: [
      { name: 'Lonestar', colorHex: '#4CB1EF', score: 0 },
      { name: 'Valkyra', colorHex: '#FA503E', score: 0 },
      { name: 'Manticore', colorHex: '#1DD65C', score: 0 },
    ],
  },
  players: [],
};

test('an empty server does not claim a match has been running for hours', () => {
  const now = Date.parse('2026-09-21T08:13:01.098Z');
  const s = summarize(IDLE_REAL, { now });
  assert.equal(s.current, 0);
  assert.equal(s.clockFromServer, false, 'the game reported no clock');
  assert.equal(s.showClock, false, 'so nothing should be shown as a running time');

  // The Discord board must not print a started/ends line either.
  const b = buildBoard(s, { now }).embeds[0];
  assert.doesNotMatch(b.description, /Ends|Started/, b.description);
});

test('once people are playing, the inferred clock is shown', () => {
  const now = Date.parse('2026-09-21T08:13:01.098Z');
  const busy = { ...IDLE_REAL, status: { ...IDLE_REAL.status, players: { current: 12, max: 100 } } };
  const s = summarize(busy, { now });
  assert.equal(s.clockFromServer, false);
  assert.equal(s.showClock, true, 'people are on, so the match really is running');
  assert.match(buildBoard(s, { now }).embeds[0].description, /Started/);
});

test('a clock from the game is always trusted, even on an empty server', () => {
  const now = 1_000_000_000_000;
  const withClock = {
    ...IDLE_REAL,
    clockDirection: 'down',
    status: { ...IDLE_REAL.status, matchSeconds: 600 },
  };
  const s = summarize(withClock, { now });
  assert.equal(s.clockFromServer, true);
  assert.equal(s.showClock, true);
  assert.equal(s.endsAt, now + 600_000);
});

test("the real server's faction colours still map to blue, red and green", () => {
  const s = summarize(IDLE_REAL, { now: Date.now() });
  assert.deepEqual(s.teams.map((t) => [t.key, t.score]), [['blue', 0], ['red', 0], ['green', 0]]);
});
