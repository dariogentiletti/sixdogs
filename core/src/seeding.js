// Seeding: getting a dead server started without anyone having to sit in it.
//
// The problem it solves: a 24/7 server at zero players stays at zero, because
// nobody wants to be the first one on an empty map. The old fix is to sit there
// AFK until others arrive, which is miserable, so most people never do it.
//
// Instead people say in Discord "I'd play right now". When enough have said it,
// the bot pings the opt-in role once and everyone joins together, so nobody
// waits alone.
//
// Everything here is pure so the rules can be tested without a database, a
// Discord connection or a clock.

/** A pledge older than this is stale: they said yes an hour ago and have gone out. */
export const DEFAULT_PLEDGE_MINUTES = 45;
/** Least time between pings, so the role never gets spammed. */
export const DEFAULT_COOLDOWN_MINUTES = 45;
/** How many have to be ready before everyone gets called in. */
export const DEFAULT_TARGET = 10;

export const isFresh = (pledgedAt, now, pledgeMs) => now - new Date(pledgedAt).getTime() < pledgeMs;

/** Drop the ones that have gone stale. Returns the ones that still count. */
export function livePledges(pledges, { now = Date.now(), pledgeMinutes = DEFAULT_PLEDGE_MINUTES } = {}) {
  const pledgeMs = pledgeMinutes * 60_000;
  return (pledges ?? []).filter((p) => isFresh(p.at, now, pledgeMs));
}

/**
 * Should the bot call everyone in right now?
 *
 * Every no is given a reason, because the reasons are the feature: an admin
 * asking "why has it not pinged?" gets an answer instead of a shrug.
 *
 * @returns {{fire: boolean, reason: string, ready: number, needed: number}}
 */
export function shouldPing({
  pledges = [],
  playersOn = 0,
  serverOk = true,
  target = DEFAULT_TARGET,
  quietAbove = null,
  lastPingAt = null,
  now = Date.now(),
  pledgeMinutes = DEFAULT_PLEDGE_MINUTES,
  cooldownMinutes = DEFAULT_COOLDOWN_MINUTES,
} = {}) {
  const live = livePledges(pledges, { now, pledgeMinutes });
  const ready = live.length;
  const needed = Math.max(0, target - ready);
  const out = (fire, reason) => ({ fire, reason, ready, needed });

  // Calling people to a server that isn't answering sends them to a black
  // screen, and they don't come back a second time.
  if (!serverOk) return out(false, "the game server isn't answering, so nobody is being called in");

  // Already busy. Seeding is for a cold server; calling people to a match
  // that's running anyway is noise, and then the ping stops meaning anything.
  const busyAt = quietAbove ?? target;
  if (playersOn >= busyAt) return out(false, `${playersOn} already playing, no need to call anyone`);

  if (ready < target) return out(false, `${ready} of ${target} ready`);

  // A ping is a lot of notifications at once. Even with the bar met, wait the
  // cooldown out, so a burst of clicking can't fire twice in a row.
  if (lastPingAt) {
    const since = now - new Date(lastPingAt).getTime();
    const cooldownMs = cooldownMinutes * 60_000;
    if (since < cooldownMs) {
      const mins = Math.ceil((cooldownMs - since) / 60_000);
      return out(false, `everyone was called in recently, ${mins} min before the next one`);
    }
  }

  return out(true, `${ready} ready`);
}
