// Live status for the website. Every STATUS_PUSH_MINUTES the bot sends a small public
// summary of the game server (the same things the #server-info board shows) to a
// Cloudflare Worker, which keeps the latest copy and hands it to sixdogs.gg.
// Nothing private goes out: in-game names, kills, team counts, scores, the map, the clock.
// Discord IDs never leave; commanders are shown by in-game name (or Discord display name).
//
// The leaderboard rides along in the same push, so there is one endpoint, one
// token and one thing that can be stale. It is history rather than live, so it
// is still sent while the game server is down — that is exactly when somebody
// looking at the site has time to read it.

import { summarize } from './liveboard.js';
import { publicLeaderboard } from './leaderboard.js';

/** The public JSON. Pure, so tests can check exactly what leaves the PC. */
export function publicStatus(state, { now = Date.now(), commanderOf = () => null, nameOf = () => null, aliases = {}, serverIdOverride = null, notConnected = false, leaderboard = null } = {}) {
  const base = { v: 1, updatedAt: new Date(now).toISOString() };
  if (notConnected) return { ...base, state: 'not-connected' };
  const board = publicLeaderboard(leaderboard, { nameOf });
  const s = summarize(state, { now, commanderOf, aliases });
  if (!s.online) {
    return {
      ...base,
      state: 'offline',
      serverName: s.serverName,
      lastSeenAt: s.lastSeenAt ? new Date(s.lastSeenAt).toISOString() : null,
      leaderboard: board,
    };
  }
  const iso = (ms) => (ms ? new Date(ms).toISOString() : null);
  return {
    ...base,
    state: 'live',
    serverName: s.serverName,
    serverId: serverIdOverride || s.serverId,
    map: s.map,
    matchId: s.matchId,
    endsAt: iso(s.endsAt),
    startedAt: iso(s.startedAt),
    // False when the clock is only "when the bot noticed" and nobody is on.
    showClock: s.showClock,
    scoreCap: s.scoreCap,
    players: { current: s.current, max: s.max },
    teams: s.teams.map((t) => ({
      key: t.key, label: t.label, players: t.players, score: t.score,
      commander: t.commanderId ? (nameOf(t.commanderId) || 'Picked') : null,
    })),
    top: s.top.map((p) => ({ name: p.name, kills: p.kills })),
    lead: s.lead ? { key: s.lead.team.key, by: s.lead.by } : null,
    leaderboard: board,
  };
}

export class WebStatus {
  constructor({ core, commanders, config, fetchImpl = globalThis.fetch }) {
    this.core = core;
    this.commanders = commanders;
    this.config = config;
    this.fetch = fetchImpl;
    this.guild = null;
    this.timer = null;
    this.lastError = null;
    this.lastBoardError = null;
  }

  get enabled() { return !!(this.config.statusPushUrl && this.config.statusPushToken); }

  start(guild) {
    this.guild = guild;
    if (!this.enabled) return;
    this.push();
    this.timer = setInterval(() => this.push(), this.config.statusPushMinutes * 60_000);
    this.timer.unref?.();
    console.log(`[web] sending live status to ${this.config.statusPushUrl} every ${this.config.statusPushMinutes} min`);
  }

  stop() { clearInterval(this.timer); }

  async build() {
    if (this.config.coreDisabled) return publicStatus(null, { notConnected: true });
    let state;
    try { state = await this.core.state(); } catch { state = { ok: false }; }
    const players = Array.isArray(state?.players) ? state.players : [];
    const nameOf = (discordId) =>
      players.find((p) => p.discordId === discordId)?.name
      ?? this.guild?.members.cache.get(discordId)?.displayName
      ?? null;
    // The leaderboard is a nice-to-have on this payload: if core can't answer,
    // the live board still goes out rather than the whole push failing.
    let leaderboard = null;
    try { leaderboard = await this.core.leaderboard({ days: this.config.leaderboardDays }); }
    catch (err) { this.boardWarn(err.message); }
    return publicStatus(state, {
      commanderOf: (key) => this.commanders.state?.[key]?.commanderId ?? null,
      nameOf,
      aliases: this.config.factionAliases,
      serverIdOverride: this.config.gameServerId,
      leaderboard,
    });
  }

  boardWarn(message) {
    if (this.lastBoardError === message) return;
    this.lastBoardError = message;
    console.warn(`[web] sending the live board without the leaderboard: ${message}`);
  }

  async push() {
    try {
      const status = await this.build();
      let body = JSON.stringify(status);
      // The Worker refuses anything over 20000 characters. Dropping the
      // leaderboard is far better than the live board silently going stale.
      if (body.length > 19_000 && status.leaderboard) {
        this.boardWarn(`the payload came to ${body.length} characters`);
        body = JSON.stringify({ ...status, leaderboard: null });
      }
      const res = await this.fetch(this.config.statusPushUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.config.statusPushToken}` },
        body,
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (this.lastError) console.log('[web] live status is going through again');
      this.lastError = null;
    } catch (err) {
      if (this.lastError !== err.message) console.warn(`[web] couldn't send live status: ${err.message}`);
      this.lastError = err.message;
    }
  }
}
