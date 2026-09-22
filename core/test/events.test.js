import test from 'node:test';
import assert from 'node:assert/strict';
import { eventStage, nextEvent, zonedTimeToUtc, EventTimeError } from '../src/events.js';

// --- turning what an admin typed into a real instant ------------------------
// An admin types the time on their own clock. Everyone else is shown a Discord
// timestamp, which each client renders in that person's timezone, so this is
// the only place a timezone is reasoned about at all.

test('a wall clock time in a zone becomes the right instant', () => {
  // Midwinter: London is on UTC.
  assert.equal(zonedTimeToUtc('2026-01-15', '20:00', 'Europe/London'),
    Date.parse('2026-01-15T20:00:00Z'));
  // Midsummer: London is an hour ahead, so 20:00 local is 19:00 UTC.
  assert.equal(zonedTimeToUtc('2026-07-15', '20:00', 'Europe/London'),
    Date.parse('2026-07-15T19:00:00Z'));
  assert.equal(zonedTimeToUtc('2026-07-15', '20:00', 'America/New_York'),
    Date.parse('2026-07-16T00:00:00Z'));
});

// The reason the offset is looked up twice. Using the offset at the wrong
// instant puts the whole evening an hour out, on exactly the weekend somebody
// would turn up and find nobody there.
test('it survives the weekend the clocks change', () => {
  // London goes forward at 01:00 UTC on 29 March 2026. An evening event that
  // day is on summer time even though the day began on winter time.
  assert.equal(zonedTimeToUtc('2026-03-29', '20:00', 'Europe/London'),
    Date.parse('2026-03-29T19:00:00Z'));
  // And back again on 25 October 2026.
  assert.equal(zonedTimeToUtc('2026-10-25', '20:00', 'Europe/London'),
    Date.parse('2026-10-25T20:00:00Z'));
});

test('midnight does not roll into the wrong day', () => {
  assert.equal(zonedTimeToUtc('2026-01-15', '00:00', 'Europe/London'),
    Date.parse('2026-01-15T00:00:00Z'));
});

// A typo is a typo, not a crash, and the message has to say which bit is wrong
// because the person reading it is not a programmer.
test('a bad date, time or zone is refused with a readable reason', () => {
  assert.throws(() => zonedTimeToUtc('2 October', '20:00', 'UTC'), /YYYY-MM-DD/);
  assert.throws(() => zonedTimeToUtc('2026-10-02', '8pm', 'UTC'), /24 hour clock/);
  assert.throws(() => zonedTimeToUtc('2026-10-02', '25:00', 'UTC'), /no such time/);
  assert.throws(() => zonedTimeToUtc('2026-10-02', '20:00', 'Mars/Olympus'), /not a timezone I know/);
  assert.throws(() => zonedTimeToUtc('2026-10-02', '20:00', 'Mars/Olympus'), EventTimeError);
});

// --- what an event should be doing right now --------------------------------

const START = Date.parse('2026-10-02T20:00:00Z');
const ask = (over = {}) => eventStage({
  startsAt: new Date(START).toISOString(), target: 45, sent: ['announce'], now: START - 3 * 86_400_000, ...over,
});

test('a new event announces itself before anything else happens', () => {
  assert.equal(ask({ sent: [], yes: 99 }).action, 'announce');
});

test('it says it is on the moment enough people have answered', () => {
  assert.equal(ask({ yes: 45 }).action, 'go');
  assert.equal(ask({ yes: 44 }).action, null);
});

// Not at the deadline, but as soon as it is true: people arrange an evening
// around "it's on", not around a number creeping up.
test('the go does not wait for the deadline', () => {
  const r = ask({ yes: 50, now: START - 5 * 86_400_000 });
  assert.equal(r.action, 'go');
});

test('a day out, the people who have not answered get a reminder', () => {
  assert.equal(ask({ yes: 10, now: START - 23 * 3_600_000 }).action, 'remind');
  assert.equal(ask({ yes: 10, now: START - 23 * 3_600_000, sent: ['announce', 'remind'] }).action, null);
});

// The whole point. Under the target the game does not start, so twenty people
// in a dead lobby is a worse outcome than nobody at all.
test('a short list an hour out is called off, not run anyway', () => {
  const r = ask({ yes: 20, now: START - 30 * 60_000 });
  assert.equal(r.action, 'nogo');
  assert.match(r.reason, /only 20 of 45/);
});

test('a called-off evening comes back if the people turn up late', () => {
  const sent = ['announce', 'nogo'];
  assert.equal(ask({ yes: 45, now: START - 20 * 60_000, sent }).action, 'go',
    'the numbers arrived, so it is on again');
});

test('only an event that got the go actually starts', () => {
  assert.equal(ask({ yes: 45, now: START + 60_000, sent: ['announce', 'go'] }).action, 'start');
  assert.equal(ask({ yes: 20, now: START + 60_000, sent: ['announce', 'nogo'] }).action, null);
  assert.equal(ask({ yes: 45, now: START + 60_000, sent: ['announce', 'go', 'start'] }).action, null);
});

test('an event that was called off does nothing at all', () => {
  const r = ask({ yes: 45, cancelledAt: new Date().toISOString(), sent: [] });
  assert.equal(r.action, null);
  assert.equal(r.reason, 'called off');
});

// There is no "finished" notice: by then the event is already off the upcoming
// list, so nothing would be there to send one.
test('it stops being current a few hours after it started', () => {
  const r = ask({ now: START + 4 * 3_600_000, sent: ['announce', 'go', 'start'] });
  assert.equal(r.action, null);
  assert.equal(r.reason, 'finished');
});

test('it always reports how many more are needed', () => {
  const r = ask({ yes: 12 });
  assert.equal(r.needed, 33);
  assert.equal(r.yes, 12);
});

// --- which one people should be looking at ---------------------------------

test('the next event is the soonest one that has not finished', () => {
  const now = Date.parse('2026-10-02T12:00:00Z');
  const e = (id, iso, over = {}) => ({ id, startsAt: iso, cancelledAt: null, ...over });
  const list = [
    e('1', '2026-10-09T20:00:00Z'),
    e('2', '2026-10-02T20:00:00Z'),
    e('3', '2026-10-01T20:00:00Z'),          // yesterday, finished
    e('4', '2026-10-02T18:00:00Z', { cancelledAt: '2026-10-01T00:00:00Z' }),
  ];
  assert.equal(nextEvent(list, { now }).id, '2');
});

// A board showing something that is not happening is worse than a board
// showing nothing.
test('a called-off event is never the next one', () => {
  const now = Date.parse('2026-10-02T12:00:00Z');
  const list = [{ id: '1', startsAt: '2026-10-02T20:00:00Z', cancelledAt: '2026-10-01T00:00:00Z' }];
  assert.equal(nextEvent(list, { now }), null);
});
