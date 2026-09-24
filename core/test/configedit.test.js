import test from 'node:test';
import assert from 'node:assert/strict';
import { setConfigValue, ConfigEditError, describeEdit } from '../src/configedit.js';

// Shaped like the real thing: CRLF, comments, blank lines, a list built with
// Unreal's !/. operators, and the same key name in two different sections.
const DOC = [
  '; SIXDOGS server settings',
  '',
  '[/Script/WDGame.WDGameSession]',
  'ServerName=SIXDOGS.gg',
  'MaxPlayers = 100',
  'IdleKickSeconds=180',
  '!ReservedSlots=ClearArray',
  '.ReservedSlots=76561198000000001',
  '.ReservedSlots=76561198000000002',
  '',
  '[MatchState.PreMatch.WaitingForPlayers.PlayerCount]',
  'PlayerCount=10',
  '',
  '[/Script/WDRCON.WDRCONSettings]',
  'MaxPlayers=8',
  '',
].join('\r\n');

const get = (text, section, key) => {
  const lines = text.split(/\r?\n/);
  let cur = '';
  for (const l of lines) {
    const s = /^\[(.+)\]$/.exec(l.trim());
    if (s) { cur = s[1]; continue; }
    const m = /^\s*([^!.=\s][^=]*?)\s*=\s*(.*?)\s*$/.exec(l);
    if (m && cur === section && m[1].trim() === key) return m[2];
  }
  return null;
};

test('changes the one value it was asked to change', () => {
  const r = setConfigValue(DOC, { section: 'MatchState.PreMatch.WaitingForPlayers.PlayerCount', key: 'PlayerCount', value: '45' });
  assert.equal(r.changed, true);
  assert.equal(r.from, '10');
  assert.equal(get(r.text, 'MatchState.PreMatch.WaitingForPlayers.PlayerCount', 'PlayerCount'), '45');
});

// The whole point. PUT replaces the entire document, so a single dropped or
// reformatted line is a real setting silently lost on a live server.
test('every other byte of the document is untouched', () => {
  const r = setConfigValue(DOC, { section: 'MatchState.PreMatch.WaitingForPlayers.PlayerCount', key: 'PlayerCount', value: '45' });
  const before = DOC.split('\r\n');
  const after = r.text.split('\r\n');
  assert.equal(after.length, before.length, 'no line added or removed');
  for (let i = 0; i < before.length; i++) {
    if (i === r.line - 1) continue;
    assert.equal(after[i], before[i], `line ${i + 1} unchanged`);
  }
  assert.equal(r.text.split('\r\n').length, r.text.split('\n').length, 'still CRLF throughout');
});

test('the line keeps its own spacing style', () => {
  const spaced = setConfigValue(DOC, { section: '/Script/WDGame.WDGameSession', key: 'MaxPlayers', value: '64' });
  assert.match(spaced.text, /MaxPlayers = 64/, 'spaces around = are kept');
  const tight = setConfigValue(DOC, { section: '/Script/WDGame.WDGameSession', key: 'IdleKickSeconds', value: '600' });
  assert.match(tight.text, /IdleKickSeconds=600/, 'and a tight = stays tight');
});

test('the same key in another section is left alone', () => {
  const r = setConfigValue(DOC, { section: '/Script/WDGame.WDGameSession', key: 'MaxPlayers', value: '64' });
  assert.equal(get(r.text, '/Script/WDRCON.WDRCONSettings', 'MaxPlayers'), '8', 'RCON MaxPlayers untouched');
});

// "!Key=ClearArray" is a directive and ".Key=x" is one member of a list.
// Neither has "a value of Key" to change.
test('list directives and members are never treated as a value', () => {
  assert.throws(() => setConfigValue(DOC, { section: '/Script/WDGame.WDGameSession', key: 'ReservedSlots', value: 'x' }),
    (e) => e instanceof ConfigEditError && e.code === 'no_key');
});

test('setting a value it already has changes nothing at all', () => {
  const r = setConfigValue(DOC, { section: 'MatchState.PreMatch.WaitingForPlayers.PlayerCount', key: 'PlayerCount', value: '10' });
  assert.equal(r.changed, false);
  assert.equal(r.text, DOC, 'byte identical, so no pointless write to a live server');
});

// A newline in a value is not a value, it is a new setting nobody reviewed.
test('a value containing a line break is refused', () => {
  assert.throws(() => setConfigValue(DOC, {
    section: 'MatchState.PreMatch.WaitingForPlayers.PlayerCount', key: 'PlayerCount', value: '45\nMaxPlayers=1',
  }), (e) => e instanceof ConfigEditError && e.code === 'bad_value');
});

test('an unknown section is refused rather than created', () => {
  assert.throws(() => setConfigValue(DOC, { section: '/Script/Nope', key: 'X', value: '1' }),
    (e) => e.code === 'no_section');
});

test('an unknown key is refused rather than invented', () => {
  assert.throws(() => setConfigValue(DOC, { section: '/Script/WDGame.WDGameSession', key: 'AfkTimeout', value: '600' }),
    (e) => e.code === 'no_key');
});

test('a key listed twice is refused, because which one wins is a guess', () => {
  const doubled = DOC.replace('PlayerCount=10', 'PlayerCount=10\r\nPlayerCount=20');
  assert.throws(() => setConfigValue(doubled, {
    section: 'MatchState.PreMatch.WaitingForPlayers.PlayerCount', key: 'PlayerCount', value: '45',
  }), (e) => e.code === 'ambiguous');
});

test('a commented-out key is not a key', () => {
  const doc = '[A]\n; PlayerCount=10\n';
  assert.throws(() => setConfigValue(doc, { section: 'A', key: 'PlayerCount', value: '45' }),
    (e) => e.code === 'no_key');
});

test('section and key names are matched however they are cased', () => {
  const r = setConfigValue(DOC, { section: 'matchstate.prematch.waitingforplayers.playercount', key: 'playercount', value: '45' });
  assert.equal(r.changed, true);
  assert.match(r.text, /PlayerCount=45/, 'and the original spelling is kept in the file');
});

test('an empty document is refused, not rebuilt from nothing', () => {
  assert.throws(() => setConfigValue('', { section: 'A', key: 'B', value: 'c' }), (e) => e.code === 'no_document');
});

test('a plain LF document stays plain LF', () => {
  const lf = DOC.replace(/\r\n/g, '\n');
  const r = setConfigValue(lf, { section: 'MatchState.PreMatch.WaitingForPlayers.PlayerCount', key: 'PlayerCount', value: '45' });
  assert.equal(r.text.includes('\r'), false);
});

test('the change reads as a sentence a human can check', () => {
  assert.equal(describeEdit({ section: 'X', key: 'PlayerCount', from: '10', to: '45' }),
    '[X] PlayerCount: 10 -> 45');
});

// ---- reading the server's refusal ----

import { explainConfigErrors } from '../src/configedit.js';

const EDIT = { section: 'MatchState.PreMatch.WaitingForPlayers.PlayerCount', key: 'PlayerCount' };

test('a refusal about our own change names it plainly', () => {
  const msg = explainConfigErrors(
    [{ section: EDIT.section, key: 'PlayerCount', code: 'out_of_range', message: 'must be 1 to 100' }], EDIT);
  assert.match(msg, /would not accept that value/);
  assert.match(msg, /PlayerCount/);
  assert.match(msg, /must be 1 to 100/);
});

// The trap CLAUDE.md warns about: the whole document is validated, so something
// that was already wrong blocks an unrelated edit. Reported badly, the admin
// goes hunting in the wrong place.
test('a bad value that was already there is named AND called pre-existing', () => {
  const msg = explainConfigErrors(
    [{ section: '/Script/WDGame.WDGameSession', key: 'MaxPlayers', message: 'must be even' }], EDIT);
  assert.match(msg, /The change itself is fine/);
  assert.match(msg, /already in the document/);
  assert.match(msg, /\[\/Script\/WDGame\.WDGameSession\] MaxPlayers/, 'the key at fault is named');
  assert.match(msg, /must be even/);
});

test('both at once are kept apart', () => {
  const msg = explainConfigErrors([
    { section: EDIT.section, key: 'PlayerCount', message: 'too big' },
    { section: '/Script/WDGame.WDGameSession', key: 'MaxPlayers', message: 'must be even' },
  ], EDIT);
  assert.match(msg, /would not accept that value/);
  assert.match(msg, /It also rejects/);
  assert.match(msg, /MaxPlayers/);
});

test('several pre-existing problems are counted, not just the first', () => {
  const msg = explainConfigErrors([
    { section: 'A', key: 'One', message: 'bad' },
    { section: 'B', key: 'Two', message: 'worse' },
  ], EDIT);
  assert.match(msg, /2 settings/);
  assert.match(msg, /One/);
  assert.match(msg, /Two/);
});

test('a refusal with no detail still says something true', () => {
  assert.match(explainConfigErrors([], EDIT), /did not say why/);
  assert.match(explainConfigErrors(null, EDIT), /did not say why/);
});

test('an error with no key named does not print "undefined"', () => {
  const msg = explainConfigErrors([{ section: 'A', message: 'broken' }], EDIT);
  assert.doesNotMatch(msg, /undefined/);
  assert.match(msg, /no key named/);
});

// ---- lists (reserved slots) ----

import { getConfigValue, listConfigMembers, setConfigListMember } from '../src/configedit.js';

const RES = { section: '/Script/WDGame.WDGameSession', key: 'DefaultReservedPlayerIds' };
const add = (text, value, max) => setConfigListMember(text, { ...RES, value, action: 'add', max });
const drop = (text, value) => setConfigListMember(text, { ...RES, value, action: 'remove' });

// Shaped like the live document: the directive, then members, CRLF throughout.
const LIST_DOC = [
  '[/Script/WDGame.WDGameSession]',
  'MaxReservedSlots=6',
  'ServerName=SIXDOGS.gg',
  '!DefaultReservedPlayerIds=ClearArray',
  '.DefaultReservedPlayerIds=76561198000000001',
  '.DefaultReservedPlayerIds=76561198000000002',
  '',
  '[Other]',
  'MaxReservedSlots=1',
].join('\r\n');

test('the members of a list read back in order', () => {
  assert.deepEqual(listConfigMembers(LIST_DOC, RES), ['76561198000000001', '76561198000000002']);
});

test('the ClearArray directive is never a member', () => {
  assert.equal(listConfigMembers(LIST_DOC, RES).includes('ClearArray'), false);
});

test('a new member goes in after the last one', () => {
  const r = add(LIST_DOC, '76561198000000003');
  assert.equal(r.changed, true);
  assert.deepEqual(r.members, ['76561198000000001', '76561198000000002', '76561198000000003']);
  const lines = r.text.split('\r\n');
  assert.equal(lines[6], '.DefaultReservedPlayerIds=76561198000000003');
  assert.equal(lines[3], '!DefaultReservedPlayerIds=ClearArray', 'the directive stays first');
});

test('adding one line changes nothing else in the document', () => {
  const r = add(LIST_DOC, '76561198000000003');
  const before = LIST_DOC.split('\r\n');
  const after = r.text.split('\r\n');
  assert.equal(after.length, before.length + 1);
  assert.deepEqual(after.filter((l) => !l.includes('76561198000000003')), before);
});

test('somebody already on the list is not added twice', () => {
  const r = add(LIST_DOC, '76561198000000001');
  assert.equal(r.changed, false);
  assert.equal(r.text, LIST_DOC, 'byte identical, so no pointless write');
});

// MaxReservedSlots is 6 and the owner's rule says there are six. Going over it
// would promise a seventh donor something the server cannot give them.
test('the cap is enforced', () => {
  let doc = LIST_DOC;
  for (let n = 3; n <= 6; n++) doc = add(doc, `7656119800000000${n}`, 6).text;
  assert.equal(listConfigMembers(doc, RES).length, 6);
  assert.throws(() => add(doc, '76561198000000007', 6), (e) => e.code === 'full' && /6 of 6/.test(e.message));
});

test('removing takes out that one line and leaves the rest', () => {
  const r = drop(LIST_DOC, '76561198000000001');
  assert.equal(r.changed, true);
  assert.deepEqual(r.members, ['76561198000000002']);
  assert.equal(r.text.includes('76561198000000001'), false);
  assert.equal(r.text.includes('!DefaultReservedPlayerIds=ClearArray'), true);
  assert.equal(r.text.includes('ServerName=SIXDOGS.gg'), true);
});

test('removing somebody who is not on the list is a no-op, not an error', () => {
  const r = drop(LIST_DOC, '76561198000000099');
  assert.equal(r.changed, false);
  assert.equal(r.text, LIST_DOC);
});

test('a duplicated entry is removed completely', () => {
  const doubled = LIST_DOC.replace('.DefaultReservedPlayerIds=76561198000000002',
    '.DefaultReservedPlayerIds=76561198000000002\r\n.DefaultReservedPlayerIds=76561198000000002');
  const r = drop(doubled, '76561198000000002');
  assert.equal(r.text.includes('76561198000000002'), false);
});

test('an empty list still accepts its first member, after the directive', () => {
  const empty = '[/Script/WDGame.WDGameSession]\r\n!DefaultReservedPlayerIds=ClearArray\r\n';
  const r = add(empty, '76561198000000001');
  assert.deepEqual(r.text.split('\r\n').slice(0, 3),
    ['[/Script/WDGame.WDGameSession]', '!DefaultReservedPlayerIds=ClearArray', '.DefaultReservedPlayerIds=76561198000000001']);
});

test('the new line copies the spacing of the ones around it', () => {
  const spaced = LIST_DOC.replace(/\.DefaultReservedPlayerIds=/g, '.DefaultReservedPlayerIds = ');
  assert.match(add(spaced, '76561198000000003').text, /\.DefaultReservedPlayerIds = 76561198000000003/);
});

// The whole reason setConfigValue and this are separate functions.
test('an ordinary setting is not quietly turned into a list', () => {
  assert.throws(() => setConfigListMember(LIST_DOC, {
    section: RES.section, key: 'ServerName', value: 'x', action: 'add',
  }), (e) => e.code === 'not_a_list');
});

test('a list this server does not have is not invented', () => {
  assert.throws(() => setConfigListMember(LIST_DOC, {
    section: RES.section, key: 'SomeOtherList', value: 'x', action: 'add',
  }), (e) => e.code === 'no_list');
});

test('an unknown section is refused', () => {
  assert.throws(() => setConfigListMember(LIST_DOC, { section: 'Nope', key: 'X', value: 'y' }),
    (e) => e.code === 'no_section');
});

test('a value with a line break or an equals sign is refused', () => {
  for (const bad of ['1\n.DefaultReservedPlayerIds=2', 'a=b']) {
    assert.throws(() => add(LIST_DOC, bad), (e) => e.code === 'bad_value');
  }
});

test('a same-named list in another section is not touched', () => {
  const two = `${LIST_DOC}\r\n!DefaultReservedPlayerIds=ClearArray\r\n.DefaultReservedPlayerIds=999`;
  const r = drop(two, '999');
  assert.deepEqual(listConfigMembers(r.text, RES), ['76561198000000001', '76561198000000002'],
    'the first section is untouched');
});

test('a plain LF document stays plain LF', () => {
  const lf = LIST_DOC.replace(/\r\n/g, '\n');
  assert.equal(add(lf, '76561198000000003').text.includes('\r'), false);
});

test('a value is read from the section asked for, not the first match anywhere', () => {
  // MaxReservedSlots is 6 here and 1 in [Other]; reading the wrong one would
  // cap the reserved slots at one donor.
  assert.equal(getConfigValue(LIST_DOC, { section: '/Script/WDGame.WDGameSession', key: 'MaxReservedSlots' }), '6');
  assert.equal(getConfigValue(LIST_DOC, { section: 'Other', key: 'MaxReservedSlots' }), '1');
  assert.equal(getConfigValue(LIST_DOC, { section: 'Other', key: 'Nope' }), null);
  assert.equal(getConfigValue(LIST_DOC, { section: '/Script/WDGame.WDGameSession', key: 'DefaultReservedPlayerIds' }),
    null, 'a list is not an ordinary value');
});

// The RCON section is how core reaches the server at all. Editing it through
// RCON is sawing off the branch you sit on: it works until the next restart,
// and then nothing in Discord can undo it.
test('the RCON section cannot be edited from here, as a value or a list', async () => {
  const { isProtectedSection, setConfigListMember } = await import('../src/configedit.js');
  assert.equal(isProtectedSection('/Script/WDRCON.WDRCONSettings'), true);
  assert.equal(isProtectedSection('/Script/WDGame.WDGameSession'), false);
  assert.throws(() => setConfigValue(DOC, { section: '/Script/WDRCON.WDRCONSettings', key: 'MaxPlayers', value: '9' }),
    (e) => e.code === 'protected' && /xREALM/.test(e.message));
  assert.throws(() => setConfigListMember(DOC, { section: '/Script/WDRCON.WDRCONSettings', key: 'X', value: '1' }),
    (e) => e.code === 'protected');
});
