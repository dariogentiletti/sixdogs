import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seedBoard, callInMessage, SEED_FOOTER } from '../src/seeding.js';
import { rolePlan, channelPlan } from '../src/setup.js';
import { SEED_PING_ROLE_NAME, roleMenu } from '../src/rolemenu.js';

const summary = (over = {}) => ({
  ok: true, ready: 12, playersOn: 0, target: 45, needed: 33, nudgeAt: 10,
  action: null, reason: '12 of 45 want to play', serverOk: true,
  pledgeMinutes: 180, cooldownMinutes: 45, pledges: [], lastCallAt: null, lastNudgeAt: null, ...over,
});
const names = (n) => Array.from({ length: n }, (_, i) => `Player${i}`);
const text = (p) => JSON.stringify(p.embeds[0]);

test('the board counts toward the target and is findable again after a restart', () => {
  const p = seedBoard(summary(), { names: ['Rook', 'Vex', 'Mako'] });
  assert.match(text(p), /12 of 45 want to play/);
  assert.equal(p.embeds[0].footer.text.startsWith(SEED_FOOTER), true);
});

test('the button says what it does', () => {
  const labels = seedBoard(summary()).components[0].toJSON().components.map((c) => c.label);
  assert.deepEqual(labels, ['I want to play', 'Take me off']);
});

// Seeing your own name on the board is the confirmation that the click worked,
// so a list that shows a sample of itself can't do that job.
test('EVERY name on the list is shown, not a sample', () => {
  const p = seedBoard(summary({ ready: 40 }), { names: names(40) });
  for (const n of names(40)) assert.match(text(p), new RegExp(n + '\\b'), `${n} is on the board`);
});

test('an absurd list is still capped, so the embed can never be rejected', () => {
  const p = seedBoard(summary({ ready: 400 }), { names: names(400) });
  assert.ok(p.embeds[0].description.length < 4096, 'within Discord\'s limit');
  assert.match(text(p), /more/);
});

// The complaint that produced all this: click, then go and warm up in the
// server, and your name used to disappear off the board.
test('the board promises your name stays on while you wait in the server', () => {
  assert.match(text(seedBoard(summary())), /stays on whether you wait in the server/);
});

test('an empty list invites the first person in rather than looking broken', () => {
  assert.match(text(seedBoard(summary({ ready: 0, needed: 45 }))), /Nobody yet/);
});

test('the match is already running: no buttons, just how to join', () => {
  const p = seedBoard(summary({ playersOn: 50 }), { serverId: 'abc-123' });
  assert.match(text(p), /50 playing right now/);
  assert.deepEqual(p.components, [], 'nothing to queue for, it is already happening');
  assert.match(JSON.stringify(p.embeds[0].fields), /abc-123/);
});

test('a server that is down says so instead of collecting names for nothing', () => {
  assert.match(text(seedBoard(summary({ serverOk: false }))), /isn't answering/);
});

// The list is emptied by a call-in, so without this the board drops back to
// "0 of 45" and reads as though nothing ever happened.
test('a recent call-in is still visible on the board afterwards', () => {
  const p = seedBoard(summary({ ready: 0, lastCallAt: '2026-09-21T20:00:00Z' }));
  assert.match(text(p), /last called in <t:\d+:R>/);
});

test('the board never mentions anyone', () => {
  assert.deepEqual(seedBoard(summary()).allowedMentions, { parse: [] });
});

test('the nudge recruits, shows the running count and points at the button', () => {
  const m = callInMessage({ kind: 'nudge', ready: 10, target: 45, roleId: 'R-Alerts', channelId: 'C1' });
  assert.match(m.content, /<@&R-Alerts>/);
  assert.match(m.content, /10 people want to play/);
  assert.match(m.content, /\(10\/45\)/);
  assert.match(m.content, /I want to play/);
  assert.match(m.content, /<#C1>/);
  assert.deepEqual(m.allowedMentions, { roles: ['R-Alerts'] });
});

test('one person is not "1 people"', () => {
  assert.match(callInMessage({ kind: 'nudge', ready: 1, target: 45 }).content, /1 person wants/);
});

test('the call-in says the match is on and how to get in', () => {
  const m = callInMessage({ kind: 'call', ready: 45, target: 45, roleId: 'R-Alerts', serverId: 'abc-123' });
  assert.match(m.content, /45 of us want to play/);
  assert.match(m.content, /abc-123/);
  assert.deepEqual(m.allowedMentions, { roles: ['R-Alerts'] });
});

test('no ping role yet: the message still goes out, silently, rather than not at all', () => {
  const m = callInMessage({ kind: 'call', ready: 45, target: 45, roleId: null, serverId: null });
  assert.doesNotMatch(m.content, /<@&/);
  assert.deepEqual(m.allowedMentions, { parse: [] });
});

test('the ping role exists, is opt-in in #roles, and can be mentioned', () => {
  const role = rolePlan('Commander Pool').find((r) => r.name === SEED_PING_ROLE_NAME);
  assert.ok(role, 'the role is in the plan');
  assert.equal(role.mentionable, true);
  assert.deepEqual(role.permissions, [], 'it grants nothing, it only gets pinged');
  assert.ok(roleMenu().some((r) => r.roleName === SEED_PING_ROLE_NAME), 'people can take it themselves');
});

test('#start-a-match is an INFO channel, so only the bot posts there', () => {
  const info = channelPlan().find((c) => c.category === 'INFO');
  assert.ok(info.channels.some((c) => c.name === 'start-a-match'));
  assert.equal(info.channels.find((c) => c.name === 'start-a-match').ow, undefined);
});
