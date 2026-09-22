import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eventBoard, eventMessage, EVENT_FOOTER } from '../src/events.js';

const START = '2026-10-02T20:00:00Z';
const ev = (over = {}) => ({
  id: '7', startsAt: START, title: 'Thursday match night', target: 45,
  yes: ['1', '2'], maybe: ['3'], no: [], sent: ['announce'], cancelledAt: null, ...over,
});
const nameOf = (id) => ({ 1: 'Rook', 2: 'Vex', 3: 'Halcyon' }[id] ?? null);
const text = (p) => JSON.stringify(p.embeds[0]);

test('the board is findable again after a restart', () => {
  assert.ok(eventBoard(ev()).embeds[0].footer.text.startsWith(EVENT_FOOTER));
});

// Discord timestamps, never a written-out time. Each person's client renders
// them in that person's own timezone, which is the only way a community across
// several countries agrees on when eight o'clock is.
test('the time is a Discord timestamp, so everyone sees their own clock', () => {
  const epoch = Math.floor(Date.parse(START) / 1000);
  assert.match(text(eventBoard(ev())), new RegExp(`<t:${epoch}:`));
});

// The fact the whole feature exists for. Somebody who turns up early to an
// unfilled server has a dead ten minutes and does not come back.
test('the board says plainly that turning up early achieves nothing', () => {
  const t = text(eventBoard(ev()));
  assert.match(t, /We need \*\*45\*\*/);
  assert.match(t, /the game doesn't begin/i);
  assert.match(t, /walk around an empty map/);
});

test('and that nobody has to sit in an empty server to find out', () => {
  assert.match(text(eventBoard(ev())), /an hour before, everyone gets told whether it is on or off/i);
});

test('it shows who is coming, by name, against the target', () => {
  const t = text(eventBoard(ev(), { nameOf }));
  assert.match(t, /\*\*2 of 45 coming\*\*/);
  assert.match(t, /Rook, Vex/);
  assert.match(t, /Maybe:.*Halcyon/);
});

// Maybes look like progress and are not. An event that runs on maybes turns up
// half empty, which is the exact failure this is here to avoid.
test('maybes are shown but never counted towards the target', () => {
  const t = text(eventBoard(ev({ yes: ['1'], maybe: ['2', '3'] }), { nameOf }));
  assert.match(t, /\*\*1 of 45 coming\*\*/);
});

test('three buttons, so "no" is as easy to say as "yes"', () => {
  const row = eventBoard(ev()).components[0].toJSON();
  assert.deepEqual(row.components.map((c) => c.custom_id),
    ['event:yes:7', 'event:maybe:7', 'event:no:7']);
});

test('once it is confirmed the board says so and stops explaining', () => {
  const p = eventBoard(ev({ sent: ['announce', 'go'], yes: ['1', '2'] }), { nameOf, serverId: 'ABC-123' });
  assert.match(text(p), /It's on/);
  assert.match(text(p), /ABC-123/, 'and only now is the Server ID worth showing');
});

test('a called-off event says so and has nothing left to click', () => {
  const p = eventBoard(ev({ cancelledAt: '2026-10-01T00:00:00Z', cancelReason: 'Not enough of us.' }));
  assert.match(text(p), /Called off/);
  assert.match(text(p), /Not enough of us/);
  assert.deepEqual(p.components, []);
});

test('an empty calendar is an invitation, not an error', () => {
  const p = eventBoard(null);
  assert.match(text(p), /No match night on the calendar/);
  assert.deepEqual(p.components, []);
});

// --- the messages that actually reach people --------------------------------

test('the announcement and the reminder point at the channel with the buttons', () => {
  for (const kind of ['announce', 'remind']) {
    const m = eventMessage(kind, ev(), { roleId: 'R', channelId: 'C' });
    assert.match(m.content, /<#C>/, kind);
    assert.match(m.content, /<@&R>/, `${kind} pings the opt-in role`);
  }
});

// Pinging people to tell them there is nothing to do is how a ping role gets
// turned off, and then the call-ins stop working too.
test('a no-go pings nobody', () => {
  const m = eventMessage('nogo', ev({ yes: ['1'] }), { roleId: 'R', channelId: 'C' });
  assert.ok(!m.content.includes('<@&R>'));
  assert.deepEqual(m.allowedMentions, { parse: [] });
  assert.match(m.content, /is off/);
  assert.match(m.content, /empty map/, 'and says why, so it does not read as us giving up');
});

test('the start message is the one that tells people how to get in', () => {
  const m = eventMessage('start', ev({ sent: ['announce', 'go'] }), { roleId: 'R', serverId: 'ABC-123' });
  assert.match(m.content, /<@&R>/);
  assert.match(m.content, /starts now/);
  assert.match(m.content, /ABC-123/);
});

test('the go message says it is on and when', () => {
  const m = eventMessage('go', ev({ yes: ['1', '2', '3'] }), { roleId: 'R' });
  assert.match(m.content, /is ON/);
  assert.match(m.content, new RegExp(`<t:${Math.floor(Date.parse(START) / 1000)}:`));
});

test('an unknown notice says nothing rather than posting an empty message', () => {
  assert.equal(eventMessage('finished', ev()), null);
});
