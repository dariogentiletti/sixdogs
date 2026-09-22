// Scheduled matches ("operations"): a time, an RSVP list, and a go/no-go.
//
// WHY THIS EXISTS, because it decides every rule below. Under the server's
// MinimumRequiredPlayers, WARDOGS does not start a match at all: you spawn in
// your team's lobby, you can walk around an empty map, and the game mode does
// nothing. So:
//
//   - Half a server is not progress, it is damage. Somebody who arrives at 12
//     players has a dead ten minutes and does not come back.
//   - Growing by trickle is therefore impossible, and the in-game server
//     browser (which sorts by population) cannot be the way people find us.
//   - The whole problem is SYNCHRONISATION: getting the target number of people
//     to arrive within a few minutes of each other.
//
// The seeding list solves that for "right now" but has no deadline. This solves
// it for "Thursday at eight", and its one important property is that the count
// is known BEFORE anybody has to be in the server. Nobody spawns onto an empty
// map to find out whether it was going to work.
//
// Which is why a no-go is a feature, not a failure. Calling it off costs
// nothing. Twenty people in a dead lobby costs you twenty people.
//
// Everything here is pure: no database, no Discord, no clock.

/** How long before the start to make the call when the list is short. */
export const DEFAULT_GO_MINUTES = 60;
/** How long before the start to remind people who have not answered. */
export const DEFAULT_REMIND_MINUTES = 24 * 60;
/** How long after the start an event stops being current. */
export const DEFAULT_CLOSE_MINUTES = 180;

/**
 * The notices an event sends, each exactly once.
 *
 * There is deliberately no "finished" notice. An event past its close window is
 * already gone from the upcoming list, so nothing would ever be there to send
 * it, and it had nothing to say anyway.
 */
export const NOTICES = ['announce', 'remind', 'go', 'nogo', 'start'];

class EventTimeError extends Error {
  constructor(message) { super(message); this.name = 'EventTimeError'; this.code = 'bad_time'; }
}
export { EventTimeError };

/**
 * How far `zone` is from UTC at a given instant, in milliseconds.
 *
 * Intl is the only thing in Node that knows about daylight saving, and it only
 * goes one way (instant -> wall clock), so this reads the wall clock back and
 * takes the difference.
 */
function offsetAt(utcMs, zone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(utcMs));
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  // Some locales render midnight as hour 24, which Date.UTC would roll into the
  // next day.
  const hour = Number(p.hour) % 24;
  const asUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), hour, Number(p.minute), Number(p.second));
  return asUtc - utcMs;
}

/**
 * "20:00 on 2026-09-25, in Europe/London" -> the instant that actually is.
 *
 * An admin types the time they mean in their own clock. Everyone else is shown
 * a Discord timestamp, which each person's client renders in THEIR timezone, so
 * this conversion is the only place a timezone is ever reasoned about.
 *
 * The offset is looked up twice on purpose. The first guess uses the offset at
 * the wrong instant, which is off by an hour across a daylight-saving change —
 * exactly the weekend somebody would turn up an hour late.
 *
 * @returns {number} epoch milliseconds
 */
export function zonedTimeToUtc(date, time, zone = 'UTC') {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date ?? ''))) {
    throw new EventTimeError(`"${date}" is not a date. Write it as YYYY-MM-DD, for example 2026-10-02.`);
  }
  if (!/^\d{1,2}:\d{2}$/.test(String(time ?? ''))) {
    throw new EventTimeError(`"${time}" is not a time. Write it as HH:MM on a 24 hour clock, for example 20:00.`);
  }
  const [h, m] = String(time).split(':').map(Number);
  if (h > 23 || m > 59) throw new EventTimeError(`There is no such time as ${time}.`);
  try {
    offsetAt(Date.now(), zone);
  } catch {
    throw new EventTimeError(`"${zone}" is not a timezone I know. Use something like Europe/London or America/New_York.`);
  }
  const naive = Date.parse(`${date}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z`);
  if (!Number.isFinite(naive)) throw new EventTimeError(`"${date} ${time}" is not a real date and time.`);
  const first = naive - offsetAt(naive, zone);
  const second = naive - offsetAt(first, zone);
  return second;
}

/**
 * What should happen to this event right now?
 *
 * `sent` is the set of notices already delivered, so every branch is "once and
 * only once" without needing a state column that can get out of step.
 *
 * @returns {{action: string|null, reason, yes, target, needed, minutesAway}}
 */
export function eventStage({
  startsAt,
  cancelledAt = null,
  yes = 0,
  target = 45,
  sent = [],
  now = Date.now(),
  goMinutes = DEFAULT_GO_MINUTES,
  remindMinutes = DEFAULT_REMIND_MINUTES,
  closeMinutes = DEFAULT_CLOSE_MINUTES,
} = {}) {
  const start = new Date(startsAt).getTime();
  const done = new Set(sent);
  const needed = Math.max(0, target - yes);
  const minutesAway = Math.round((start - now) / 60_000);
  const out = (action, reason) => ({ action, reason, yes, target, needed, minutesAway });

  if (!Number.isFinite(start)) return out(null, 'that event has no valid start time');
  if (cancelledAt) return out(null, 'called off');

  // Long over. Nothing left to do or say.
  if (now >= start + closeMinutes * 60_000) return out(null, 'finished');

  // Say it exists before anything else can happen to it.
  if (!done.has('announce')) return out('announce', 'newly put up');

  // Enough people. Say so the moment it is true rather than waiting for the
  // deadline: people arrange their evening around "it's on", not around a
  // number creeping up. This is also how a called-off event comes back if the
  // numbers arrive late.
  if (yes >= target && !done.has('go')) return out('go', `${yes} coming, that's a match`);

  if (now >= start) {
    if (done.has('go') && !done.has('start')) return out('start', 'it is time');
    return out(null, done.has('go') ? 'under way' : 'the time passed without enough people');
  }

  // The deadline. Short list, so call it off rather than sending people into a
  // lobby where nothing happens.
  if (now >= start - goMinutes * 60_000 && !done.has('go') && !done.has('nogo')) {
    return out('nogo', `only ${yes} of ${target} an hour out`);
  }

  if (now >= start - remindMinutes * 60_000 && !done.has('remind')) {
    return out('remind', `${yes} of ${target} so far`);
  }

  return out(null, `${yes} of ${target} coming`);
}

/**
 * The next event people should be looking at: the soonest one that has not
 * finished. Cancelled ones are dropped, because a board showing something that
 * is not happening is worse than a board showing nothing.
 */
export function nextEvent(events, { now = Date.now(), closeMinutes = DEFAULT_CLOSE_MINUTES } = {}) {
  return (events ?? [])
    .filter((e) => !e.cancelledAt && new Date(e.startsAt).getTime() + closeMinutes * 60_000 > now)
    .sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt))[0] ?? null;
}
