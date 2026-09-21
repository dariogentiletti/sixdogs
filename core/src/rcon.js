// Thin client for the WARDOGS RCON HTTP API (/v1).
// Rules (see CLAUDE.md): plain HTTP, bearer token is the full-access password
// and is never logged, feature-detect with GET /v1/capabilities.

export class RconError extends Error {
  constructor(message, { status = 0, code = 'rcon_error' } = {}) {
    super(message);
    this.name = 'RconError';
    this.status = status;
    this.code = code;
  }
}

/** "POST /v1/players/{steamId}/message" -> "POST /v1/players/{}/message" */
function normalizeRoute(route) {
  return String(route)
    .trim()
    .replace(/\{[^}]*\}/g, '{}')              // {steamId}, {steam_id}, {id}
    .replace(/:[A-Za-z_][A-Za-z0-9_]*/g, '{}') // :steamId
    .replace(/\s+/g, ' ');
}

export class RconClient {
  constructor({ baseUrl, password, timeoutMs = 4000 }) {
    this.baseUrl = baseUrl;
    // Keep the password off `this` enumerable props so it never shows up in a
    // console.log(client) by accident.
    Object.defineProperty(this, '_auth', { value: `Bearer ${password}`, enumerable: false });
    this.timeoutMs = timeoutMs;
    this.routes = null; // Set of "METHOD /path" strings once capabilities are loaded
    this.capabilities = null;
  }

  async request(method, path, body) {
    const headers = { Authorization: this._auth, Accept: 'application/json' };
    let payload;
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    let res;
    try {
      res = await fetch(this.baseUrl + path, {
        method,
        headers,
        body: payload,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      const why = err.name === 'TimeoutError' ? 'timed out' : err.cause?.code || err.message;
      throw new RconError(`${method} ${path} failed: ${why}`, { code: 'unreachable' });
    }
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON body */ }
    if (!res.ok) {
      const msg = json?.error?.message || json?.message || text.slice(0, 200) || res.statusText;
      const code = json?.error?.code || (res.status === 401 || res.status === 403 ? 'auth' : 'http_error');
      throw new RconError(`${method} ${path} -> ${res.status}: ${msg}`, { status: res.status, code });
    }
    return json;
  }

  async loadCapabilities() {
    this.capabilities = await this.request('GET', '/v1/capabilities');
    this.routes = new Set(this.capabilities?.routes ?? []);
    return this.capabilities;
  }

  /**
   * Does this server build serve e.g. has('POST', '/v1/players/{steamId}/message')?
   *
   * Compared loosely on purpose. /v1/capabilities lists routes as text, and a
   * build is free to name its path parameters whatever it likes:
   * {steamId}, {steam_id}, {id} and :steamId all mean the same route. Matching
   * the string exactly would report a route as missing because of its spelling,
   * which is far worse than the reverse: a route we wrongly think exists just
   * fails once with the game's own error.
   */
  has(method, path) {
    if (!this.routes) return false;
    const want = `${method} ${path}`;
    if (this.routes.has(want)) return true;
    const wanted = normalizeRoute(want);
    for (const r of this.routes) {
      if (normalizeRoute(r) === wanted) return true;
    }
    return false;
  }

  status() { return this.request('GET', '/v1/status'); }
  async players() {
    const r = await this.request('GET', '/v1/players');
    return Array.isArray(r?.players) ? r.players : [];
  }
  health() { return this.request('GET', '/v1/health'); }
  serverId() { return this.request('GET', '/v1/server-id'); }

  message(steamId, message) {
    if (!this.has('POST', '/v1/players/{steamId}/message')) {
      throw new RconError('This server build does not support private player messages.', { code: 'unsupported' });
    }
    return this.request('POST', `/v1/players/${encodeURIComponent(steamId)}/message`, { message });
  }

  broadcast(message) {
    if (!this.has('POST', '/v1/broadcast')) {
      throw new RconError('This server build does not support broadcasts.', { code: 'unsupported' });
    }
    return this.request('POST', '/v1/broadcast', { message });
  }

  // ---- actions that change the game ----
  // Each one is gated on /v1/capabilities rather than on catching a 404, so an
  // older build fails with a sentence we can show an admin instead of a stack
  // trace. See CLAUDE.md.

  kick(steamId, reason) {
    if (!this.has('POST', '/v1/players/{steamId}/kick')) {
      throw new RconError('This server build cannot kick players.', { code: 'unsupported' });
    }
    return this.request('POST', `/v1/players/${encodeURIComponent(steamId)}/kick`, { reason });
  }

  /**
   * Move a player to another faction.
   *
   * `faction` is the server's OWN faction string, exactly as it appears in
   * /v1/players and in /v1/status factionScores[].name. It is NOT a SIXDOGS
   * colour key: the game has never heard of blue/red/green. The bot resolves
   * the colour to the server's own name before calling this, so that nothing
   * here has to invent a faction string.
   */
  setFaction(steamId, faction) {
    if (!this.has('PATCH', '/v1/players/{steamId}')) {
      throw new RconError('This server build cannot move players between factions.', { code: 'unsupported' });
    }
    return this.request('PATCH', `/v1/players/${encodeURIComponent(steamId)}`, { faction });
  }

  endMatch() {
    if (!this.has('POST', '/v1/match/end')) {
      throw new RconError('This server build cannot end the match.', { code: 'unsupported' });
    }
    return this.request('POST', '/v1/match/end');
  }

  // ---- server settings ----
  // The config is one plain-text document (ServerSettings.ini style), not JSON.
  // Reading is safe; writing replaces the WHOLE document and is not done here
  // yet. See CLAUDE.md before adding it.

  /** What /v1/capabilities says about the config document, if anything. */
  configInfo() {
    const c = this.capabilities?.config ?? {};
    return {
      readable: this.has('GET', '/v1/config'),
      writable: c.writable === true && this.has('PUT', '/v1/config'),
      validatable: this.has('POST', '/v1/config/validate'),
      document: c.document ?? null,
    };
  }

  /** @returns {Promise<{revision, writable, text, sections, warnings}>} */
  getConfig() {
    if (!this.has('GET', '/v1/config')) {
      throw new RconError('This server build does not expose its settings.', { code: 'unsupported' });
    }
    return this.request('GET', '/v1/config');
  }

  /** Which of the things SIXDOGS knows how to do this build actually serves. */
  supportedActions() {
    return {
      message: this.has('POST', '/v1/players/{steamId}/message'),
      broadcast: this.has('POST', '/v1/broadcast'),
      kick: this.has('POST', '/v1/players/{steamId}/kick'),
      move: this.has('PATCH', '/v1/players/{steamId}'),
      endMatch: this.has('POST', '/v1/match/end'),
    };
  }
}
