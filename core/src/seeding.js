// Seeding: getting a server up to a playable number without anyone having to
// sit in it waiting.
//
// The problem it solves: a 100 slot server at zero players stays at zero,
// because nobody wants to be the first one on an empty map. The old fix is to
// sit there AFK until others arrive, which is miserable, so most people never
// do it. A server stuck at twelve has the same problem in a milder form: twelve
// people rattling around a map built for a hundred is not the match anyone
// turned up for.
//
// So people say in Discord "I want to play". When the people already on the
// server PLUS the people who said that add up to a playable match, the bot
// pings the opt-in role once and everyone goes in together.
//
// Counting the players already on is the whole point. Seeding is not only for a
// dead server: topping a half-full one up to a real match is the case that
// happens most, and a rule that switched itself off the moment a match started
// would miss it every time.
//
// Everything here is pure so the rules can be tested without a database, a
// Discord connection or a clock.

/** How many bodies make a match worth joining. Counts players on + people ready. */
export const DEFAULT_TARGET = 20;
/** Never spend a ping on fewer people than this, however close the target is. */
export const DEFAULT_MIN_PLEDGES = 5;
/** A pledge older than this is stale: they said yes an hour ago and have gone out. */
export const DEFAULT_PLEDGE_MINUTES = 45;
/** Least time between pings, so the role never gets spammed. */
export const DEFAULT_COOLDOWN_MINUTES = 45;

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
 * `heading` is what the server would hold if everyone who said yes turned up:
 * the people on it now plus the live pledges. That, not the pledge count on its
 * own, is what gets compared to the target.
 *
 * @returns {{fire, reason, ready, playersOn, heading, needed, target}}
 */
export function shouldPing({
  pledges = [],
  playersOn = 0,
  serverOk = true,
  target = DEFAULT_TARGET,
  minPledges = DEFAULT_MIN_PLEDGES,
  lastPingAt = null,
  now = Date.now(),
  pledgeMinutes = DEFAULT_PLEDGE_MINUTES,
  cooldownMinutes = DEFAULT_COOLDOWN_MINUTES,
} = {}) {
  const live = livePledges(pledges, { now, pledgeMinutes });
  const ready = live.length;
  const heading = playersOn + ready;
  const needed = Math.max(0, target - heading);
  const out = (fire, reason) => ({ fire, reason, ready, playersOn, heading, needed, target });

  // Calling people to a server that isn't answering sends them to a black
  // screen, and they don't come back a second time.
  if (!serverOk) return out(false, "the game server isn't answering, so nobody is being called in");

  // There are already enough people in there. Whoever wants to play can just
  // join, and a ping saying so is noise that makes the next one count less.
  if (playersOn >= target) return out(false, `${playersOn} already playing, no need to call anyone`);

  // Close to the target on players alone? Then a ping would be fetching one or
  // two people, which is not what the role signed up for. A call-in has to be
  // worth being a call-in.
  const floor = Math.min(minPledges, target);
  if (ready < floor) {
    return out(false, `only ${ready} ready, and a ping isn't worth it for fewer than ${floor}`);
  }

  if (heading < target) {
    return out(false, playersOn
      ? `${playersOn} playing and ${ready} ready, ${needed} short of ${target}`
      : `${ready} of ${target} ready`);
  }

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

  return out(true, playersOn ? `${playersOn} playing and ${ready} ready` : `${ready} ready`);
}
