// Reading the Unreal-style settings document. The trap is !Key=ClearArray:
// it is a directive that empties a list, not a value of Key.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseConfigText, findSection, summarise, renderSection } from '../src/serverconfig.js';

const SAMPLE = `
; a comment
# another one

[/Script/Wardogs.ServerSettings]
ServerName=SIXDOGS
MaxPlayers=99
bKillCam=False

[/Script/Wardogs.MapRotation]
!Maps=ClearArray
.Maps=Harbor
.Maps=Ridge
.Maps=Foundry
bEnabled=True
`;

test('sections and plain settings are read', () => {
  const s = parseConfigText(SAMPLE);
  assert.deepEqual(s.map((x) => x.name), [
    '/Script/Wardogs.ServerSettings',
    '/Script/Wardogs.MapRotation',
  ]);
  const first = findSection(s, '/script/wardogs.serversettings');
  assert.ok(first, 'section lookup is case-insensitive');
  assert.deepEqual(first.entries.map((e) => [e.key, e.value, e.kind]), [
    ['ServerName', 'SIXDOGS', 'set'],
    ['MaxPlayers', '99', 'set'],
    ['bKillCam', 'False', 'set'],
  ]);
});

test('!Key=ClearArray is a directive, not a value of Key', () => {
  const rot = findSection(parseConfigText(SAMPLE), '/Script/Wardogs.MapRotation');
  const maps = rot.entries.filter((e) => e.key === 'Maps');
  assert.equal(maps[0].kind, 'clear', 'the !Maps line is the clear directive');
  assert.deepEqual(maps.slice(1).map((e) => e.kind), ['append', 'append', 'append']);
  assert.deepEqual(maps.slice(1).map((e) => e.value), ['Harbor', 'Ridge', 'Foundry'], 'order kept');

  // The one that matters: nothing reports Maps as having the value "ClearArray".
  const asScalar = rot.entries.find((e) => e.key === 'Maps' && e.kind === 'set');
  assert.equal(asScalar, undefined);
});

test('comments and blank lines are ignored; other sections are unaffected', () => {
  const rot = findSection(parseConfigText(SAMPLE), '/Script/Wardogs.MapRotation');
  assert.ok(rot.entries.some((e) => e.key === 'bEnabled' && e.value === 'True' && e.kind === 'set'));
  assert.equal(rot.entries.filter((e) => e.key.startsWith(';') || e.key.startsWith('#')).length, 0);
});

test('a value containing = or spaces survives intact', () => {
  const s = parseConfigText('[A]\nMotd=Welcome to SIXDOGS = play as a team\nPath=C:\\Games\\W\n');
  const a = findSection(s, 'A');
  assert.equal(a.entries[0].value, 'Welcome to SIXDOGS = play as a team');
  assert.equal(a.entries[1].value, 'C:\\Games\\W');
});

test('an empty value is kept, not dropped', () => {
  const a = findSection(parseConfigText('[A]\nPassword=\n'), 'A');
  assert.deepEqual(a.entries, [{ key: 'Password', value: '', kind: 'set' }]);
});

test('summaries count lists once, not per member', () => {
  const s = parseConfigText(SAMPLE);
  assert.equal(summarise(findSection(s, '/Script/Wardogs.ServerSettings')), '3 settings');
  // bEnabled is the only scalar; Maps is one list despite four lines.
  assert.equal(summarise(findSection(s, '/Script/Wardogs.MapRotation')), '1 setting, 1 list');
});

test('rendering marks list members and the clear directive distinctly', () => {
  const out = renderSection(findSection(parseConfigText(SAMPLE), '/Script/Wardogs.MapRotation'));
  assert.match(out, /Maps = \(list cleared/);
  assert.match(out, /Maps \+= Harbor/);
  assert.match(out, /bEnabled = True/);
});

test('rubbish in does not throw', () => {
  for (const bad of ['', null, undefined, '[unclosed\nnonsense', '=novalue', '   ']) {
    assert.doesNotThrow(() => parseConfigText(bad));
  }
  assert.deepEqual(parseConfigText(''), []);
});
