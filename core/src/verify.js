// /verify flow: Discord user names their in-game character -> we find the
// SteamID in the live player list -> whisper them a short numeric code in-game ->
// they paste it back in Discord -> links row.

import { randomInt } from 'node:crypto';

const RESEND_COOLDOWN_SEC = 60;
// Lowered from 5 when the code went from six digits to three. A short code is
// only safe if guessing is expensive: with 3 digits and 3 tries per code, an
// attacker needs roughly 230 rounds for an even chance, each one costing a
// 60s wait and sending the victim another whisper they did not ask for.
const MAX_ATTEMPTS = 3;

export class VerifyError extends Error {
  constructor(message, code = 'verify_error') {
    super(message);
    this.code = code;
  }
}

/** Find a single online player by in-game name. Exact (case-insensitive) first, then unique partial. */
/** A SteamID64 on its own, or inside a steamcommunity.com/profiles/<id> link. */
export function steamIdFrom(raw) {
  const m = /(?:^|profiles\/)(7656\d{13})(?:\/|$)/.exec(String(raw ?? '').trim());
  return m ? m[1] : null;
}

/**
 * Find a single online player by in-game name or SteamID.
 * SteamID (or profile link) first, then exact name (case-insensitive), then a unique partial match.
 */
export function findPlayerByName(players, rawName) {
  const steamId = steamIdFrom(rawName);
  if (steamId) {
    const p = players.find((x) => String(x.steamId) === steamId);
    return p ? { player: p } : { error: "That Steam account isn't on the server right now. Join first, then run /verify while you're in-game." };
  }
  const name = String(rawName ?? '').trim().toLowerCase();
  if (!name) return { error: 'Give me your in-game name exactly as it appears on the scoreboard.' };
  const exact = players.filter((p) => String(p.name ?? '').trim().toLowerCase() === name);
  if (exact.length === 1) return { player: exact[0] };
  if (exact.length > 1) {
    return { error: 'Two or more people on the server have that exact name. Run /verify again with your Steam profile link (the one with the long number, like steamcommunity.com/profiles/7656...) or your SteamID instead.' };
  }
  const partial = players.filter((p) => String(p.name ?? '').toLowerCase().includes(name));
  if (partial.length === 1) return { player: partial[0] };
  if (partial.length > 1) {
    const names = partial.slice(0, 5).map((p) => `"${p.name}"`).join(', ');
    return { error: `That matches several players (${names}). Type your full name.` };
  }
  return { error: "I can't see anyone with that name on the server right now. Join the server first, then run /verify while you're in-game." };
}

export class Verifier {
  constructor({ pool, rcon, poller, ttlSec, codeDigits = 3 }) {
    this.pool = pool;
    this.rcon = rcon;
    this.poller = poller;
    this.ttlSec = ttlSec;
    // How long the in-game code is. Short is friendlier to type; see
    // MAX_ATTEMPTS above for why the two have to move together.
    this.codeDigits = Math.min(10, Math.max(3, Number(codeDigits) || 3));
  }

  async start(discordId, name) {
    const existing = await this.pool.query(
      'SELECT l.steam_id, p.last_name FROM links l LEFT JOIN players p USING (steam_id) WHERE l.discord_id = $1',
      [discordId],
    );
    if (existing.rows[0]) {
      throw new VerifyError(
        `You're already linked to "${existing.rows[0].last_name ?? existing.rows[0].steam_id}". Use /unlink first if you want to change it.`,
        'already_linked',
      );
    }

    if (!this.poller.state.ok) {
      throw new VerifyError("I can't reach the game server right now, so I can't check who's online. Try again in a few minutes.", 'server_unreachable');
    }

    const { player, error } = findPlayerByName(this.poller.state.players, name);
    if (error) throw new VerifyError(error, 'not_found');
    const steamId = String(player.steamId);

    const taken = await this.pool.query('SELECT discord_id FROM links WHERE steam_id = $1', [steamId]);
    if (taken.rows[0]) {
      throw new VerifyError('That in-game account is already linked to a different Discord account. Ask an admin if that is wrong.', 'steam_taken');
    }

    const pending = await this.pool.query(
      `SELECT extract(epoch FROM now() - created_at) AS age FROM verify_codes WHERE discord_id = $1`,
      [discordId],
    );
    if (pending.rows[0] && Number(pending.rows[0].age) < RESEND_COOLDOWN_SEC) {
      const wait = Math.ceil(RESEND_COOLDOWN_SEC - Number(pending.rows[0].age));
      throw new VerifyError(`I just sent you a code. Check your in-game messages, or try again in ${wait}s.`, 'cooldown');
    }

    const digits = this.codeDigits;
    const code = String(randomInt(0, 10 ** digits)).padStart(digits, '0');
    // Send first: if the whisper fails we don't want a code sitting in the DB.
    await this.rcon.message(steamId, `SIXDOGS verification code: ${code}. Type /confirm ${code} in Discord. Didn't ask for this? Ignore it.`);

    await this.pool.query(
      `INSERT INTO verify_codes (discord_id, steam_id, code, expires_at)
       VALUES ($1, $2, $3, now() + make_interval(secs => $4))
       ON CONFLICT (discord_id) DO UPDATE
         SET steam_id = EXCLUDED.steam_id, code = EXCLUDED.code, expires_at = EXCLUDED.expires_at,
             attempts = 0, created_at = now()`,
      [discordId, steamId, code, this.ttlSec],
    );
    return { steamId, name: player.name, expiresInSec: this.ttlSec, digits };
  }

  async confirm(discordId, rawCode) {
    const code = String(rawCode ?? '').replace(/\D/g, '');
    const { rows } = await this.pool.query(
      'SELECT steam_id, code, attempts, expires_at < now() AS expired FROM verify_codes WHERE discord_id = $1',
      [discordId],
    );
    const row = rows[0];
    if (!row) throw new VerifyError('No verification in progress. Start with /verify <your in-game name>.', 'no_pending');
    if (row.expired) {
      await this.pool.query('DELETE FROM verify_codes WHERE discord_id = $1', [discordId]);
      throw new VerifyError('That code has expired. Run /verify again.', 'expired');
    }
    if (row.attempts >= MAX_ATTEMPTS) {
      await this.pool.query('DELETE FROM verify_codes WHERE discord_id = $1', [discordId]);
      throw new VerifyError('Too many wrong codes. Run /verify again for a fresh one.', 'too_many_attempts');
    }
    if (code !== row.code) {
      await this.pool.query('UPDATE verify_codes SET attempts = attempts + 1 WHERE discord_id = $1', [discordId]);
      throw new VerifyError("That code doesn't match. Check the in-game message and try again.", 'wrong_code');
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        'INSERT INTO links (discord_id, steam_id) VALUES ($1, $2)',
        [discordId, row.steam_id],
      );
      await client.query('DELETE FROM verify_codes WHERE discord_id = $1', [discordId]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      if (err.code === '23505') throw new VerifyError('That account was linked by someone else in the meantime. Ask an admin.', 'steam_taken');
      throw err;
    } finally {
      client.release();
    }
    const { rows: [p] } = await this.pool.query('SELECT last_name FROM players WHERE steam_id = $1', [row.steam_id]);
    return { steamId: row.steam_id, name: p?.last_name ?? null };
  }
}
