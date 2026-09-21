// Seeding: a standing list of who wants to play, and two pings built on it.
//
// The list is the whole idea, and it is deliberately dumb: you click once, your
// name goes on it, and it stays there. It does NOT come off because you went
// and waited in the server. Wanting to play and being in the server are the
// same intention, not opposites, and an earlier version that quietly removed
// people the moment they joined made the list lie about who was up for a match.
//
// Two different messages come out of it, and they are not the same thing:
//
//   nudge  at SEED_NUDGE_AT. "10 people want to play, click the button if you
//          do too (10/45)." Its job is to recruit the other 35, so it fires
//          once per round, early, while there is still something to recruit.
//   call   at SEED_TARGET. "45 want to play, get in." Its job is to start the
//          match, so nothing is allowed to get in its way.
//
// A nudge must never block a call: they keep separate cooldowns, or the recruiting
// message would stop the very match it recruited for.
//
// Everything here is pure so the rules can be tested without a database, a
// Discord connection or a clock.

/** How many have to want in before a match can actually start. */
export const DEFAULT_TARGET = 45;
/** The list crossing this is worth telling the role about, to recruit the rest. */
export const DEFAULT_NUDGE_AT = 10;
/** How long a name stays on the list. Long, because 45 clicks take a while to collect. */
export const DEFAULT_PLEDGE_MINUTES = 180;
/** Least time between two pings of the same kind. */
export const DEFAULT_COOLDOWN_MINUTES = 45;

export const isFresh = (pledgedAt, now, pledgeMs) => now - new Date(pledgedAt).getTime() < pledgeMs;

/** Drop the ones that have gone stale. Returns the ones that still count. */
export function livePledges(pledges, { now = Date.now(), pledgeMinutes = DEFAULT_PLEDGE_MINUTES } = {}) {
  const pledgeMs = pledgeMinutes * 60_000;
  return (pledges ?? []).filter((p) => isFresh(p.at, now, pledgeMs));
}

/**
 * What, if anything, should the bot post right now?
 *
 * Every "nothing" is given a reason, because the reasons are the feature: an
 * admin asking "why has it not pinged?" gets an answer instead of a shrug.
 *
 * @returns {{action: 'call'|'nudge'|null, reason, ready, needed, target, nudgeAt}}
 */
export function seedDecision({
  pledges = [],
  playersOn = 0,
  serverOk = true,
  target = DEFAULT_TARGET,
  nudgeAt = DEFAULT_NUDGE_AT,
  lastCallAt = null,
  lastNudgeAt = null,
  now = Date.now(),
  pledgeMinutes = DEFAULT_PLEDGE_MINUTES,
  cooldownMinutes = DEFAULT_COOLDOWN_MINUTES,
} = {}) {
  const live = livePledges(pledges, { now, pledgeMinutes });
  const ready = live.length;
  const needed = Math.max(0, target - ready);
  const bar = Math.min(nudgeAt, target); // a nudge above the target could never fire
  const out = (action, reason) => ({ action, reason, ready, needed, target, nudgeAt: bar, playersOn });

  // Calling people to a server that isn't answering sends them to a black
  // screen, and they don't come back a second time.
  if (!serverOk) return out(null, "the game server isn't answering, so nobody is being called in");

  // The match everyone was waiting for is already happening. Whoever wants to
  // play can just join, and a ping saying so makes the next one count less.
  if (playersOn >= target) return out(null, `${playersOn} already playing, the match is on`);

  const cooldownMs = cooldownMinutes * 60_000;
  const since = (at) => (at ? now - new Date(at).getTime() : Infinity);
  const left = (at) => Math.ceil((cooldownMs - since(at)) / 60_000);

  if (ready >= target) {
    if (since(lastCallAt) < cooldownMs) {
      return out(null, `everyone was called in recently, ${left(lastCallAt)} min before the next one`);
    }
    return out('call', `${ready} want to play`);
  }

  if (ready >= bar) {
    // Once per round. The list is emptied by a call, so a nudge newer than the
    // last call means this round has already been advertised.
    const nudgedThisRound = lastNudgeAt
      && (!lastCallAt || Date.parse(lastNudgeAt) > Date.parse(lastCallAt));
    if (nudgedThisRound) {
      return out(null, `${ready} of ${target} want to play, and the role has already been told about this one`);
    }
    if (since(lastNudgeAt) < cooldownMs) {
      return out(null, `${ready} of ${target} want to play, ${left(lastNudgeAt)} min before the role can be told again`);
    }
    return out('nudge', `${ready} want to play, ${needed} to go`);
  }

  return out(null, `${ready} of ${target} want to play`);
}
