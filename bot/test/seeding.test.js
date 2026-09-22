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

// Somebody arriving in the channel for the first time has to recognise their
// own situation before a button means anything, so the board leads with the
// problem rather than with the mechanism.
test('the board names the situation it is for before explaining itself', () => {
  const t = text(seedBoard(summary()));
  assert.match(t, /Not enough people on to play/);
  assert.match(t, /without sitting in an empty server/);
});

// The complaint that produced all this: click, then go and warm up in the
// server, and your name used to disappear off the board.
test('the board promises your name stays on while you go and do something else', () => {
  const t = text(seedBoard(summary()));
  assert.match(t, /It stays there, so go and do something else/);
  assert.match(t, /not holding a seat/);
});

test('the board says what actually happens once enough people want in', () => {
  assert.match(text(seedBoard(summary())), /of us want a game, everyone gets pinged at once/);
  assert.match(text(seedBoard(summary())), /45/, 'with the real target in it');
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

// ---- the explainer picture above the board ----

import { stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Seeding, SEED_GUIDE } from '../src/seeding.js';

const GUIDE_PATH = fileURLToPath(new URL(`../../content/${SEED_GUIDE}`, import.meta.url));
const guideSize = async () => (await stat(GUIDE_PATH)).size;

function channelWith(messages) {
  const sent = [];
  const deleted = [];
  const msgs = messages.map((m, i) => ({
    id: String(i),
    author: { id: 'BOT' },
    attachments: new Map((m.attachments ?? []).map((a, j) => [String(j), a])),
    delete: async () => { deleted.push(String(i)); },
  }));
  return {
    name: 'start-a-match',
    sent,
    deleted,
    messages: { fetch: async () => new Map(msgs.map((m) => [m.id, m])) },
    send: async (payload) => { sent.push(payload); return { id: 'new' }; },
  };
}

const seeder = () => {
  const s = new Seeding({ core: {}, config: { seedChannel: 'start-a-match' }, log: async () => {} });
  s.attach({ client: { user: { id: 'BOT' } } });
  return s;
};

test('the picture goes up when there is none', async () => {
  const ch = channelWith([]);
  assert.equal(await seeder().ensureGuide(ch), true);
  assert.equal(ch.sent.length, 1);
  assert.equal(ch.sent[0].files[0].name, SEED_GUIDE);
});

test('a picture that matches the file is left alone', async () => {
  const ch = channelWith([{ attachments: [{ name: SEED_GUIDE, size: await guideSize() }] }]);
  assert.equal(await seeder().ensureGuide(ch), false);
  assert.equal(ch.sent.length, 0, 'nothing reposted');
  assert.equal(ch.deleted.length, 0, 'nothing deleted');
});

// The bug this exists for: the panel was redrawn, the file name did not change,
// so matching on name alone left the old picture up and the redraw never
// reached anybody. The owner's report was "the image looks the same".
test('a picture that no longer matches the file is replaced', async () => {
  const ch = channelWith([{ attachments: [{ name: SEED_GUIDE, size: 409141 }] }]);
  assert.equal(await seeder().ensureGuide(ch), true);
  assert.equal(ch.deleted.length, 1, 'the stale one is removed');
  assert.equal(ch.sent.length, 1, 'and the current one posted');
});

test('duplicates are collapsed to one, even when one of them is current', async () => {
  const ch = channelWith([
    { attachments: [{ name: SEED_GUIDE, size: 111 }] },
    { attachments: [{ name: SEED_GUIDE, size: await guideSize() }] },
  ]);
  assert.equal(await seeder().ensureGuide(ch), true);
  assert.equal(ch.deleted.length, 2);
  assert.equal(ch.sent.length, 1);
});

test('other messages in the channel are never touched', async () => {
  const ch = channelWith([
    { attachments: [] },
    { attachments: [{ name: 'someone-elses.png', size: 10 }] },
  ]);
  await seeder().ensureGuide(ch);
  assert.equal(ch.deleted.length, 0);
});

test('a missing picture file is a warning, not a crash or an empty post', async () => {
  const s = seeder();
  s.guidePath = () => '/nowhere/start-a-match.jpg';
  const ch = channelWith([]);
  assert.equal(await s.ensureGuide(ch), false);
  assert.equal(ch.sent.length, 0, 'nothing is posted');
  assert.equal(ch.deleted.length, 0, 'and nothing already there is removed');
});

// --- what the board tells you to do ----------------------------------------
// This field used to read "Going in early?" with the Server ID under it, which
// sent people into a lobby where the game does nothing below the target. The
// owner confirmed it: you spawn in your team's lobby, walk around, and that is
// all that happens.

test('the board does NOT send people into a server that cannot start a match', () => {
  const p = seedBoard({ ok: true, serverOk: true, ready: 4, target: 45, playersOn: 4 },
    { serverId: 'ABC-123' });
  const text = JSON.stringify(p.embeds[0]);
  assert.ok(!text.includes('ABC-123'), 'the Server ID is not offered below the target');
  assert.match(text, /the match does not start/);
  assert.match(text, /walk around an empty map/);
});

test('but once the match is really on, it says how to join', () => {
  const p = seedBoard({ ok: true, serverOk: true, ready: 0, target: 45, playersOn: 45 },
    { serverId: 'ABC-123' });
  assert.match(JSON.stringify(p.embeds[0]), /ABC-123/);
});

test('it offers somewhere to wait with company instead', () => {
  const p = seedBoard({ ok: true, serverOk: true, ready: 4, target: 45, playersOn: 0 },
    { lobbyId: '999' });
  assert.match(JSON.stringify(p.embeds[0]), /<#999>/);
});

test('people already waiting in the server are on the board, and in the total', () => {
  const p = seedBoard({ ok: true, serverOk: true, ready: 25, waiting: 20, heading: 45, target: 45, playersOn: 20 });
  const text = JSON.stringify(p.embeds[0]);
  assert.match(text, /\*\*20\*\* already waiting/);
  assert.match(text, /\*\*45 of 45\*\*/);
});
