import test from 'node:test';
import assert from 'node:assert/strict';
import { livePledges, shouldPing } from '../src/seeding.js';

const NOW = Date.parse('2026-09-21T20:00:00Z');
const minsAgo = (n) => new Date(NOW - n * 60_000).toISOString();
const ready = (n, ago = 1) => Array.from({ length: n }, (_, i) => ({ discordId: String(i), at: minsAgo(ago) }));

test('a pledge goes stale after the window', () => {
  const pledges = [...ready(3, 5), ...ready(4, 120)];
  assert.equal(livePledges(pledges, { now: NOW, pledgeMinutes: 45 }).length, 3);
});

test('not enough people ready: no ping, and it says how many short', () => {
  const r = shouldPing({ pledges: ready(4), target: 10, now: NOW });
  assert.equal(r.fire, false);
  assert.equal(r.ready, 4);
  assert.equal(r.needed, 6);
  assert.match(r.reason, /4 of 10/);
});

test('stale pledges do not count toward the target', () => {
  // Ten people said yes, but six of them said it hours ago and have gone out.
  const r = shouldPing({ pledges: [...ready(4, 2), ...ready(6, 300)], target: 10, now: NOW });
  assert.equal(r.fire, false);
  assert.equal(r.ready, 4);
});

test('enough people ready and a quiet server: call everyone in', () => {
  const r = shouldPing({ pledges: ready(10), playersOn: 0, target: 10, now: NOW });
  assert.equal(r.fire, true);
  assert.equal(r.needed, 0);
});

test('the server is already busy: no ping', () => {
  const r = shouldPing({ pledges: ready(12), playersOn: 30, target: 10, now: NOW });
  assert.equal(r.fire, false);
  assert.match(r.reason, /already playing/);
});

test('quietAbove can be set below the target', () => {
  // Six on already: not a full match, but enough that people will join by
  // themselves. Don't spend a ping on it.
  const r = shouldPing({ pledges: ready(10), playersOn: 6, target: 10, quietAbove: 6, now: NOW });
  assert.equal(r.fire, false);
});

test('cooldown blocks a second ping and says how long is left', () => {
  const r = shouldPing({ pledges: ready(10), lastPingAt: minsAgo(10), cooldownMinutes: 45, now: NOW });
  assert.equal(r.fire, false);
  assert.match(r.reason, /35 min/);
});

test('once the cooldown is up, it can fire again', () => {
  const r = shouldPing({ pledges: ready(10), lastPingAt: minsAgo(60), cooldownMinutes: 45, now: NOW });
  assert.equal(r.fire, true);
});

test('a server nobody can reach never gets people called to it', () => {
  const r = shouldPing({ pledges: ready(20), serverOk: false, now: NOW });
  assert.equal(r.fire, false);
  assert.match(r.reason, /isn't answering/);
});

test('no pledges at all is a safe no, not a crash', () => {
  const r = shouldPing();
  assert.equal(r.fire, false);
  assert.equal(r.ready, 0);
});
