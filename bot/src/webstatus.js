// Live status for the website. Every STATUS_PUSH_MINUTES the bot sends a small public
// summary of the game server (the same things the #server-info board shows) to a
// Cloudflare Worker, which keeps the latest copy and hands it to sixdogs.gg.
// Nothing private goes out: in-game names, kills, team counts, scores, the map, the clock.
// Discord IDs never leave; commanders are shown by in-game name (or Discord display name).

import { summarize } from './liveboard.js';

/** The public JSON. Pure, so tests can check exactly what leaves the PC. */
export function publicStatus(state, { now = Date.now(), commanderOf = () => null, nameOf = () => null, aliases = {}, serverIdOverride = null, notConnected = false } = {}) {
  const base = { v: 1, updatedAt: new Date(now).toISOString() };
  if (notConnected) return { ...base, state: 'not-connected' };
  const s = summarize(state, { now, commanderOf, aliases });
  if (!s.online) {
    return { ...base, state: 'offline', serverName: s.serverName, lastSeenAt: s.lastSeenAt ? new Date(s.lastSeenAt).toISOString() : null };
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
    return publicStatus(state, {
      commanderOf: (key) => this.commanders.state?.[key]?.commanderId ?? null,
      nameOf,
      aliases: this.config.factionAliases,
      serverIdOverride: this.config.gameServerId,
    });
  }

  async push() {
    try {
      const body = JSON.stringify(await this.build());
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
