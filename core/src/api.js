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
import { NOTICES, eventStage, zonedTimeToUtc } from './events.js';
import {
  COMMANDERS_SQL, STARTERS_SQL, TOTALS_SQL,
  boards, commanderStats, leaderboardWindow, playerStats, starterStats,
} from './leaderboard.js';
import { ConfigEditError, explainConfigErrors, getConfigValue, listConfigMembers, setConfigListMember, setConfigValue } from './configedit.js';

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
      lastErrorCode: s.lastErrorCode ?? null,
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

  /**
   * Change ONE setting on the game server.
   *
   * Read, edit that one line, ask the server whether it would accept the
   * result, and only then save it. `apply` is false by default: the expensive
   * mistake here is writing something nobody looked at, so the default is to
   * come back with "this is what would change" and wait to be asked again.
   *
   * PUT /v1/config replaces the whole document, so the text that goes back is
   * the text that came out with one line different. See configedit.js.
   */
  route('PUT', '/internal/config/value', async (_p, body) => {
    const section = String(body.section ?? '').trim();
    const key = String(body.key ?? '').trim();
    const value = String(body.value ?? '');
    const apply = body.apply === true;
    if (!section || !key) {
      return [400, { error: { code: 'bad_request', message: 'section and key required' } }];
    }

    const doc = await rcon.getConfig();
    const info = rcon.configInfo();
    if (!info.writable) {
      return [400, { error: { code: 'not_writable', message: 'This server build does not allow its settings to be changed.' } }];
    }

    let edit;
    try {
      edit = setConfigValue(doc?.text, { section, key, value });
    } catch (err) {
      if (err instanceof ConfigEditError) return [400, { error: { code: err.code, message: err.message } }];
      throw err;
    }
    const base = { ok: true, section, key, from: edit.from, to: value, line: edit.line, revision: doc.revision };
    if (!edit.changed) return { ...base, changed: false, applied: false, message: `${key} is already ${value || '(empty)'}.` };

    // Checked before saving, every time. A refusal here costs nothing.
    try {
      const v = await rcon.validateConfig(edit.text);
      if (v && v.ok === false) {
        return [400, { error: { code: 'invalid', message: explainConfigErrors(v.errors, { section, key }) } }];
      }
    } catch (err) {
      if (err instanceof RconError && err.errors) {
        return [400, { error: { code: 'invalid', message: explainConfigErrors(err.errors, { section, key }) } }];
      }
      throw err;
    }

    if (!apply) return { ...base, changed: true, applied: false, validated: true };

    try {
      await rcon.writeConfig(edit.text, doc.revision);
    } catch (err) {
      // 412: somebody else saved while this was being prepared. Writing anyway
      // would silently undo their change, so it doesn't.
      if (err instanceof RconError && err.status === 412) {
        return [409, { error: { code: 'stale', message: 'The settings changed while this was being prepared, so nothing was saved. Try again.' } }];
      }
      if (err instanceof RconError && err.errors) {
        return [400, { error: { code: 'invalid', message: explainConfigErrors(err.errors, { section, key }) } }];
      }
      throw err;
    }
    log.log(`[config] ${section} ${key}: ${edit.from} -> ${value}`);
    return { ...base, changed: true, applied: true, validated: true };
  });

  /**
   * Reserved slots: read, grant, revoke.
   *
   * These are an array in the settings document, not the writable route that
   * GET /v1/reserved-slots makes them look like, so granting one is an edit to
   * that document. Same care as any other: validate, then write with the
   * revision the text was read at. See configedit.js.
   */
  async function reservedState() {
    const doc = await rcon.getConfig();
    const members = listConfigMembers(doc.text, { section: config.reservedSection, key: config.reservedKey });
    // The cap is an ordinary setting in the same section. Read it from THAT
    // section: the same key name turns up elsewhere in the document.
    const cap = getConfigValue(doc.text, { section: config.reservedSection, key: config.reservedCapKey });
    const max = Number(cap);
    return { doc, members, max: Number.isFinite(max) && max > 0 ? max : null };
  }

  // A placeholder row of zeros is not a person. It still occupies a line, so it
  // is reported rather than hidden, but it is not counted as a granted slot.
  const isPlaceholder = (id) => /^0+$/.test(String(id ?? ''));

  route('GET', '/internal/reserved', async () => {
    const { members, max, doc } = await reservedState();
    const granted = members.filter((m) => !isPlaceholder(m));
    return {
      ok: true,
      section: config.reservedSection,
      key: config.reservedKey,
      members,
      granted,
      placeholders: members.filter(isPlaceholder),
      max,
      free: typeof max === 'number' ? Math.max(0, max - members.length) : null,
      writable: rcon.configInfo().writable,
      revision: doc.revision,
    };
  });

  async function changeReserved({ steamId, action, apply }) {
    const { doc, members, max } = await reservedState();
    if (!rcon.configInfo().writable) {
      return [400, { error: { code: 'not_writable', message: 'This server build does not allow its settings to be changed.' } }];
    }
    let edit;
    try {
      edit = setConfigListMember(doc.text, {
        section: config.reservedSection, key: config.reservedKey, value: steamId, action, max,
      });
    } catch (err) {
      if (err instanceof ConfigEditError) return [400, { error: { code: err.code, message: err.message } }];
      throw err;
    }
    const base = { ok: true, steamId, action, members: edit.members, max, before: members };
    if (!edit.changed) {
      return { ...base, changed: false, applied: false,
        message: action === 'add' ? 'They already have a reserved slot.' : "They don't have a reserved slot." };
    }
    try {
      const v = await rcon.validateConfig(edit.text);
      if (v && v.ok === false) {
        return [400, { error: { code: 'invalid', message: explainConfigErrors(v.errors, { section: config.reservedSection, key: config.reservedKey }) } }];
      }
    } catch (err) {
      if (err instanceof RconError && err.errors) {
        return [400, { error: { code: 'invalid', message: explainConfigErrors(err.errors, { section: config.reservedSection, key: config.reservedKey }) } }];
      }
      throw err;
    }
    if (!apply) return { ...base, changed: true, applied: false, validated: true };
    try {
      await rcon.writeConfig(edit.text, doc.revision);
    } catch (err) {
      if (err instanceof RconError && err.status === 412) {
        return [409, { error: { code: 'stale', message: 'The settings changed while this was being prepared, so nothing was saved. Try again.' } }];
      }
      if (err instanceof RconError && err.errors) {
        return [400, { error: { code: 'invalid', message: explainConfigErrors(err.errors, { section: config.reservedSection, key: config.reservedKey }) } }];
      }
      throw err;
    }
    log.log(`[config] reserved slot ${action}: ${steamId} (${edit.members.length}${max ? `/${max}` : ''})`);
    return { ...base, changed: true, applied: true, validated: true };
  }

  route('POST', '/internal/reserved', async (_p, body) => {
    if (!isSteamId(String(body.steamId ?? ''))) {
      return [400, { error: { code: 'bad_request', message: 'numeric steamId required' } }];
    }
    return changeReserved({ steamId: String(body.steamId), action: 'add', apply: body.apply === true });
  });

  route('DELETE', '/internal/reserved/:steamId', async ({ steamId }, body) => {
    if (!isSteamId(steamId)) return [400, { error: { code: 'bad_request', message: 'numeric steamId required' } }];
    return changeReserved({ steamId, action: 'remove', apply: body?.apply === true });
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
      lastErrorCode: s.lastErrorCode ?? null,
      lastSuccessAt: s.lastSuccessAt,
      // False until the game server has answered once since core started.
      // Until then every action reads as unsupported, which is not the same
      // as this build lacking them, and /healthcheck must not say it is.
      capabilitiesLoaded: rcon.routes !== null,
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
  /**
   * The match-start threshold, taken from the GAME SERVER rather than from a
   * setting of ours.
   *
   * These two numbers have to agree: if the server starts a match at 20 and
   * seeding calls people in at 45, the call-in is announcing something that
   * already happened. Keeping our own copy guarantees they drift apart, so
   * there is no copy. Change it on the server with /settings and seeding
   * follows. SEED_TARGET is only the fallback for when the server can't be
   * asked, or doesn't have the setting.
   *
   * Cached: this is read on the seeding beat, and the settings document is a
   * much heavier call than a status poll.
   */
  let targetCache = { at: 0, value: null };
  async function matchTarget() {
    if (Date.now() - targetCache.at < 5 * 60_000) return targetCache.value ?? config.seedTarget;
    targetCache = { at: Date.now(), value: targetCache.value };
    try {
      const doc = await rcon.getConfig();
      const raw = getConfigValue(doc.text, { section: config.matchStartSection, key: config.matchStartKey });
      const n = Number(raw);
      targetCache.value = Number.isFinite(n) && n > 1 ? n : null;
    } catch {
      // Unreachable or unsupported: keep whatever we last knew, else the setting.
    }
    return targetCache.value ?? config.seedTarget;
  }

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
    // Below the target WARDOGS does not start a match, so anybody in there is
    // standing in an empty lobby waiting for the same thing the list is waiting
    // for. They count towards it — but only the ones who are NOT already on the
    // list, or the person who clicked and then went to warm up would be counted
    // twice. An unlinked player has no discordId and can never be on the list.
    const pledged = new Set(pledges.map((p) => p.discordId));
    const waiting = (s.players ?? []).filter((p) => !p.discordId || !pledged.has(p.discordId)).length;
    const target = await matchTarget();
    const decision = seedDecision({
      pledges,
      playersOn,
      waiting,
      serverOk: s.ok,
      target,
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
      waiting,
      serverOk: s.ok,
      target,
      targetFromServer: targetCache.value !== null,
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
    //
    // The same statement writes down who was on it. One statement, so the names
    // cannot be lost between clearing the list and recording it — and getting a
    // quiet server busy is the one contribution the game itself cannot see.
    if (kind === 'call') {
      await pool.query(
        `WITH cleared AS (DELETE FROM seed_pledges RETURNING discord_id)
         INSERT INTO seed_credits (ping_id, discord_id)
         SELECT $1::bigint, discord_id FROM cleared
         ON CONFLICT DO NOTHING`,
        [rows[0].id]);
    }
    return {
      ok: true, fired: true, kind, ready: summary.ready, playersOn: summary.playersOn,
      target: summary.target, needed: summary.needed, nudgeAt: summary.nudgeAt,
      pledges: summary.pledges, pingedAt: new Date(rows[0].pinged_at).toISOString(),
    };
  });

  // ---- scheduled matches ("operations") ----
  //
  // The point of an event is that the count is known BEFORE anyone has to be in
  // the server: under the target WARDOGS does not start a match, so arriving
  // early means standing on an empty map. See core/src/events.js.

  /** One event with its answers and whatever it should be doing right now. */
  async function eventRow(row, { now = Date.now() } = {}) {
    const [{ rows: rsvps }, { rows: notices }] = await Promise.all([
      pool.query('SELECT discord_id, answer FROM event_rsvps WHERE event_id = $1 ORDER BY answered_at', [row.id]),
      pool.query('SELECT kind FROM event_notices WHERE event_id = $1', [row.id]),
    ]);
    const by = (a) => rsvps.filter((r) => r.answer === a).map((r) => r.discord_id);
    const yes = by('yes');
    const sent = notices.map((n) => n.kind);
    const event = {
      id: String(row.id),
      startsAt: new Date(row.starts_at).toISOString(),
      title: row.title,
      target: row.target,
      createdBy: row.created_by,
      cancelledAt: row.cancelled_at ? new Date(row.cancelled_at).toISOString() : null,
      cancelReason: row.cancel_reason ?? null,
      yes,
      maybe: by('maybe'),
      no: by('no'),
      sent,
    };
    // Only what the stage DECIDED. It also reports `yes` and `target` as
    // counts, and spreading those over the event replaced the list of people
    // coming with the number of them — which broke every board that asks how
    // many names are on it.
    const { action, reason, needed, minutesAway } = eventStage({
      startsAt: event.startsAt,
      cancelledAt: event.cancelledAt,
      yes: yes.length,
      target: row.target,
      sent,
      now,
      goMinutes: config.eventGoMinutes,
      remindMinutes: config.eventRemindMinutes,
      closeMinutes: config.eventCloseMinutes,
    });
    return { ...event, action, reason, needed, minutesAway };
  }

  /** Everything not yet finished, soonest first. */
  route('GET', '/internal/events', async () => {
    const { rows } = await pool.query(
      `SELECT * FROM events
        WHERE starts_at > now() - make_interval(mins => $1)
        ORDER BY starts_at`,
      [config.eventCloseMinutes]);
    return { ok: true, events: await Promise.all(rows.map((r) => eventRow(r))) };
  });

  route('GET', '/internal/events/:id', async ({ id }) => {
    const { rows } = await pool.query('SELECT * FROM events WHERE id = $1', [id]);
    if (!rows[0]) return [404, { error: { code: 'no_event', message: 'No event with that number.' } }];
    return { ok: true, event: await eventRow(rows[0]) };
  });

  route('POST', '/internal/events', async (_p, body) => {
    // Either an instant, or the wall clock an admin actually typed plus the
    // zone it was typed in. The conversion lives here rather than in the bot so
    // there is one implementation of the daylight-saving arithmetic.
    let at;
    if (body.date || body.time) {
      try {
        at = zonedTimeToUtc(body.date, body.time, body.timezone || 'UTC');
      } catch (err) {
        return [400, { error: { code: 'bad_time', message: err.message } }];
      }
    } else {
      at = Date.parse(body.startsAt);
    }
    if (!Number.isFinite(at)) {
      return [400, { error: { code: 'bad_request', message: 'startsAt, or date and time, required' } }];
    }
    if (at < Date.now()) {
      return [400, { error: { code: 'in_the_past', message: 'That time has already gone by. Check the date and the timezone.' } }];
    }
    if (!isSnowflake(body.createdBy)) {
      return [400, { error: { code: 'bad_request', message: 'createdBy required' } }];
    }
    // The default target is the game server's own minimum, for the same reason
    // seeding reads it: two numbers that have to agree must not be kept twice.
    const target = Number(body.target) > 1 ? Math.floor(Number(body.target)) : await matchTarget();
    const title = String(body.title ?? '').trim().slice(0, 100) || 'Match night';
    const { rows } = await pool.query(
      `INSERT INTO events (starts_at, title, target, created_by)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [new Date(at).toISOString(), title, target, body.createdBy]);
    return { ok: true, event: await eventRow(rows[0]) };
  });

  route('POST', '/internal/events/:id/cancel', async ({ id }, body) => {
    const { rows } = await pool.query(
      `UPDATE events SET cancelled_at = now(), cancel_reason = $2
        WHERE id = $1 AND cancelled_at IS NULL RETURNING *`,
      [id, String(body.reason ?? '').trim().slice(0, 200) || null]);
    if (!rows[0]) return [404, { error: { code: 'no_event', message: 'No event with that number, or it was already called off.' } }];
    return { ok: true, event: await eventRow(rows[0]) };
  });

  route('POST', '/internal/events/:id/rsvp', async ({ id }, body) => {
    if (!isSnowflake(body.discordId)) {
      return [400, { error: { code: 'bad_request', message: 'discordId required' } }];
    }
    const answer = ['yes', 'maybe', 'no'].includes(body.answer) ? body.answer : null;
    if (!answer) return [400, { error: { code: 'bad_request', message: 'answer must be yes, maybe or no' } }];
    const { rows } = await pool.query('SELECT * FROM events WHERE id = $1', [id]);
    if (!rows[0]) return [404, { error: { code: 'no_event', message: 'No event with that number.' } }];
    if (rows[0].cancelled_at) {
      return [409, { error: { code: 'cancelled', message: 'That one was called off.' } }];
    }
    await pool.query(
      `INSERT INTO event_rsvps (event_id, discord_id, answer) VALUES ($1, $2, $3)
       ON CONFLICT (event_id, discord_id) DO UPDATE SET answer = EXCLUDED.answer, answered_at = now()`,
      [id, body.discordId, answer]);
    return { ok: true, answer, event: await eventRow(rows[0]) };
  });

  /**
   * Claim a notice. Core decides whether it really goes out, not the bot: the
   * INSERT is the lock, so two ticks landing together cannot announce twice.
   */
  route('POST', '/internal/events/:id/notice', async ({ id }, body) => {
    const kind = NOTICES.includes(body.kind) ? body.kind : null;
    if (!kind) return [400, { error: { code: 'bad_request', message: `kind must be one of ${NOTICES.join(', ')}` } }];
    const { rows } = await pool.query('SELECT * FROM events WHERE id = $1', [id]);
    if (!rows[0]) return [404, { error: { code: 'no_event', message: 'No event with that number.' } }];
    const claim = await pool.query(
      `INSERT INTO event_notices (event_id, kind) VALUES ($1, $2)
       ON CONFLICT (event_id, kind) DO NOTHING RETURNING sent_at`,
      [id, kind]);
    return { ok: true, fired: claim.rows.length > 0, kind, event: await eventRow(rows[0]) };
  });

  /**
   * Leaderboards over the last `days`.
   *
   * Everything here is derived from the 5-second samples: the game exposes no
   * supply, capture or revive counters to read instead. See leaderboard.js for
   * what each number actually means.
   */
  route('GET', '/internal/leaderboard', async (_p, _b, url) => {
    // Never more than the samples actually kept, or the label would overstate
    // the data. The window used is returned, and it is what the boards print.
    const days = leaderboardWindow(
      Number(url?.searchParams?.get('days')) || config.leaderboardWindowDays,
      config.sampleRetentionDays);
    const top = Math.min(25, Math.max(1, Number(url?.searchParams?.get('top')) || 5));
    const [{ rows: totals }, { rows: cmd }, { rows: seeded }] = await Promise.all([
      pool.query(TOTALS_SQL, [days]),
      pool.query(COMMANDERS_SQL, [days]),
      pool.query(STARTERS_SQL, [days]),
    ]);
    const players = playerStats(totals, { pollSeconds: Math.round(config.pollIntervalMs / 1000) });
    return {
      ok: true,
      days,
      generatedAt: new Date().toISOString(),
      ...boards(players, commanderStats(cmd), starterStats(seeded), {
        minMinutes: config.leaderboardMinMinutes,
        top,
      }),
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
        // DELETE included: /internal/reserved/:steamId carries {apply}, and
        // without it every revoke would quietly stay a dry run. An empty body
        // reads as {}, so the routes that send nothing are unaffected.
        const body = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) ? await readJson(req) : {};
        const out = await r.handler(params, body, url);
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
