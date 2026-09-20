import { test } from 'node:test';
import assert from 'node:assert/strict';
import { roundPoints, commanderTerms, ratedTerms } from '../src/ratings.js';

test('round points: +1 / -1 / -3, capped at +-3 per match', () => {
  assert.equal(roundPoints({ good: 2 }), 2);
  assert.equal(roundPoints({ good: 12 }), 3);
  assert.equal(roundPoints({ good: 4, poor: 2 }), 2);
  assert.equal(roundPoints({ toxic: 1 }), -3);
  assert.equal(roundPoints({ toxic: 5, good: 1 }), -3);
  assert.equal(roundPoints({}), 0);
});

test('commander terms from the log', () => {
  const t0 = Date.parse('2026-09-19T20:00:00Z');
  const at = (min) => new Date(t0 + min * 60_000).toISOString();
  const rows = [
    { faction: 'blue', discord_id: 'A', event: 'accepted', at: at(2) },
    { faction: 'blue', discord_id: 'A', event: 'removed', at: at(12) },   // 10 min
    { faction: 'blue', discord_id: 'B', event: 'claimed', at: at(13) },    // to match end: 47 min
    { faction: 'red', discord_id: 'C', event: 'accepted', at: at(5) },
    { faction: 'red', discord_id: 'C', event: 'removed', at: at(6) },     // 1 min
    { faction: 'red', discord_id: 'C', event: 'accepted', at: at(30) },   // again: +30 min
  ];
  const terms = commanderTerms(rows, at(60));
  const get = (f, d) => terms.find((x) => x.faction === f && x.discordId === d)?.servedSec;
  assert.equal(get('blue', 'A'), 600);
  assert.equal(get('blue', 'B'), 47 * 60);
  assert.equal(get('red', 'C'), 31 * 60);
});

test('terms keep their time windows; rated terms: 5+ min, top 3 by time', () => {
  const t0 = Date.parse('2026-09-19T20:00:00Z');
  const at = (min) => new Date(t0 + min * 60_000).toISOString();
  const rows = [
    { faction: 'blue', discord_id: 'A', event: 'accepted', at: at(0) },
    { faction: 'blue', discord_id: 'A', event: 'removed', at: at(10) },
    { faction: 'blue', discord_id: 'B', event: 'claimed', at: at(10) },
    { faction: 'blue', discord_id: 'B', event: 'removed', at: at(13) },   // 3 min: too short
    { faction: 'blue', discord_id: 'C', event: 'accepted', at: at(13) },
    { faction: 'blue', discord_id: 'C', event: 'removed', at: at(20) },
    { faction: 'blue', discord_id: 'D', event: 'accepted', at: at(20) },
    { faction: 'blue', discord_id: 'D', event: 'removed', at: at(26) },
    { faction: 'blue', discord_id: 'E', event: 'accepted', at: at(26) },  // to the end: 34 min
  ];
  const terms = commanderTerms(rows, at(60));
  assert.deepEqual(terms.find((t) => t.discordId === 'A').intervals, [[at(0), at(10)]]);
  const [blue] = ratedTerms(terms, { minServeSec: 300, maxPerFaction: 3 });
  assert.deepEqual(blue.commanders.map((c) => c.discordId), ['E', 'A', 'C']); // D (6 min) is 4th, B too short
});
