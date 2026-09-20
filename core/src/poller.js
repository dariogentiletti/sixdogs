// The foundation. The API only answers about *right now*, so every few seconds
// we ask, and write the answer down. Everything else reads what this wrote.

import { detectNewMatch, inferClockDirection } from './match.js';

const STALE_GAP_MS = 15 * 60 * 1000; // a gap this long means we can't trust continuity

export class Poller {
  constructor({ rcon, pool, config, log = console }) {
    this.rcon = rcon;
    this.pool = pool;
    this.config = config;
    this.log = log;
    this.timer = null;
    this.stopped = false;
    this.lastHealthCheck = 0;
    this.lastPrune = 0;
    this.state = {
      ok: false,
      lastPollAt: null,
      lastSuccessAt: null,
      lastError: null,
      status: null,
      players: [],
      matchId: null,
      matchStartedAt: null,
      matchReason: null,
      clockDirection: null,
      serverId: null,
      pollIntervalMs: config.pollIntervalMs,
      backpressure: false,
    };
    this.listeners = new Set();
  }

  onPoll(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  async init() {
    // Resume the open match (if any) so a core restart mid-match doesn't
    // start a fresh match_id.
    const { rows } = await this.pool.query(`
      SELECT m.id, m.started_at, m.start_reason, s.status, s.polled_at
        FROM matches m
        LEFT JOIN LATERAL (
          SELECT status, polled_at FROM status_samples
           WHERE match_id = m.id ORDER BY id DESC LIMIT 1
        ) s ON true
       WHERE m.ended_at IS NULL
       ORDER BY m.id DESC LIMIT 1`);
    if (rows[0]) {
      this.state.matchId = Number(rows[0].id);
      this.state.matchStartedAt = rows[0].started_at;
      this.state.matchReason = rows[0].start_reason;
      this.prevStatus = rows[0].status;
      this.prevPolledAt = rows[0].polled_at ? new Date(rows[0].polled_at).getTime() : 0;
      this.log.log(`[poller] resuming open match #${this.state.matchId}`);
    }
  }

  start() {
    const tick = async () => {
      if (this.stopped) return;
      await this.pollOnce();
      if (!this.stopped) this.timer = setTimeout(tick, this.state.pollIntervalMs);
    };
    tick();
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
  }

  async pollOnce() {
    const now = Date.now();
    this.state.lastPollAt = new Date(now).toISOString();
    let status, players;
    try {
      [status, players] = await Promise.all([this.rcon.status(), this.rcon.players()]);
    } catch (err) {
      if (this.state.ok || this.state.lastError !== err.message) {
        this.log.warn(`[poller] poll failed: ${err.message}`);
      }
      this.state.ok = false;
      this.state.lastError = err.message;
      return;
    }

    try {
      await this.record(status, players, now);
      this.state.ok = true;
      this.state.lastError = null;
      this.state.lastSuccessAt = new Date(now).toISOString();
      this.state.status = status;
      this.state.players = players;
    } catch (err) {
      this.log.error(`[poller] failed to record poll: ${err.message}`);
      this.state.ok = false;
      this.state.lastError = `database: ${err.message}`;
      return;
    }

    for (const fn of this.listeners) {
      try { fn(this.state); } catch (err) { this.log.error('[poller] listener error:', err); }
    }

    await this.maybeCheckHealth(now);
    await this.maybePrune(now);
  }

  async record(status, players, now) {
    const prev = this.prevStatus;
    const elapsedSec = this.prevPolledAt ? (now - this.prevPolledAt) / 1000 : 0;
    this.state.clockDirection = inferClockDirection(
      prev?.matchSeconds, status?.matchSeconds, elapsedSec, this.state.clockDirection,
    );

    let reason = null;
    if (!this.state.matchId) reason = 'first-sample';
    else if (this.prevPolledAt && now - this.prevPolledAt > STALE_GAP_MS) reason = 'long gap in polling';
    else reason = detectNewMatch(prev, status, { clockDirection: this.state.clockDirection });

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      if (reason) {
        if (this.state.matchId) {
          await client.query(
            'UPDATE matches SET ended_at = now(), final_status = $2 WHERE id = $1 AND ended_at IS NULL',
            [this.state.matchId, prev ?? null],
          );
        }
        const { rows } = await client.query(
          'INSERT INTO matches (map, start_reason) VALUES ($1, $2) RETURNING id, started_at',
          [status?.map ?? null, reason],
        );
        this.state.matchId = Number(rows[0].id);
        this.state.matchStartedAt = rows[0].started_at;
        this.state.matchReason = reason;
        this.log.log(`[poller] match #${this.state.matchId} started (${reason})`);
      }

      const { rows: [sample] } = await client.query(
        'INSERT INTO status_samples (match_id, status) VALUES ($1, $2) RETURNING id',
        [this.state.matchId, status],
      );

      if (players.length) {
        await client.query(
          `INSERT INTO player_samples (sample_id, match_id, steam_id, name, faction, kills, deaths, cash, ping_ms)
           SELECT $1, $2, * FROM unnest($3::text[], $4::text[], $5::text[], $6::int[], $7::int[], $8::bigint[], $9::int[])`,
          [
            sample.id, this.state.matchId,
            players.map((p) => String(p.steamId)),
            players.map((p) => String(p.name ?? '')),
            players.map((p) => p.faction ?? null),
            players.map((p) => p.kills ?? null),
            players.map((p) => p.deaths ?? null),
            players.map((p) => p.cash ?? null),
            players.map((p) => p.pingMs ?? null),
          ],
        );
        await client.query(
          `INSERT INTO players (steam_id, last_name)
           SELECT * FROM unnest($1::text[], $2::text[])
           ON CONFLICT (steam_id) DO UPDATE SET last_name = EXCLUDED.last_name, last_seen = now()`,
          [players.map((p) => String(p.steamId)), players.map((p) => String(p.name ?? ''))],
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }

    this.prevStatus = status;
    this.prevPolledAt = now;
  }

  async maybeCheckHealth(now) {
    if (now - this.lastHealthCheck < this.config.healthCheckEveryMs) return;
    this.lastHealthCheck = now;
    try {
      const h = await this.rcon.health();
      const depth = h?.gameThreadQueue?.depth ?? 0;
      const busy = depth > this.config.backpressureDepth;
      if (busy !== this.state.backpressure) {
        this.log.warn(busy
          ? `[poller] game thread queue depth ${depth} — slowing polls to ${this.config.slowPollIntervalMs}ms`
          : '[poller] game thread queue recovered — normal polling');
      }
      this.state.backpressure = busy;
      this.state.pollIntervalMs = busy ? this.config.slowPollIntervalMs : this.config.pollIntervalMs;
    } catch (err) {
      this.log.warn(`[poller] health check failed: ${err.message}`);
    }
  }

  async maybePrune(now) {
    if (now - this.lastPrune < 6 * 60 * 60 * 1000) return;
    this.lastPrune = now;
    try {
      const { rowCount } = await this.pool.query(
        `DELETE FROM status_samples WHERE polled_at < now() - make_interval(days => $1)`,
        [this.config.sampleRetentionDays],
      );
      if (rowCount) this.log.log(`[poller] pruned ${rowCount} old samples`);
    } catch (err) {
      this.log.warn(`[poller] prune failed: ${err.message}`);
    }
  }
}
