import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectNewMatch, inferClockDirection, factionScoreTotal } from '../src/match.js';
import { findPlayerByName } from '../src/verify.js';

const base = { map: 'Harbor', matchSeconds: 600, rotation: { nowIndex: 2 }, factionScores: [] };

test('same match when clock advances', () => {
  assert.equal(detectNewMatch(base, { ...base, matchSeconds: 605 }), null);
});

test('clock reset is a new match', () => {
  assert.match(detectNewMatch(base, { ...base, matchSeconds: 3 }), /clock reset/);
});

test('small clock jitter is not a new match', () => {
  assert.equal(detectNewMatch(base, { ...base, matchSeconds: 590 }), null);
});

test('countdown clock: counting down is normal, jump up is reset', () => {
  assert.equal(detectNewMatch(base, { ...base, matchSeconds: 595 }, { clockDirection: 'down' }), null);
  assert.match(detectNewMatch(base, { ...base, matchSeconds: 3600 }, { clockDirection: 'down' }), /clock reset/);
});

test('map change and rotation change', () => {
  assert.match(detectNewMatch(base, { ...base, map: 'Quarry' }), /map changed/);
  assert.match(detectNewMatch(base, { ...base, rotation: { nowIndex: 3 } }), /rotation/);
});

test('scores dropping to zero', () => {
  const prev = { ...base, factionScores: [{ name: 'A', score: 12 }, { name: 'B', score: 3 }] };
  const curr = { ...base, matchSeconds: 610, factionScores: [{ name: 'A', score: 0 }, { name: 'B', score: 0 }] };
  assert.match(detectNewMatch(prev, curr), /scores/);
  assert.equal(factionScoreTotal({ factionScores: [{ name: 'A', colorHex: '#fff' }] }), null);
});

test('clock direction inference', () => {
  assert.equal(inferClockDirection(100, 105, 5), 'up');
  assert.equal(inferClockDirection(100, 95, 5), 'down');
  assert.equal(inferClockDirection(100, 100, 5, 'up'), 'up');
});

test('findPlayerByName', () => {
  const players = [{ name: 'Rook', steamId: '1' }, { name: 'RookieMistake', steamId: '2' }, { name: 'Vex', steamId: '3' }];
  assert.equal(findPlayerByName(players, 'rook').player.steamId, '1');
  assert.equal(findPlayerByName(players, 'vex ').player.steamId, '3');
  assert.equal(findPlayerByName(players, 'mistake').player.steamId, '2');
  assert.ok(findPlayerByName(players, 'o').error);
  assert.ok(findPlayerByName(players, 'nobody').error);
});

test('reset early in a match is still detected', () => {
  assert.match(detectNewMatch({ ...base, matchSeconds: 14 }, { ...base, matchSeconds: 1 }), /clock reset/);
});

test('findPlayerByName: duplicate names are settled by SteamID or profile link', () => {
  const players = [
    { name: 'Ghost', steamId: '76561198000000001' },
    { name: 'ghost', steamId: '76561198000000002' },
  ];
  assert.match(findPlayerByName(players, 'Ghost').error, /Steam profile link/);
  assert.equal(findPlayerByName(players, '76561198000000002').player.steamId, '76561198000000002');
  assert.equal(findPlayerByName(players, 'https://steamcommunity.com/profiles/76561198000000001/').player.steamId, '76561198000000001');
  assert.match(findPlayerByName(players, '76561198000000009').error, /isn't on the server/);
});
