// Leaderboards.
//
// WHAT THE GAME ACTUALLY GIVES US, which is the whole constraint here:
// /v1/players returns { name, steamId, faction, kills, deaths, cash, pingMs }
// and nothing else. There are no supply deliveries, no zone captures, no
// revives, no squads, and no events of any kind. Anything that claims to
// measure those would be invented, so none of it is here.
//
// What we do have that most servers don't is a poll every 5 seconds, written
// down. So the strategic measures are DERIVED from how the numbers move over
// time rather than read off a field:
//
//   Ground  the objective score the player's own side gained per minute while
//           that player was on the field. factionScores[].score is the zone
//           score and it climbs as a side holds ground, so this rewards being
//           there while your team pushes rather than farming kills away from
//           the fight. It is a SHARED team measure and the board says so: you
//           cannot hold a zone alone, and pretending otherwise would be a lie
//           about what the number is.
//   Held    deaths per 10 minutes, lowest first. Dying less while staying on
//           the field is position discipline. Cheap to game by hiding, which is
//           why it needs minutes played alongside it and is not the headline.
//   Fight   kills, deaths, K:D. The basic board people expect and look for.
//
// And one board that does not come from the game at all: who got matches going,
// counted off the seeding call-ins. See STARTERS_SQL. It is the only thing on
// here that measures a community rather than a player, which is why it is on a
// leaderboard at all instead of being left as a private statistic.
//
// Kills and deaths are per MATCH on this build (they reset), so a player's
// total is the sum of their per-match maximum. cash is a persistent wallet
// across matches, so a within-match delta is what they earned; what earns it
// is not documented anywhere we can see, so it is collected but NOT ranked.
// Do not put it on a board until somebody has confirmed what moves it.
//
// Minutes come from counting polls, so they are accurate to the poll interval
// and drift if the interval changes under backpressure. That is the same
// approximation the ratings code makes.

/** Days of history a board covers by default. */
export const DEFAULT_WINDOW_DAYS = 30;
/** Below this, a rate is noise: one lucky ten minutes should not top a board. */
export const MIN_MINUTES = 20;

/**
 * Per-player totals over the window, straight from the samples.
 *
 * One row per player. `scoreGain` only counts increases: a score that drops
 * means the game reset or capped it, and treating that as negative play would
 * punish whoever happened to be on at the time.
 */
export const TOTALS_SQL = `
WITH present AS (
  SELECT ps.match_id, ps.steam_id, ps.faction, ps.kills, ps.deaths, ps.cash, ss.polled_at
    FROM player_samples ps
    JOIN status_samples ss ON ss.id = ps.sample_id
   WHERE ss.polled_at > now() - make_interval(days => $1)
),
-- Every faction's score at every poll, unpacked from the status blob.
faction_steps AS (
  SELECT ss.match_id, ss.polled_at, f->>'name' AS faction, (f->>'score')::numeric AS score
    FROM status_samples ss
    CROSS JOIN LATERAL jsonb_array_elements(ss.status->'factionScores') f
   WHERE ss.polled_at > now() - make_interval(days => $1)
),
faction_delta AS (
  SELECT match_id, faction, polled_at,
         GREATEST(score - LAG(score) OVER (
           PARTITION BY match_id, faction ORDER BY polled_at), 0) AS gain
    FROM faction_steps
),
-- How much each side gained across a whole match, and how long that match ran.
faction_total AS (
  SELECT match_id, faction, sum(gain) AS gain, count(*)::int AS polls
    FROM faction_delta
   GROUP BY match_id, faction
),
-- The player's own share: the gain during the polls they were actually on.
on_field AS (
  SELECT p.match_id, p.steam_id, p.faction,
         count(*)::int AS polls,
         COALESCE(sum(d.gain), 0) AS gain
    FROM present p
    JOIN faction_delta d
      ON d.match_id = p.match_id AND d.faction = p.faction AND d.polled_at = p.polled_at
   GROUP BY p.match_id, p.steam_id, p.faction
),
-- On minus off, per match per side. This is the bit that isolates the player:
-- everyone present for the same polls shares the same raw gain, so the only
-- thing that tells them apart is how their side did while they were NOT on.
swing AS (
  SELECT o.steam_id,
         sum(o.polls)::int AS on_polls,
         sum(o.gain) AS on_gain,
         sum(t.polls - o.polls)::int AS off_polls,
         sum(t.gain - o.gain) AS off_gain
    FROM on_field o
    JOIN faction_total t ON t.match_id = o.match_id AND t.faction = o.faction
   GROUP BY o.steam_id
),
-- Kills and deaths reset each match, so a total is the sum of per-match peaks.
-- Faction is deliberately NOT in this grouping: somebody who switched sides
-- mid-match must not have their kills counted twice.
fight AS (
  SELECT match_id, steam_id,
         max(kills)  AS kills,
         max(deaths) AS deaths,
         max(cash) - min(cash) AS cash_earned,
         count(*)::int AS polls
    FROM present
   GROUP BY match_id, steam_id
),
totals AS (
  SELECT steam_id,
         count(*)::int      AS matches,
         sum(kills)::int    AS kills,
         sum(deaths)::int   AS deaths,
         sum(polls)::int    AS polls,
         COALESCE(sum(cash_earned), 0)::numeric AS cash_earned
    FROM fight
   GROUP BY steam_id
)
SELECT t.steam_id,
       COALESCE(p.last_name, t.steam_id) AS name,
       t.matches, t.kills, t.deaths, t.polls, t.cash_earned,
       COALESCE(s.on_gain, 0)::numeric  AS on_gain,
       COALESCE(s.on_polls, 0)::int     AS on_polls,
       COALESCE(s.off_gain, 0)::numeric AS off_gain,
       COALESCE(s.off_polls, 0)::int    AS off_polls
  FROM totals t
  LEFT JOIN players p USING (steam_id)
  LEFT JOIN swing s USING (steam_id)`;

/**
 * Who got matches going: how many call-ins their name was on the list for.
 *
 * The one board that isn't derived from the game at all, because the game
 * cannot see it. Putting your name down in #start-a-match when the server is
 * quiet is what turns four players into a full match, and it is worth more to
 * the server than anybody's K:D. `seed_credits` is written by the call-in
 * itself (see the POST /internal/seed/ping route).
 */
export const STARTERS_SQL = `
SELECT discord_id,
       count(*)::int AS calls,
       max(credited_at) AS last_at
  FROM seed_credits
 WHERE credited_at > now() - make_interval(days => $1)
 GROUP BY discord_id`;

/** Commander record over the window: how often, and what their own side said. */
export const COMMANDERS_SQL = `
SELECT r.commander_id,
       count(*)::int AS rounds,
       sum(r.served_sec)::int AS served_sec,
       COALESCE(sum(CASE WHEN v.value = 'good'  THEN 1 ELSE 0 END), 0)::int AS good,
       COALESCE(sum(CASE WHEN v.value = 'poor'  THEN 1 ELSE 0 END), 0)::int AS poor,
       COALESCE(sum(CASE WHEN v.value = 'toxic' THEN 1 ELSE 0 END), 0)::int AS toxic
  FROM rating_rounds r
  LEFT JOIN rating_votes v ON v.round_id = r.id
 WHERE r.opened_at > now() - make_interval(days => $1)
 GROUP BY r.commander_id`;

const round1 = (n) => Math.round(n * 10) / 10;
const round2 = (n) => Math.round(n * 100) / 100;

/**
 * Turn raw rows into the numbers a board shows. Pure, so the ranking rules can
 * be checked without a database.
 *
 * @param {object[]} rows      from TOTALS_SQL
 * @param {number} pollSeconds how long one poll represents
 */
export function playerStats(rows, { pollSeconds = 5 } = {}) {
  return (rows ?? []).map((r) => {
    const minutes = (Number(r.polls) * pollSeconds) / 60;
    const kills = Number(r.kills) || 0;
    const deaths = Number(r.deaths) || 0;
    const onMin = (Number(r.on_polls) * pollSeconds) / 60;
    const offMin = (Number(r.off_polls) * pollSeconds) / 60;
    const onRate = onMin ? Number(r.on_gain) / onMin : 0;
    // Undefined, not zero, when they never left: there is no evidence either
    // way, and scoring that as average would flatter or punish them at random.
    const swing = offMin > 0 ? onRate - Number(r.off_gain) / offMin : null;
    return {
      steamId: String(r.steam_id),
      name: r.name,
      matches: Number(r.matches) || 0,
      minutes: round1(minutes),
      kills,
      deaths,
      // Someone who has never died has a K:D of their kills, not infinity.
      kd: round2(deaths ? kills / deaths : kills),
      killsPerMin: round2(minutes ? kills / minutes : 0),
      // A TEAM measure: the objective score your side gained per minute while
      // you were on. Everyone on together shares it. Honest, and always there.
      ground: round2(onRate),
      // The individual one: how much faster your side scored with you on than
      // without you. Null until they have been both on and off in a match.
      swing: swing === null ? null : round2(swing),
      offMinutes: round1(offMin),
      // Position discipline. Lower is better.
      deathsPer10: round2(minutes ? (deaths / minutes) * 10 : 0),
      cashEarned: Number(r.cash_earned) || 0,
    };
  });
}

/** Commander rows to a board. `-3..+3` per round, the same scale as /rating. */
export function commanderStats(rows) {
  return (rows ?? []).map((r) => {
    const good = Number(r.good) || 0;
    const poor = Number(r.poor) || 0;
    const toxic = Number(r.toxic) || 0;
    return {
      discordId: r.commander_id,
      rounds: Number(r.rounds) || 0,
      minutes: round1((Number(r.served_sec) || 0) / 60),
      good,
      poor,
      toxic,
      score: Math.max(-3, Math.min(3, good - poor - 3 * toxic)),
    };
  });
}

/** Seeding rows to a board. Keyed on Discord, like the commander board. */
export function starterStats(rows) {
  return (rows ?? []).map((r) => ({
    discordId: r.discord_id,
    calls: Number(r.calls) || 0,
    lastAt: r.last_at ? new Date(r.last_at).toISOString() : null,
  }));
}

/**
 * The boards themselves.
 *
 * Separate boards rather than one blended number on purpose. A single "SIXDOGS
 * score" made of weighted parts is impossible to argue with and impossible to
 * chase: nobody can tell what to do differently. Separate honest lists each say
 * "do this and you climb", and between them they reward more than shooting.
 *
 * Rate-based boards need MIN_MINUTES behind them. Without that, whoever played
 * ten good minutes tops the table forever and nobody else can catch them.
 */
export function boards(players, commanders = [], starters = [], { minMinutes = MIN_MINUTES, top = 5 } = {}) {
  const enough = players.filter((p) => p.minutes >= minMinutes);
  const by = (key, dir = -1) => [...enough]
    .sort((a, b) => (a[key] - b[key]) * dir || b.minutes - a.minutes)
    .slice(0, top);

  return {
    // Ranked by total, not rate: this is the one people want to see themselves
    // climb by turning up, and it is the least gameable.
    kills: [...players].sort((a, b) => b.kills - a.kills || b.kd - a.kd).slice(0, top),
    kd: by('kd'),
    ground: by('ground'),
    // Needs both on-field and off-field time in the same match, so this board
    // is empty until people come and go rather than all playing every minute.
    // That is correct: with nothing to compare against there is no number.
    swing: enough
      .filter((p) => p.swing !== null && p.offMinutes >= minMinutes / 2)
      .sort((a, b) => b.swing - a.swing || b.minutes - a.minutes)
      .slice(0, top),
    discipline: by('deathsPer10', 1),
    hours: [...players].sort((a, b) => b.minutes - a.minutes).slice(0, top),
    commanders: [...commanders]
      .filter((c) => c.rounds > 0)
      .sort((a, b) => b.score - a.score || b.rounds - a.rounds)
      .slice(0, top),
    // Not gated on minutes played: the whole point is that it counts what
    // somebody did while they were NOT in the server.
    starters: [...starters]
      .filter((s) => s.calls > 0)
      .sort((a, b) => b.calls - a.calls || String(b.lastAt).localeCompare(String(a.lastAt)))
      .slice(0, top),
    // So a board can say "of 14 players with 20+ minutes".
    counted: enough.length,
    players: players.length,
    minMinutes,
  };
}
