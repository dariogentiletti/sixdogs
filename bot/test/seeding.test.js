import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seedBoard, callInMessage, SEED_FOOTER } from '../src/seeding.js';
import { rolePlan, channelPlan } from '../src/setup.js';
import { SEED_PING_ROLE_NAME, roleMenu } from '../src/rolemenu.js';

const summary = (over = {}) => ({
  ok: true, ready: 8, playersOn: 0, heading: 8, target: 20, needed: 12,
  fire: false, reason: '8 of 20 ready', serverOk: true, minPledges: 5,
  pledgeMinutes: 45, cooldownMinutes: 45, pledges: [], lastPingAt: null, ...over,
});

const text = (p) => JSON.stringify(p.embeds[0]);
const buttons = (p) => (p.components[0]?.toJSON().components ?? []).map((c) => c.custom_id);

test('the board counts up to the target and names who is in', () => {
  const p = seedBoard(summary(), { names: ['Rook', 'Vex', 'Mako'] });
  assert.match(text(p), /8 of 20 ready/);
  assert.match(text(p), /Rook, Vex, Mako/);
  assert.equal(p.embeds[0].footer.text.startsWith(SEED_FOOTER), true, 'findable again after a restart');
});

test('the button says what it does', () => {
  const labels = seedBoard(summary()).components[0].toJSON().components.map((c) => c.label);
  assert.deepEqual(labels, ['I want to play', 'Take me off']);
});

// A match in progress is the normal case. The board has to show both numbers,
// because "8 of 20 ready" next to a match with 12 people in it is a lie.
test('a match already running: players on and people ready are both counted', () => {
  const p = seedBoard(summary({ playersOn: 12, ready: 5, heading: 17, needed: 3 }));
  assert.match(text(p), /12 playing, 5 more ready/);
  assert.match(text(p), /3 to go/);
  assert.deepEqual(buttons(p), ['seed:in', 'seed:out'], 'you can still say you want in');
});

test('one more click would tip it over: the board says so instead of counting down to nothing', () => {
  const p = seedBoard(summary({ playersOn: 12, ready: 8, heading: 20, needed: 0 }));
  assert.match(text(p), /Calling everyone in/);
});

// The case that was wrong before: clicking "I want to play" on a server that
// already has a full match in it. There is nothing to organise, so the board
// stops asking and tells you how to get in.
test('enough people already playing: no buttons, just how to join', () => {
  const p = seedBoard(summary({ playersOn: 34, heading: 34, needed: 0 }), { serverId: 'abc-123' });
  assert.match(text(p), /34 playing right now/);
  assert.deepEqual(p.components, [], 'no pledge button for a match that is already happening');
  assert.match(JSON.stringify(p.embeds[0].fields), /abc-123/);
});

test('long lists are trimmed rather than overflowing the embed', () => {
  const names = Array.from({ length: 30 }, (_, i) => `Player${i}`);
  const p = seedBoard(summary({ ready: 30 }), { names });
  assert.match(text(p), /and 18 more/);
});

test('an empty list invites the first person in rather than looking broken', () => {
  assert.match(text(seedBoard(summary({ ready: 0, heading: 0 }))), /Nobody yet/);
});

test('a server that is down says so instead of collecting names for nothing', () => {
  assert.match(text(seedBoard(summary({ serverOk: false }))), /isn't answering/);
});

// The list is emptied when a ping fires, so without this the board drops back
// to "0 ready" and reads as though nothing ever happened.
test('a recent call-in is still visible on the board afterwards', () => {
  const p = seedBoard(summary({ ready: 0, lastPingAt: '2026-09-21T20:00:00Z' }));
  assert.match(text(p), /last called in <t:\d+:R>/);
});

test('the board shows the Server ID, since WARDOGS has no join link', () => {
  const p = seedBoard(summary(), { serverId: 'abc-123' });
  assert.match(JSON.stringify(p.embeds[0].fields), /abc-123/);
  assert.equal(seedBoard(summary()).embeds[0].fields, undefined, 'and nothing at all without one');
});

test('the board never mentions anyone', () => {
  assert.deepEqual(seedBoard(summary()).allowedMentions, { parse: [] });
});

test('the call-in pings only the opt-in role, nobody else', () => {
  const m = callInMessage({ ready: 11, roleId: 'R-Alerts', serverId: 'abc-123' });
  assert.match(m.content, /<@&R-Alerts>/);
  assert.match(m.content, /11 of us are ready/);
  assert.match(m.content, /abc-123/);
  assert.deepEqual(m.allowedMentions, { roles: ['R-Alerts'] });
});

test('a call-in that tops up a running match says so', () => {
  const m = callInMessage({ ready: 8, onServer: 12, roleId: 'R-Alerts', serverId: null });
  assert.match(m.content, /12 are on the server and 8 more of us are ready/);
});

test('no ping role yet: the call still goes out, silently, rather than not at all', () => {
  const m = callInMessage({ ready: 10, roleId: null, serverId: null });
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
