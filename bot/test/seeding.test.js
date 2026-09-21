import { test } from 'node:test';
import assert from 'node:assert/strict';
import { seedBoard, callInMessage, SEED_FOOTER } from '../src/seeding.js';
import { rolePlan, channelPlan } from '../src/setup.js';
import { SEED_PING_ROLE_NAME, roleMenu } from '../src/rolemenu.js';

const summary = (over = {}) => ({
  ok: true, ready: 4, target: 10, needed: 6, fire: false, reason: '4 of 10 ready',
  playersOn: 0, serverOk: true, quietAbove: 10, pledgeMinutes: 45, cooldownMinutes: 45,
  pledges: [], lastPingAt: null, ...over,
});

const text = (p) => JSON.stringify(p.embeds[0]);

test('the board counts up to the target and names who is in', () => {
  const p = seedBoard(summary(), { names: ['Rook', 'Vex', 'Mako', 'Juno'] });
  assert.match(text(p), /4 of 10 ready/);
  assert.match(text(p), /Rook, Vex, Mako, Juno/);
  assert.equal(p.embeds[0].footer.text.startsWith(SEED_FOOTER), true, 'findable again after a restart');
});

test('long lists are trimmed rather than overflowing the embed', () => {
  const names = Array.from({ length: 30 }, (_, i) => `Player${i}`);
  const p = seedBoard(summary({ ready: 30 }), { names });
  assert.match(text(p), /and 18 more/);
});

test('an empty list invites the first person in rather than looking broken', () => {
  assert.match(text(seedBoard(summary({ ready: 0 }))), /Be the first/);
});

test('a busy server says join, not seed', () => {
  const p = seedBoard(summary({ playersOn: 34, quietAbove: 10 }));
  assert.match(text(p), /34 playing right now/);
  assert.doesNotMatch(text(p), /Be the first/);
});

test('a server that is down says so instead of collecting names for nothing', () => {
  assert.match(text(seedBoard(summary({ serverOk: false }))), /isn't answering/);
});

test('the board shows the Server ID, since WARDOGS has no join link', () => {
  const p = seedBoard(summary(), { serverId: 'abc-123' });
  assert.match(JSON.stringify(p.embeds[0].fields), /abc-123/);
  assert.equal(seedBoard(summary()).embeds[0].fields, undefined, 'and nothing at all without one');
});

test('the board has both buttons and never mentions anyone', () => {
  const p = seedBoard(summary());
  const ids = p.components[0].toJSON().components.map((c) => c.custom_id);
  assert.deepEqual(ids, ['seed:in', 'seed:out']);
  assert.deepEqual(p.allowedMentions, { parse: [] });
});

test('the call-in pings only the opt-in role, nobody else', () => {
  const m = callInMessage({ ready: 11, roleId: 'R-Alerts', serverId: 'abc-123' });
  assert.match(m.content, /<@&R-Alerts>/);
  assert.match(m.content, /11 players are ready/);
  assert.match(m.content, /abc-123/);
  assert.deepEqual(m.allowedMentions, { roles: ['R-Alerts'] });
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
  // No channel-specific overwrites: it inherits INFO's read-only-for-everyone
  // rules. Buttons are interactions, not messages, so they work anyway.
  assert.equal(info.channels.find((c) => c.name === 'start-a-match').ow, undefined);
});
