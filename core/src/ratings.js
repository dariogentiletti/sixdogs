// Post-match commander ratings.
//
// Points per vote: good +1, poor -1, toxic -3. Each match (round) counts for
// between -3 and +3, so one full lobby can't make someone a legend and one angry
// group can't bury them. Only rounds from the last RATING_WINDOW_DAYS count.

export const VOTE_POINTS = { good: 1, poor: -1, toxic: -3 };
export const ROUND_CAP = 3;

/** Points one round contributes to a commander's score. */
export function roundPoints({ good = 0, poor = 0, toxic = 0 }) {
  const raw = good * VOTE_POINTS.good + poor * VOTE_POINTS.poor + toxic * VOTE_POINTS.toxic;
  return Math.max(-ROUND_CAP, Math.min(ROUND_CAP, raw));
}

/**
 * Commander terms in a match, from commander_log.
 * A term starts at 'accepted' or 'claimed' and ends at the next 'removed'
 * for that person and faction, or at matchEnd if it never did.
 * @returns [{ faction, discordId, servedSec, intervals: [[startISO, endISO], ...] }]
 */
export function commanderTerms(logRows, matchEnd) {
  const open = new Map();      // key -> start ms
  const intervals = new Map(); // key -> [[start ms, end ms]]
  const end = new Date(matchEnd).getTime();
  const add = (key, a, b) => { if (b > a) (intervals.get(key) ?? intervals.set(key, []).get(key)).push([a, b]); };
  const rows = [...logRows].sort((a, b) => new Date(a.at) - new Date(b.at));
  for (const r of rows) {
    const key = `${r.faction}|${r.discord_id}`;
    const t = new Date(r.at).getTime();
    if (r.event === 'accepted' || r.event === 'claimed') {
      if (!open.has(key)) open.set(key, t);
    } else if (r.event === 'removed' && open.has(key)) {
      add(key, open.get(key), t);
      open.delete(key);
    }
  }
  for (const [key, start] of open) add(key, start, end);
  return [...intervals].map(([key, list]) => {
    const [faction, discordId] = key.split('|');
    return {
      faction, discordId,
      servedSec: Math.round(list.reduce((s, [a, b]) => s + (b - a), 0) / 1000),
      intervals: list.map(([a, b]) => [new Date(a).toISOString(), new Date(b).toISOString()]),
    };
  });
}

/**
 * Which commanders get rated: served at least minServeSec, and at most
 * maxPerFaction per faction (the ones who led longest).
 */
export function ratedTerms(terms, { minServeSec = 300, maxPerFaction = 3 } = {}) {
  const byFaction = new Map();
  for (const t of terms.filter((x) => x.servedSec >= minServeSec)) {
    (byFaction.get(t.faction) ?? byFaction.set(t.faction, []).get(t.faction)).push(t);
  }
  return [...byFaction].map(([faction, list]) => ({
    faction,
    commanders: list.sort((a, b) => b.servedSec - a.servedSec).slice(0, maxPerFaction),
  }));
}
