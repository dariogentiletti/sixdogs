import test from 'node:test';
import assert from 'node:assert/strict';
import { livePledges, seedDecision } from '../src/seeding.js';

const NOW = Date.parse('2026-09-21T20:00:00Z');
const minsAgo = (n) => new Date(NOW - n * 60_000).toISOString();
const want = (n, ago = 1) => Array.from({ length: n }, (_, i) => ({ discordId: String(i), at: minsAgo(ago) }));
const ask = (over) => seedDecision({ target: 45, nudgeAt: 10, now: NOW, ...over });

test('a name goes stale after the window', () => {
  const pledges = [...want(3, 5), ...want(4, 400)];
  assert.equal(livePledges(pledges, { now: NOW, pledgeMinutes: 180 }).length, 3);
});

// The complaint that produced this: click, go and warm up in the server, and
// your name used to vanish. Being in the server is not the opposite of wanting
// to play, so nothing here looks at who is on it.
test('being on the server does not take your name off the list', () => {
  const r = ask({ pledges: want(12), playersOn: 12 });
  assert.equal(r.ready, 12, 'all twelve still count');
});

test('below the nudge bar, nothing is sent', () => {
  const r = ask({ pledges: want(4) });
  assert.equal(r.action, null);
  assert.match(r.reason, /4 of 45 want to play/);
});

test('crossing the nudge bar tells the role, to recruit the rest', () => {
  const r = ask({ pledges: want(10) });
  assert.equal(r.action, 'nudge');
  assert.equal(r.ready, 10);
  assert.equal(r.needed, 35);
});

test('the role is only told once per round', () => {
  const r = ask({ pledges: want(20), lastNudgeAt: minsAgo(90) });
  assert.equal(r.action, null);
  assert.match(r.reason, /already been told/);
});

test('after a call-in, the next round can be advertised again', () => {
  const r = ask({ pledges: want(12), lastNudgeAt: minsAgo(300), lastCallAt: minsAgo(200) });
  assert.equal(r.action, 'nudge', 'the nudge is older than the last call, so it was a previous round');
});

test('reaching the target calls everyone in', () => {
  const r = ask({ pledges: want(45) });
  assert.equal(r.action, 'call');
  assert.equal(r.needed, 0);
});

// The bug this guards against: the recruiting message blocking the very match
// it recruited for. The two kinds keep separate cooldowns for exactly this.
test('a recent nudge never holds back the call it recruited for', () => {
  const r = ask({ pledges: want(45), lastNudgeAt: minsAgo(2) });
  assert.equal(r.action, 'call');
});

test('cooldown blocks a second call and says how long is left', () => {
  const r = ask({ pledges: want(45), lastCallAt: minsAgo(10), cooldownMinutes: 45 });
  assert.equal(r.action, null);
  assert.match(r.reason, /35 min/);
});

test('once the cooldown is up, it can call again', () => {
  const r = ask({ pledges: want(45), lastCallAt: minsAgo(60), cooldownMinutes: 45 });
  assert.equal(r.action, 'call');
});

test('stale names do not count toward the target', () => {
  const r = ask({ pledges: [...want(5, 10), ...want(50, 600)] });
  assert.equal(r.ready, 5);
  assert.equal(r.action, null);
});

test('the match is already running: nothing is sent', () => {
  const r = ask({ pledges: want(45), playersOn: 50 });
  assert.equal(r.action, null);
  assert.match(r.reason, /the match is on/);
});

test('a server nobody can reach never gets people called to it', () => {
  const r = ask({ pledges: want(60), serverOk: false });
  assert.equal(r.action, null);
  assert.match(r.reason, /isn't answering/);
});

test('a nudge bar above the target could never fire, so it is capped', () => {
  const r = seedDecision({ pledges: want(5), target: 5, nudgeAt: 50, now: NOW });
  assert.equal(r.action, 'call');
});

test('an empty list is a safe nothing, not a crash', () => {
  const r = seedDecision();
  assert.equal(r.action, null);
  assert.equal(r.ready, 0);
});
