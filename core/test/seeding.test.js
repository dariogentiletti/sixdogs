import test from 'node:test';
import assert from 'node:assert/strict';
import { livePledges, shouldPing } from '../src/seeding.js';

const NOW = Date.parse('2026-09-21T20:00:00Z');
const minsAgo = (n) => new Date(NOW - n * 60_000).toISOString();
const ready = (n, ago = 1) => Array.from({ length: n }, (_, i) => ({ discordId: String(i), at: minsAgo(ago) }));
const ask = (over) => shouldPing({ target: 20, minPledges: 5, now: NOW, ...over });

test('a pledge goes stale after the window', () => {
  const pledges = [...ready(3, 5), ...ready(4, 120)];
  assert.equal(livePledges(pledges, { now: NOW, pledgeMinutes: 45 }).length, 3);
});

test('not enough people: no ping, and it says how many short', () => {
  const r = ask({ pledges: ready(8) });
  assert.equal(r.fire, false);
  assert.equal(r.ready, 8);
  assert.equal(r.needed, 12);
  assert.match(r.reason, /8 of 20 ready/);
});

test('stale pledges do not count toward the target', () => {
  const r = ask({ pledges: [...ready(4, 2), ...ready(20, 300)] });
  assert.equal(r.fire, false);
  assert.equal(r.ready, 4);
});

// The point of the whole rewrite: a match in progress is the normal case, not
// a reason to switch off. Twelve on plus eight ready is a real match.
test('players already on the server count toward the target', () => {
  const r = ask({ pledges: ready(8), playersOn: 12 });
  assert.equal(r.heading, 20);
  assert.equal(r.fire, true);
  assert.match(r.reason, /12 playing and 8 ready/);
});

test('a match running but still short says so in both numbers', () => {
  const r = ask({ pledges: ready(5), playersOn: 6 });
  assert.equal(r.fire, false);
  assert.equal(r.heading, 11);
  assert.equal(r.needed, 9);
  assert.match(r.reason, /6 playing and 5 ready, 9 short of 20/);
});

test('a ping is never spent on one or two people, however close the target', () => {
  // 19 on, 1 ready: that would clear the bar, but calling the role in to fetch
  // a single player is how a ping stops meaning anything.
  const r = ask({ pledges: ready(1), playersOn: 19 });
  assert.equal(r.fire, false);
  assert.match(r.reason, /isn't worth it for fewer than 5/);
});

test('minPledges can never be higher than the target itself', () => {
  const r = shouldPing({ pledges: ready(3), target: 3, minPledges: 10, now: NOW });
  assert.equal(r.fire, true);
});

test('the server is already full enough: no ping', () => {
  const r = ask({ pledges: ready(12), playersOn: 30 });
  assert.equal(r.fire, false);
  assert.match(r.reason, /already playing/);
});

test('cooldown blocks a second ping and says how long is left', () => {
  const r = ask({ pledges: ready(20), lastPingAt: minsAgo(10), cooldownMinutes: 45 });
  assert.equal(r.fire, false);
  assert.match(r.reason, /35 min/);
});

test('once the cooldown is up, it can fire again', () => {
  const r = ask({ pledges: ready(20), lastPingAt: minsAgo(60), cooldownMinutes: 45 });
  assert.equal(r.fire, true);
});

test('a server nobody can reach never gets people called to it', () => {
  const r = ask({ pledges: ready(40), serverOk: false });
  assert.equal(r.fire, false);
  assert.match(r.reason, /isn't answering/);
});

test('no pledges at all is a safe no, not a crash', () => {
  const r = shouldPing();
  assert.equal(r.fire, false);
  assert.equal(r.ready, 0);
});
