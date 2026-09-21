// A standing decision from the owner: SIXDOGS never moves anyone between teams
// on its own. Moving a player is an admin typing /move and nothing else.
//
// This is a structural test on purpose. The rule is about what the code must
// NOT grow, and the easy mistake is a future balance rule that quietly calls
// setFaction from a tick. Behaviour tests cannot catch code that does not exist
// yet; this can.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const SRC = new URL('../src/', import.meta.url).pathname;
const files = readdirSync(SRC).filter((f) => f.endsWith('.js'));

// Where a faction change is allowed to come from: the client method that makes
// the call, and the /move command handler that an admin triggers.
const ALLOWED = new Set(['core-client.js', 'commands.js']);

test('nothing outside the /move command changes a player faction', () => {
  for (const f of files) {
    if (ALLOWED.has(f)) continue;
    const text = readFileSync(join(SRC, f), 'utf8');
    assert.doesNotMatch(text, /setFaction\s*\(/,
      `${f} changes a player's faction. Only the /move admin command may do that: `
      + 'automatic team balancing is ruled out (see stack.json rules and CLAUDE.md).');
  }
});

test('in commands.js the only faction change sits in the /move handler', () => {
  const text = readFileSync(join(SRC, 'commands.js'), 'utf8');
  const calls = [...text.matchAll(/setFaction\s*\(/g)];
  assert.equal(calls.length, 1, 'exactly one place changes a faction');

  // It must be inside `async move(i) {`, not in a tick or a timer.
  const start = text.indexOf('async move(i)');
  assert.ok(start !== -1, 'the /move handler still exists');
  const end = text.indexOf('\n    },', start);
  assert.ok(calls[0].index > start && calls[0].index < end,
    'the faction change must be inside the /move handler');
});

test('the commander loop never touches factions', () => {
  // The commander picker runs every few seconds and sees everyone's faction.
  // It is the most likely place for a balance rule to be bolted on.
  const text = readFileSync(join(SRC, 'commander.js'), 'utf8');
  // Careful with the patterns: "./factions.js" is an ordinary import here.
  for (const forbidden of [/setFaction/, /internal\/players\/[^'"`]*\/faction/, /\bbalanc(e|ing)\b/i]) {
    assert.doesNotMatch(text, forbidden, `commander.js must not do team balancing (${forbidden})`);
  }
});
