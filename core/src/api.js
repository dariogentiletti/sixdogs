// Internal HTTP API that the Discord bot talks to. The bot never talks to the
// game server directly and never sees the RCON password.
// Every route except /internal/health needs `Authorization: Bearer <INTERNAL_TOKEN>`.

import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { VerifyError } from './verify.js';
import { RconError } from './rcon.js';
import { looksEphemeral } from './db.js';
import { commanderTerms, ratedTerms, roundPoints } from './ratings.js';
import { seedDecision } from './seeding.js';

const MAX_BODY = 16 * 1024;

function send(res, status, body) {
  const json = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(json) });
  res.end(json);
}

function fail(res, status, code, message) {
  send(res, status, { error: { code, message } });
}

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw Object.assign(new Error('body too large'), { http: 413 });
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw Object.assign(new Error('invalid JSON'), { http: 400 });
  }
}

function authorized(req, token) {
  const header = req.headers.authorization ?? '';
  const expected = Buffer.from(`Bearer ${token}`);
  const got = Buffer.from(header);
  return got.length === expected.length && timingSafeEqual(got, expected);
}

const isSnowflake = (s) => typeof s === 'string' && /^\d{15,25}$/.test(s);
const isSteamId = (s) => typeof s === 'string' && /^\d{5,25}$/.test(s);

export function createApi({ pool, poller, verifier, rcon, config, log = console }) {
  const routes = [];
  const route = (method, pattern, handler) => {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
    routes.push({ method, re, keys, handler });
  };

  route('GET', '/internal/state', async () => {
    const s = poller.state;
    const { rows: links } = await pool.query('SELECT discord_id, steam_id FROM links');
    const bySteam = new Map(links.map((l) => [l.steam_id, l.discord_id]));
    return {
      ok: s.ok,
      lastSuccessAt: s.lastSuccessAt,
      lastError: s.lastError,
      matchId: s.matchId,
      matchStartedAt: s.matchStartedAt,
      matchReason: s.matchReason,
      clockDirection: s.clockDirection,
      serverId: s.serverId ?? null,
      status: s.status,
      players: s.players.map((p) => ({
        name: p.name,
        steamId: String(p.steamId),
        faction: p.faction ?? null,
        kills: Number.isFinite(p.kills) ? p.kills : null,
        deaths: Number.isFinite(p.deaths) ? p.deaths : null,
        discordId: bySteam.get(String(p.steamId)) ?? null,
      })),
    };
  });

  route('POST', '/internal/verify/start', async (_p, body) => {
    if (!isSnowflake(body.discordId)) return [400, { error: { code: 'bad_request', message: 'discordId required' } }];
    return { ok: true, ...(await verifier.start(body.discordId, body.name)) };
  });

  route('POST', '/internal/verify/confirm', async (_p, body) => {
    if (!isSnowflake(body.discordId)) return [400, { error: { code: 'bad_request', message: 'discordId required' } }];
    return { ok: true, ...(await verifier.confirm(body.discordId, body.code)) };
  });

  // Everyone who is linked (the bot keeps the Verified role in step with this).
  route('GET', '/internal/links', async () => {
    const { rows } = await pool.query('SELECT discord_id FROM links');
    return { ok: true, discordIds: rows.map((r) => r.discord_id) };
  });

  route('GET', '/internal/links/:discordId', async ({ discordId }) => {
    const { rows } = await pool.query(
      `SELECT l.discord_id, l.steam_id, l.verified_at, p.last_name
         FROM links l LEFT JOIN players p USING (steam_id) WHERE l.discord_id = $1`, [discordId]);
    if (!rows[0]) return [404, { error: { code: 'not_linked', message: 'Not linked.' } }];
    return { ok: true, link: rows[0] };
  });

  route('DELETE', '/internal/links/:discordId', async ({ discordId }) => {
    const { rowCount } = await pool.query('DELETE FROM links WHERE discord_id = $1', [discordId]);
    return { ok: true, removed: rowCount > 0 };
  });

  // Admin override: link someone by SteamID without the in-game code.
  route('POST', '/internal/links', async (_p, body) => {
    if (!isSnowflake(body.discordId) || !isSteamId(body.steamId)) {
      return [400, { error: { code: 'bad_request', message: 'discordId and numeric steamId required' } }];
    }
    try {
      await pool.query(
        `INSERT INTO links (discord_id, steam_id) VALUES ($1, $2)
         ON CONFLICT (discord_id) DO UPDATE SET steam_id = EXCLUDED.steam_id, verified_at = now()`,
        [body.discordId, body.steamId],
      );
    } catch (err) {
      if (err.code === '23505') return [409, { error: { code: 'steam_taken', message: 'That SteamID is linked to someone else. /unlink them first.' } }];
      throw err;
    }
    return { ok: true };
  });

  route('POST', '/internal/message', async (_p, body) => {
    if (!isSteamId(body.steamId) || typeof body.message !== 'string' || !body.message.trim()) {
      return [400, { error: { code: 'bad_request', message: 'steamId and message required' } }];
    }
    const r = await rcon.message(body.steamId, body.message.slice(0, 500));
    return { ok: true, result: r };
  });

  /**
   * Which database is really in use, and how much is in it. The answer matters:
   * on a host that rebuilds the container, the built-in database is wiped on
   * every deploy and every verified player with it.
   */
  async function databaseInfo() {
    const kind = pool.kind ?? (config.databaseUrl ? 'postgres' : 'pglite');
    const persistent = kind === 'postgres';
    let links = null;
    try {
      const { rows } = await pool.query('SELECT count(*)::int AS n FROM links');
      links = rows[0]?.n ?? null;
    } catch { /* counting is a nicety, never a reason to fail the call */ }
    return {
      kind,
      persistent,
      where: pool.where ?? (persistent ? 'a Postgres server' : config.dataDir),
      ephemeralHost: looksEphemeral(),
      links,
    };
  }

  // ---- actions on the game server ----
  // All capability-gated in rcon.js: an unsupported build comes back as a 502
  // with a readable sentence, which the bot shows the admin as-is.

  route('POST', '/internal/broadcast', async (_p, body) => {
    if (typeof body.message !== 'string' || !body.message.trim()) {
      return [400, { error: { code: 'bad_request', message: 'message required' } }];
    }
    return { ok: true, result: await rcon.broadcast(body.message.slice(0, 500)) };
  });

  route('POST', '/internal/players/:steamId/kick', async ({ steamId }, body) => {
    if (!isSteamId(steamId)) {
      return [400, { error: { code: 'bad_request', message: 'steamId required' } }];
    }
    const reason = String(body.reason ?? '').trim().slice(0, 200) || 'Kicked by an admin';
    return { ok: true, result: await rcon.kick(steamId, reason) };
  });

  // `faction` is the server's own faction string, resolved by the bot from a
  // colour. Core never guesses one: an empty or unknown value is rejected here
  // rather than sent to the game.
  route('POST', '/internal/players/:steamId/faction', async ({ steamId }, body) => {
    if (!isSteamId(steamId)) {
      return [400, { error: { code: 'bad_request', message: 'steamId required' } }];
    }
    const faction = String(body.faction ?? '').trim();
    if (!faction) {
      return [400, { error: { code: 'bad_request', message: 'faction required (the game server\'s own name for it)' } }];
    }
    return { ok: true, result: await rcon.setFaction(steamId, faction) };
  });

  route('POST', '/internal/match/end', async () => ({ ok: true, result: await rcon.endMatch() }));

  route('POST', '/internal/players/:steamId/kill', async ({ steamId }) => {
    if (!isSteamId(steamId)) return [400, { error: { code: 'bad_request', message: 'steamId required' } }];
    return { ok: true, result: await rcon.kill(steamId) };
  });

  route('POST', '/internal/match/restart', async () => ({ ok: true, result: await rcon.restartMatch() }));

  route('POST', '/internal/match/map', async (_p, body) => {
    const map = String(body.map ?? '').trim();
    if (!map) return [400, { error: { code: 'bad_request', message: 'map required' } }];
    return { ok: true, result: await rcon.setMap({ map, lighting: body.lighting, experiences: body.experiences, zoneAlternator: body.zoneAlternator }) };
  });

  route('PUT', '/internal/world/lighting', async (_p, body) => {
    const lighting = String(body.lighting ?? '').trim();
    if (!lighting) return [400, { error: { code: 'bad_request', message: 'lighting required' } }];
    return { ok: true, result: await rcon.setLighting(lighting) };
  });

  route('GET', '/internal/bans', async () => ({ ok: true, bans: await rcon.bans() }));

  route('POST', '/internal/bans', async (_p, body) => {
    if (!isSteamId(String(body.steamId ?? ''))) {
      return [400, { error: { code: 'bad_request', message: 'steamId required' } }];
    }
    const reason = String(body.reason ?? '').trim().slice(0, 200) || 'Banned by an admin';
    return { ok: true, result: await rcon.ban(String(body.steamId), reason) };
  });

  route('DELETE', '/internal/bans/:steamId', async ({ steamId }) => {
    if (!isSteamId(steamId)) return [400, { error: { code: 'bad_request', message: 'steamId required' } }];
    return { ok: true, result: await rcon.unban(steamId) };
  });

  route('GET', '/internal/catalog/:kind', async ({ kind }) => {
    if (!['maps', 'lightings', 'experiences'].includes(kind)) {
      return [400, { error: { code: 'bad_request', message: 'kind must be maps, lightings or experiences' } }];
    }
    return { ok: true, items: await rcon.catalog(kind) };
  });

  route('GET', '/internal/reserved-slots', async () => {
    const { list, raw } = await rcon.reservedSlots();
    return { ok: true, slots: list, raw };
  });

  route('GET', '/internal/rotation', async () => ({ ok: true, rotation: await rcon.rotation() }));

  route('GET', '/internal/audit', async () => ({ ok: true, entries: await rcon.audit(50) }));

  // Read-only for now. PUT /v1/config replaces the entire document and a bad
  // value blocks unrelated edits, so writing is not wired up until we have seen
  // a real one. See CLAUDE.md.
  route('GET', '/internal/config', async () => {
    const c = await rcon.getConfig();
    return {
      ok: true,
      revision: c?.revision ?? null,
      writable: c?.writable ?? null,
      warnings: c?.warnings ?? [],
      sections: c?.sections ?? [],
      text: typeof c?.text === 'string' ? c.text : '',
    };
  });

  // What this particular server build can do, plus the raw numbers behind the
  // three things CLAUDE.md lists as unverified (clock direction, the score
  // field inside factionScores[], the real player.faction strings). Lets an
  // admin read them off a live server without shell access.
  route('GET', '/internal/diagnostics', async () => {
    const s = poller.state;
    const factions = [...new Set((s.players ?? []).map((p) => p.faction).filter((f) => typeof f === 'string' && f))];
    return {
      ok: true,
      rconOk: s.ok,
      lastError: s.lastError,
      apiVersion: rcon.capabilities?.apiVersion ?? null,
      build: rcon.capabilities?.build ?? null,
      serverId: s.serverId,
      // Host only, never the RCON port or the password. Enough to confirm the
      // public address people are given points at the same machine.
      rconHost: (() => { try { return new URL(config.rconUrl).hostname; } catch { return null; } })(),
      actions: rcon.supportedActions(),
      config: rcon.configInfo(),
      database: await databaseInfo(),
      routes: [...(rcon.routes ?? [])].sort(),
      clockDirection: s.clockDirection,
      matchSeconds: s.status?.matchSeconds ?? null,
      // Which keys /v1/status actually has, so a missing matchSeconds can be
      // told apart from a match that simply isn't running.
      statusKeys: Object.keys(s.status ?? {}).sort(),
      factionScores: s.status?.factionScores ?? [],
      factionStrings: factions,
      playerCount: (s.players ?? []).length,
    };
  });

  route('POST', '/internal/commander-log', async (_p, body) => {
    await pool.query(
      'INSERT INTO commander_log (match_id, faction, discord_id, event) VALUES ($1, $2, $3, $4)',
      [body.matchId ?? null, String(body.faction ?? ''), String(body.discordId ?? ''), String(body.event ?? '')],
    );
    return { ok: true };
  });

  // ---- seeding: a standing list of who wants to play ----
  //
  // People click a button in Discord. The list is what they clicked, and it
  // stays what they clicked: a name is NOT removed because that person went and
  // waited in the server. The rules are in seeding.js; this holds the list.

  /**
   * The state of play, and whether there's a message to post.
   *
   * The only tidying is stale names. Everything else about the list is exactly
   * what people put on it.
   */
  async function seedSummary() {
    const s = poller.state;
    await pool.query(
      'DELETE FROM seed_pledges WHERE pledged_at < now() - make_interval(mins => $1)',
      [config.seedPledgeMinutes]);
    const { rows } = await pool.query('SELECT discord_id, pledged_at FROM seed_pledges ORDER BY pledged_at');
    const { rows: pings } = await pool.query(
      `SELECT kind, max(pinged_at) AS at FROM seed_pings GROUP BY kind`);
    const at = (kind) => {
      const r = pings.find((x) => x.kind === kind);
      return r ? new Date(r.at).toISOString() : null;
    };
    const pledges = rows.map((r) => ({ discordId: r.discord_id, at: new Date(r.pledged_at).toISOString() }));
    const lastCallAt = at('call');
    const lastNudgeAt = at('nudge');
    const playersOn = (s.players ?? []).length;
    const decision = seedDecision({
      pledges,
      playersOn,
      serverOk: s.ok,
      target: config.seedTarget,
      nudgeAt: config.seedNudgeAt,
      lastCallAt,
      lastNudgeAt,
      pledgeMinutes: config.seedPledgeMinutes,
      cooldownMinutes: config.seedCooldownMinutes,
    });
    return {
      ok: true,
      pledges,
      lastCallAt,
      lastNudgeAt,
      lastPingAt: lastCallAt,
      playersOn,
      serverOk: s.ok,
      target: config.seedTarget,
      pledgeMinutes: config.seedPledgeMinutes,
      cooldownMinutes: config.seedCooldownMinutes,
      ...decision,
    };
  }

  route('GET', '/internal/seed', async () => seedSummary());

  // on: true = "I want to play", false = take my name off. Clicking twice is
  // not an error; it moves the clock on, which is what a second click means.
  route('POST', '/internal/seed/pledge', async (_p, body) => {
    if (!isSnowflake(body.discordId)) {
      return [400, { error: { code: 'bad_request', message: 'discordId required' } }];
    }
    const on = body.on !== false;
    if (on) {
      await pool.query(
        `INSERT INTO seed_pledges (discord_id) VALUES ($1)
         ON CONFLICT (discord_id) DO UPDATE SET pledged_at = now()`, [body.discordId]);
    } else {
      await pool.query('DELETE FROM seed_pledges WHERE discord_id = $1', [body.discordId]);
    }
    return { ok: true, on, ...(await seedSummary()) };
  });

  /**
   * Record a ping and, for a call, clear the list. Core decides, not the bot:
   * two bot ticks (or two bots) landing at once must not ping twice, so the
   * cooldown is enforced by the INSERT itself and the loser is told it already
   * happened. Cooldowns are per kind, so a nudge can never hold back a call.
   *
   * `force` (an admin using /seed call-now) skips the target, but NOT the
   * cooldown: the promise made to everyone who took the ping role is that it
   * can't go off twice in a row, and an admin in a hurry is exactly the case
   * that promise is for.
   */
  route('POST', '/internal/seed/ping', async (_p, body) => {
    const kind = body.kind === 'nudge' ? 'nudge' : 'call';
    const summary = await seedSummary();
    if (!body.force && summary.action !== kind) return { ok: true, fired: false, ...summary };
    const { rows } = await pool.query(
      `INSERT INTO seed_pings (ready, kind)
       SELECT $1::int, $2::text WHERE NOT EXISTS (
         SELECT 1 FROM seed_pings WHERE kind = $2::text AND pinged_at > now() - make_interval(mins => $3))
       RETURNING id, pinged_at`,
      [summary.ready, kind, config.seedCooldownMinutes]);
    if (!rows[0]) {
      const prev = kind === 'call' ? summary.lastCallAt : summary.lastNudgeAt;
      const over = prev ? config.seedCooldownMinutes * 60_000 - (Date.now() - Date.parse(prev)) : 0;
      return {
        ok: true, fired: false, ...summary,
        reason: over > 0
          ? `that message went out recently, ${Math.ceil(over / 60_000)} min before the next one`
          : 'that message went out a moment ago',
      };
    }
    // A call has done its job, so the list starts again: the next match needs
    // people who want THAT one, not names left over from this one. A nudge
    // changes nothing, since its whole point is to grow the same list.
    if (kind === 'call') await pool.query('DELETE FROM seed_pledges');
    return {
      ok: true, fired: true, kind, ready: summary.ready, playersOn: summary.playersOn,
      target: summary.target, needed: summary.needed, nudgeAt: summary.nudgeAt,
      pledges: summary.pledges, pingedAt: new Date(rows[0].pinged_at).toISOString(),
    };
  });

  // ---- post-match commander ratings ----

  const tallies = async (roundIds) => {
    if (!roundIds.length) return new Map();
    const { rows } = await pool.query(
      `SELECT round_id, value, count(*)::int AS n FROM rating_votes
        WHERE round_id = ANY($1::bigint[]) GROUP BY round_id, value`, [roundIds]);
    const out = new Map(roundIds.map((id) => [String(id), { good: 0, poor: 0, toxic: 0 }]));
    for (const r of rows) out.get(String(r.round_id))[r.value] = r.n;
    return out;
  };

  // Linked players in a match, with how long they spent on each (in-game) faction.
  route('GET', '/internal/matches/:matchId/participants', async ({ matchId }) => {
    const sec = Math.round(config.pollIntervalMs / 1000);
    const { rows } = await pool.query(
      `SELECT l.discord_id, ps.faction, count(*)::int * $2::int AS seconds
         FROM player_samples ps JOIN links l USING (steam_id)
        WHERE ps.match_id = $1 AND ps.faction IS NOT NULL
        GROUP BY l.discord_id, ps.faction`, [matchId, sec]);
    return { ok: true, participants: rows.map((r) => ({ discordId: r.discord_id, faction: r.faction, seconds: r.seconds })) };
  });

  // Who commanded in a match and for how long (from commander_log).
  route('GET', '/internal/matches/:matchId/commanders', async ({ matchId }) => {
    const { rows: [m] } = await pool.query('SELECT ended_at FROM matches WHERE id = $1', [matchId]);
    if (!m) return [404, { error: { code: 'no_match', message: 'No such match.' } }];
    const { rows } = await pool.query(
      `SELECT faction, discord_id, event, at FROM commander_log
        WHERE match_id = $1 AND event IN ('accepted', 'claimed', 'removed') ORDER BY at`, [matchId]);
    return { ok: true, terms: commanderTerms(rows, m.ended_at ?? new Date()) };
  });

  // Who rates whom after a match. The bot sends factionMap (in-game faction
  // name -> blue/red/green). A voter must have been on that faction for
  // minPlaySec *while that commander was leading*, not just at some point.
  route('POST', '/internal/matches/:matchId/rating-plan', async ({ matchId }, body) => {
    const { rows: [m] } = await pool.query('SELECT ended_at FROM matches WHERE id = $1', [matchId]);
    if (!m) return [404, { error: { code: 'no_match', message: 'No such match.' } }];
    const { rows: log } = await pool.query(
      `SELECT faction, discord_id, event, at FROM commander_log
        WHERE match_id = $1 AND event IN ('accepted', 'claimed', 'removed') ORDER BY at`, [matchId]);
    const plan = ratedTerms(commanderTerms(log, m.ended_at ?? new Date()), {
      minServeSec: Number(body.minServeSec ?? 300), maxPerFaction: Number(body.maxPerFaction ?? 3),
    });
    const factionMap = body.factionMap ?? {};
    const minPlaySec = Number(body.minPlaySec ?? 300);
    const sec = Math.round(config.pollIntervalMs / 1000);
    for (const f of plan) {
      const gameNames = Object.keys(factionMap).filter((n) => factionMap[n] === f.faction);
      for (const c of f.commanders) {
        const { rows } = await pool.query(
          `SELECT l.discord_id, count(*)::int * $5::int AS seconds
             FROM player_samples ps
             JOIN status_samples ss ON ss.id = ps.sample_id
             JOIN links l ON l.steam_id = ps.steam_id
            WHERE ps.match_id = $1 AND ps.faction = ANY($2::text[])
              AND EXISTS (SELECT 1 FROM unnest($3::timestamptz[], $4::timestamptz[]) AS iv(s, e)
                           WHERE ss.polled_at >= iv.s AND ss.polled_at < iv.e)
            GROUP BY l.discord_id`,
          [matchId, gameNames, c.intervals.map((i) => i[0]), c.intervals.map((i) => i[1]), sec]);
        c.voterIds = rows.filter((r) => r.seconds >= minPlaySec && r.discord_id !== c.discordId).map((r) => r.discord_id);
      }
    }
    return { ok: true, factions: plan };
  });

  // Open a rating round (idempotent per match+faction+commander).
  route('POST', '/internal/ratings/rounds', async (_p, body) => {
    const voters = (Array.isArray(body.voterIds) ? body.voterIds : []).filter(isSnowflake).filter((v) => v !== body.commanderId);
    if (!body.matchId || !body.faction || !isSnowflake(body.commanderId)) {
      return [400, { error: { code: 'bad_request', message: 'matchId, faction, commanderId required' } }];
    }
    const ins = await pool.query(
      `INSERT INTO rating_rounds (match_id, faction, commander_id, served_sec, closes_at)
       VALUES ($1, $2, $3, $4, now() + make_interval(mins => $5))
       ON CONFLICT (match_id, faction, commander_id) DO NOTHING
       RETURNING id, closes_at`,
      [body.matchId, String(body.faction), body.commanderId, Number(body.servedSec) || 0, config.ratingVoteMinutes]);
    if (!ins.rows[0]) return { ok: true, created: false };
    const roundId = Number(ins.rows[0].id);
    if (voters.length) {
      await pool.query(
        `INSERT INTO rating_voters (round_id, voter_id) SELECT $1, * FROM unnest($2::text[]) ON CONFLICT DO NOTHING`,
        [roundId, voters]);
    }
    return { ok: true, created: true, roundId, closesAt: ins.rows[0].closes_at, voters };
  });

  // Cast or change a vote.
  route('POST', '/internal/ratings/votes', async (_p, body) => {
    const value = String(body.value ?? '');
    if (!['good', 'poor', 'toxic'].includes(value) || !isSnowflake(body.voterId)) {
      return [400, { error: { code: 'bad_request', message: 'voterId and value (good|poor|toxic) required' } }];
    }
    const { rows: [round] } = await pool.query(
      `SELECT r.id, r.commander_id, r.faction, r.match_id, r.toxic_alerted, r.closes_at < now() AS closed,
              EXISTS (SELECT 1 FROM rating_voters v WHERE v.round_id = r.id AND v.voter_id = $2) AS eligible
         FROM rating_rounds r WHERE r.id = $1`, [body.roundId, body.voterId]);
    if (!round) return [404, { error: { code: 'no_round', message: 'That vote no longer exists.' } }];
    if (round.closed) return [400, { error: { code: 'closed', message: 'Voting for that match has closed.' } }];
    if (round.commander_id === body.voterId) return [403, { error: { code: 'own_round', message: "You can't rate yourself. Your faction does that." } }];
    if (!round.eligible) return [403, { error: { code: 'not_eligible', message: "You weren't on that faction long enough to rate this commander." } }];
    await pool.query(
      `INSERT INTO rating_votes (round_id, voter_id, value) VALUES ($1, $2, $3)
       ON CONFLICT (round_id, voter_id) DO UPDATE SET value = EXCLUDED.value, voted_at = now()`,
      [round.id, body.voterId, value]);
    const t = (await tallies([round.id])).get(String(round.id));
    let toxicAlert = false;
    if (t.toxic >= 3 && !round.toxic_alerted) {
      await pool.query('UPDATE rating_rounds SET toxic_alerted = true WHERE id = $1', [round.id]);
      toxicAlert = true;
    }
    return { ok: true, value, tallies: t, toxicAlert, commanderId: round.commander_id, faction: round.faction, matchId: Number(round.match_id) };
  });

  // Every commander's score over the rating window.
  route('GET', '/internal/ratings/scores', async () => {
    const { rows } = await pool.query(
      `SELECT id, commander_id FROM rating_rounds
        WHERE opened_at > now() - make_interval(days => $1)`, [config.ratingWindowDays]);
    const t = await tallies(rows.map((r) => Number(r.id)));
    const scores = {};
    for (const r of rows) {
      const v = t.get(String(r.id));
      const s = (scores[r.commander_id] ??= { score: 0, matches: 0, good: 0, poor: 0, toxic: 0 });
      s.score += roundPoints(v);
      s.matches += 1;
      s.good += v.good; s.poor += v.poor; s.toxic += v.toxic;
    }
    return { ok: true, windowDays: config.ratingWindowDays, scores };
  });

  // Closed rounds whose commander hasn't had their summary yet.
  route('GET', '/internal/ratings/due', async () => {
    const { rows } = await pool.query(
      `SELECT id, match_id, faction, commander_id, served_sec FROM rating_rounds
        WHERE closes_at < now() AND NOT notified ORDER BY id LIMIT 20`);
    const t = await tallies(rows.map((r) => Number(r.id)));
    return { ok: true, rounds: rows.map((r) => ({
      roundId: Number(r.id), matchId: Number(r.match_id), faction: r.faction, commanderId: r.commander_id,
      servedSec: r.served_sec, tallies: t.get(String(r.id)),
    })) };
  });

  route('POST', '/internal/ratings/rounds/:roundId/notified', async ({ roundId }) => {
    await pool.query('UPDATE rating_rounds SET notified = true WHERE id = $1', [roundId]);
    return { ok: true };
  });

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://internal');
    if (req.method === 'GET' && url.pathname === '/internal/health') {
      return send(res, 200, { ok: true, rconOk: poller.state.ok, lastSuccessAt: poller.state.lastSuccessAt });
    }
    if (!authorized(req, config.internalToken)) return fail(res, 401, 'unauthorized', 'Bad or missing internal token.');

    for (const r of routes) {
      if (r.method !== req.method) continue;
      const m = r.re.exec(url.pathname);
      if (!m) continue;
      const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
      try {
        const body = ['POST', 'PUT', 'PATCH'].includes(req.method) ? await readJson(req) : {};
        const out = await r.handler(params, body);
        if (Array.isArray(out)) return send(res, out[0], out[1]);
        return send(res, 200, out);
      } catch (err) {
        if (err instanceof VerifyError) return fail(res, 400, err.code, err.message);
        if (err instanceof RconError) {
          log.warn(`[api] ${req.method} ${url.pathname}: ${err.message}`);
          // A 4xx means we asked for something the game refused (unknown
          // faction, player not online). That reason is useful to whoever
          // typed the command, and carries no secret: the password travels in
          // a header, never in the path or the reply. Anything else is the
          // server being unwell, where the detail helps nobody.
          const useful = err.code === 'unsupported' || (err.status >= 400 && err.status < 500);
          const msg = useful ? err.message : "The game server didn't accept that request. Try again shortly.";
          return fail(res, 502, `rcon_${err.code}`, msg);
        }
        if (err.http) return fail(res, err.http, 'bad_request', err.message);
        log.error(`[api] ${req.method} ${url.pathname} crashed:`, err);
        return fail(res, 500, 'internal', 'Internal error.');
      }
    }
    fail(res, 404, 'not_found', 'No such route.');
  });
  return server;
}
