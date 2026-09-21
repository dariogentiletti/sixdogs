// The two bits of logic behind the admin game-server commands that could
// quietly act on the wrong player, or invent a faction the game never named.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findPlayer } from '../src/commands.js';
import { gameFactionFor } from '../src/factions.js';

const P = (name, steamId, faction) => ({ name, steamId, faction });
const players = [
  P('Rook', '76561198000000001', 'Lonestar'),
  P('Vex', '76561198000000002', 'Valkyra'),
  P('Mako', '76561198000000003', 'Manticore'),
  P('Rookie', '76561198000000004', 'Lonestar'),
  P('Rook', '76561198000000005', 'Valkyra'), // a genuine duplicate name
];

test('finding a player: exact name wins over a longer one that contains it', () => {
  // "Rook" is also inside "Rookie", but two players are literally called Rook,
  // so this has to be refused rather than guessed.
  const dup = findPlayer(players, 'Rook');
  assert.ok(dup.error, 'duplicate exact names must not resolve');
  assert.match(dup.error, /SteamID/);

  // Only one Mako: fine.
  assert.equal(findPlayer(players, 'Mako').player.steamId, '76561198000000003');
  // Case does not matter.
  assert.equal(findPlayer(players, 'mAkO').player.steamId, '76561198000000003');
});

test('finding a player: a unique partial match is allowed, an ambiguous one is not', () => {
  assert.equal(findPlayer(players, 'Rookie').player.steamId, '76561198000000004');
  const many = findPlayer([P('Alpha', '1'.repeat(17), 'x'), P('Alphabet', '2'.repeat(17), 'x')], 'Alpha');
  assert.equal(many.player.steamId, '1'.repeat(17), 'exact match beats the longer one');
  const vague = findPlayer([P('Alphabet', '2'.repeat(17), 'x'), P('Alphorn', '3'.repeat(17), 'x')], 'Alph');
  assert.ok(vague.error, 'two partial matches must be refused');
});

test('finding a player: by SteamID, and when nobody matches', () => {
  assert.equal(findPlayer(players, '76561198000000005').player.faction, 'Valkyra');
  assert.ok(findPlayer(players, '76561198000000099').error, 'unknown SteamID');
  assert.ok(findPlayer(players, 'Nobody').error, 'unknown name');
  assert.ok(findPlayer(players, '   ').error, 'blank');
});

test('a colour resolves to the name THIS server uses for that faction', () => {
  // A server that renamed its factions: the colours still say which is which.
  const scores = [
    { name: 'Faction X', colorHex: '#2f6fd6' },
    { name: 'Faction Y', colorHex: '#d13b3b' },
    { name: 'Faction Z', colorHex: '#3aa655' },
  ];
  assert.equal(gameFactionFor('blue', {}, scores), 'Faction X');
  assert.equal(gameFactionFor('red', {}, scores), 'Faction Y');
  assert.equal(gameFactionFor('green', {}, scores), 'Faction Z');
});

test('a colour resolves by in-game name when no usable colour is reported', () => {
  const scores = [{ name: 'Lonestar' }, { name: 'Valkyra' }, { name: 'Manticore' }];
  assert.equal(gameFactionFor('blue', {}, scores), 'Lonestar');
  assert.equal(gameFactionFor('green', {}, scores), 'Manticore');
});

test('an alias from the settings is honoured', () => {
  const scores = [{ name: 'Team 1', colorHex: '#888888' }, { name: 'Team 2', colorHex: '#888888' }];
  assert.equal(gameFactionFor('blue', { blue: ['Team 1'] }, scores), 'Team 1');
  assert.equal(gameFactionFor('red', { red: ['Team 2'] }, scores), 'Team 2');
});

test('an unknown faction returns null, so the move is refused instead of guessed', () => {
  assert.equal(gameFactionFor('blue', {}, []), null, 'nothing reported yet');
  assert.equal(gameFactionFor('blue', {}, [{ name: '???', colorHex: '#777777' }]), null);
  assert.equal(gameFactionFor('green', {}, [{ name: 'Lonestar', colorHex: '#2f6fd6' }]), null, 'no green reported');
});
