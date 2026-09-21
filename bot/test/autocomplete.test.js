import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeAutocomplete, commandDefinitions } from '../src/commands.js';

// Shaped like the live document: long dotted section names, a list built with
// Unreal's !/. operators, and the same key name in two sections.
const TEXT = [
  '[/Script/WDGame.WDGameSession]',
  'ServerName=SIXDOGS.gg',
  'MaxPlayers=100',
  'IdleKickSeconds=180',
  '!ReservedSlots=ClearArray',
  '.ReservedSlots=76561198000000001',
  '',
  '[MatchState.PreMatch.WaitingForPlayers.PlayerCount]',
  'PlayerCount=10',
  '',
  '[/Script/WDRCON.WDRCONSettings]',
  'MaxPlayers=8',
].join('\n');

function fake({ section = null, focused, calls = 0 } = {}) {
  const core = { serverConfig: async () => { core.calls++; return { text: TEXT }; }, calls };
  const sent = [];
  const i = {
    options: {
      getFocused: () => focused,
      getString: (n) => (n === 'section' ? section : null),
    },
    respond: async (c) => { sent.push(c); },
  };
  return { core, i, sent };
}

const run = async (fixture, ac) => { await (ac ?? makeAutocomplete({ core: fixture.core })).settings(fixture.i); return fixture.sent[0]; };

test('the section box offers the real section names', async () => {
  const f = fake({ focused: { name: 'section', value: '' } });
  const out = await run(f);
  assert.deepEqual(out.map((c) => c.value), [
    '/Script/WDGame.WDGameSession',
    'MatchState.PreMatch.WaitingForPlayers.PlayerCount',
    '/Script/WDRCON.WDRCONSettings',
  ]);
});

test('typing narrows it, case insensitively and anywhere in the name', async () => {
  const f = fake({ focused: { name: 'section', value: 'prematch' } });
  const out = await run(f);
  assert.equal(out.length, 1);
  assert.match(out[0].value, /PreMatch/);
});

test('the key box offers only the keys in the chosen section', async () => {
  const f = fake({ section: '/Script/WDGame.WDGameSession', focused: { name: 'key', value: '' } });
  const out = await run(f);
  assert.deepEqual(out.map((c) => c.value), ['ServerName', 'MaxPlayers', 'IdleKickSeconds']);
});

// A !Key/.Key line is a list directive, not a setting with one value, and
// setConfigValue refuses to touch one. Offering it would be a dead end.
test('list entries are never offered as something to set', async () => {
  const f = fake({ section: '/Script/WDGame.WDGameSession', focused: { name: 'key', value: '' } });
  const out = await run(f);
  assert.equal(out.some((c) => c.value === 'ReservedSlots'), false);
});

test('keys from another section are not offered', async () => {
  const f = fake({ section: 'MatchState.PreMatch.WaitingForPlayers.PlayerCount', focused: { name: 'key', value: '' } });
  const out = await run(f);
  assert.deepEqual(out.map((c) => c.value), ['PlayerCount']);
});

test('no section chosen yet: an empty list, not everything', async () => {
  const f = fake({ section: null, focused: { name: 'key', value: '' } });
  assert.deepEqual(await run(f), []);
});

test('a section that does not exist gives an empty list, not a crash', async () => {
  const f = fake({ section: 'nonsense', focused: { name: 'key', value: '' } });
  assert.deepEqual(await run(f), []);
});

// Discord fires this on every keystroke; asking the game server each time
// would be a poor trade for a dropdown.
test('the document is fetched once, not once per keystroke', async () => {
  const f = fake({ focused: { name: 'section', value: '' } });
  const ac = makeAutocomplete({ core: f.core });
  for (let n = 0; n < 5; n++) await ac.settings(f.i);
  assert.equal(f.core.calls, 1);
});

test('the cache does expire', async () => {
  const f = fake({ focused: { name: 'section', value: '' } });
  const ac = makeAutocomplete({ core: f.core, ttlMs: -1 });
  await ac.settings(f.i);
  await ac.settings(f.i);
  assert.equal(f.core.calls, 2);
});

const dropdown = async (text) => {
  const core = { serverConfig: async () => ({ text }) };
  const sent = [];
  const i = { options: { getFocused: () => ({ name: 'section', value: '' }), getString: () => null }, respond: async (c) => sent.push(c) };
  await makeAutocomplete({ core }).settings(i);
  return sent[0];
};

test('Discord takes at most 25 choices', async () => {
  const many = Array.from({ length: 40 }, (_, n) => `[Section${n}]\nK=1`).join('\n');
  assert.equal((await dropdown(many)).length, 25);
});

// Discord caps a choice's VALUE at 100 characters as well as its label, and a
// value can't be shortened to fit: a truncated section name matches nothing.
// So an over-long name is left out rather than offered broken. It can still be
// typed by hand, which is why the option allows more than the dropdown does.
test('a name too long for Discord is left out, never sent truncated', async () => {
  const long = `Section${'X'.repeat(140)}`;
  const out = await dropdown(`[${long}]\nK=1\n\n[Short.Section]\nK=1`);
  assert.deepEqual(out.map((c) => c.value), ['Short.Section']);
  assert.ok(out.every((c) => c.name.length <= 100 && c.value.length <= 100));
});

test('every real section name fits in a dropdown comfortably', async () => {
  // The longest on the live server is MatchState.PreMatch.WaitingForPlayers.PlayerCount.
  const out = await dropdown(TEXT);
  assert.equal(out.length, 3, 'none of the live names are dropped');
  assert.ok(out.every((c) => c.value.length < 60));
});

test('the command actually asks Discord for autocomplete on both options', () => {
  const def = commandDefinitions.find((d) => d.name === 'settings');
  for (const name of ['section', 'key']) {
    assert.equal(def.options.find((o) => o.name === name).autocomplete, true, `${name} autocompletes`);
  }
});

// ---- searching the settings document ----

import { searchConfig } from '../src/commands.js';
import { parseConfigText } from '../src/serverconfig.js';

const SECTIONS = parseConfigText(TEXT);

test('a setting is found without knowing which section it lives in', () => {
  const hits = searchConfig(SECTIONS, 'idle');
  assert.equal(hits.length, 1);
  assert.equal(hits[0].key, 'IdleKickSeconds');
  assert.equal(hits[0].section, '/Script/WDGame.WDGameSession');
  assert.equal(hits[0].value, '180');
});

test('a key in several sections comes back from all of them', () => {
  const hits = searchConfig(SECTIONS, 'maxplayers');
  assert.deepEqual(hits.map((h) => h.section), ['/Script/WDGame.WDGameSession', '/Script/WDRCON.WDRCONSettings']);
});

test('matching a section name returns everything in it', () => {
  const hits = searchConfig(SECTIONS, 'prematch');
  assert.deepEqual(hits.map((h) => h.key), ['PlayerCount']);
});

test('searching is case insensitive and matches anywhere in the name', () => {
  assert.equal(searchConfig(SECTIONS, 'KICK').length, 1);
  assert.equal(searchConfig(SECTIONS, 'seconds').length, 1);
});

// A list is reported with its kind, so nobody tries to set it like a value.
test('list entries are found too, and marked as lists', () => {
  const hits = searchConfig(SECTIONS, 'reserved');
  assert.ok(hits.length >= 2);
  assert.ok(hits.some((h) => h.kind === 'clear'));
  assert.ok(hits.some((h) => h.kind === 'append'));
});

test('no match, and an empty term, both give nothing rather than everything', () => {
  assert.deepEqual(searchConfig(SECTIONS, 'zzzz'), []);
  assert.deepEqual(searchConfig(SECTIONS, ''), []);
  assert.deepEqual(searchConfig(SECTIONS, '   '), []);
});
