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

  /**
   * `body` as an object is sent as JSON, as a string it is sent as-is. The
   * settings document is plain text, not JSON wrapping text, so /v1/config and
   * /v1/config/validate need the string form.
   */
  async request(method, path, body, { headers: extra = {}, contentType } = {}) {
    const headers = { Authorization: this._auth, Accept: 'application/json', ...extra };
    let payload;
    if (body !== undefined) {
      const isText = typeof body === 'string';
      headers['Content-Type'] = contentType ?? (isText ? 'text/plain; charset=utf-8' : 'application/json');
      payload = isText ? body : JSON.stringify(body);
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
      // fetch hides the real reason in `cause`: a code for a refused or unknown
      // address, a list of them when a name has several addresses, or only a
      // message ("bad port") when it refused to try at all.
      const why = err.name === 'TimeoutError' ? 'timed out'
        : err.cause?.code || err.cause?.errors?.find((x) => x?.code)?.code || err.cause?.message || err.message;
      const e = new RconError(`${method} ${path} failed: ${why}`, { code: 'unreachable' });
      // ECONNREFUSED and a timeout need different fixes (the server is up but
      // RCON is off, versus nothing there at all), so keep which one it was.
      e.reason = why;
      throw e;
    }
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON body */ }
    if (!res.ok) {
      const msg = json?.error?.message || json?.message || text.slice(0, 200) || res.statusText;
      const code = json?.error?.code || (res.status === 401 || res.status === 403 ? 'auth' : 'http_error');
      const err = new RconError(`${method} ${path} -> ${res.status}: ${msg}`, { status: res.status, code });
      // Config refusals carry errors[{section,key,code,message}] naming the key
      // at fault, which is the only way to tell "your change is wrong" apart
      // from "something already in this document is wrong". Keep them.
      if (Array.isArray(json?.errors)) err.errors = json.errors;
      throw err;
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

  kill(steamId) {
    if (!this.has('POST', '/v1/players/{steamId}/kill')) {
      throw new RconError('This server build cannot kill players.', { code: 'unsupported' });
    }
    return this.request('POST', `/v1/players/${encodeURIComponent(steamId)}/kill`);
  }

  restartMatch() {
    if (!this.has('POST', '/v1/match/restart')) {
      throw new RconError('This server build cannot restart the match.', { code: 'unsupported' });
    }
    return this.request('POST', '/v1/match/restart');
  }

  /**
   * Change the map. Only `map` is required; the rest are left out entirely when
   * not given, so the server keeps whatever it was using rather than being sent
   * a null it has to interpret.
   */
  setMap({ map, experiences, lighting, zoneAlternator } = {}) {
    if (!this.has('POST', '/v1/match/map')) {
      throw new RconError('This server build cannot change the map.', { code: 'unsupported' });
    }
    const body = { map };
    if (Array.isArray(experiences) && experiences.length) body.experiences = experiences;
    if (lighting) body.lighting = lighting;
    if (zoneAlternator) body.zoneAlternator = zoneAlternator;
    return this.request('POST', '/v1/match/map', body);
  }

  setLighting(lighting) {
    if (!this.has('PUT', '/v1/world/lighting')) {
      throw new RconError('This server build cannot change the lighting.', { code: 'unsupported' });
    }
    return this.request('PUT', '/v1/world/lighting', { lighting });
  }

  // ---- bans ----

  async bans() {
    if (!this.has('GET', '/v1/bans')) {
      throw new RconError('This server build does not keep a ban list.', { code: 'unsupported' });
    }
    const r = await this.request('GET', '/v1/bans');
    return Array.isArray(r) ? r : (r?.bans ?? []);
  }

  ban(steamId, reason) {
    if (!this.has('POST', '/v1/bans')) {
      throw new RconError('This server build cannot ban players.', { code: 'unsupported' });
    }
    return this.request('POST', '/v1/bans', { steamId, reason });
  }

  unban(steamId) {
    if (!this.has('DELETE', '/v1/bans/{steamId}')) {
      throw new RconError('This server build cannot lift bans.', { code: 'unsupported' });
    }
    return this.request('DELETE', `/v1/bans/${encodeURIComponent(steamId)}`);
  }

  // ---- what the server offers ----

  /** kind: 'maps' | 'lightings' | 'experiences' */
  async catalog(kind) {
    const path = `/v1/catalog/${kind}`;
    if (!this.has('GET', path)) {
      throw new RconError(`This server build does not list its ${kind}.`, { code: 'unsupported' });
    }
    const r = await this.request('GET', path);
    // Builds differ on whether this is a bare array or wrapped under the name.
    return Array.isArray(r) ? r : (r?.[kind] ?? r?.items ?? []);
  }

  rotation() {
    if (!this.has('GET', '/v1/rotation')) {
      throw new RconError('This server build does not expose its rotation.', { code: 'unsupported' });
    }
    return this.request('GET', '/v1/rotation');
  }

  async audit(limit = 20) {
    if (!this.has('GET', '/v1/audit')) {
      throw new RconError('This server build does not keep an audit log.', { code: 'unsupported' });
    }
    const n = Math.min(500, Math.max(1, Number(limit) || 20));
    const r = await this.request('GET', `/v1/audit?limit=${n}`);
    return Array.isArray(r) ? r : (r?.entries ?? r?.audit ?? []);
  }

  /**
   * Who holds a reserved slot. Read only: the live build advertises
   * GET /v1/reserved-slots and nothing to write it, so granting a slot means
   * editing the settings document instead.
   */
  async reservedSlots() {
    if (!this.has('GET', '/v1/reserved-slots')) {
      throw new RconError('This server build does not expose its reserved slots.', { code: 'unsupported' });
    }
    const r = await this.request('GET', '/v1/reserved-slots');
    // Builds differ on the wrapper; take whichever list is there.
    const list = Array.isArray(r) ? r : (r?.slots ?? r?.reservedSlots ?? r?.entries ?? r?.players ?? []);
    return { list: Array.isArray(list) ? list : [], raw: r };
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

  /**
   * Ask the server whether a document would be accepted, WITHOUT saving it.
   * Always run before a write: a refusal here costs nothing, a refusal after a
   * write is a live server in a state nobody chose.
   */
  validateConfig(text) {
    if (!this.has('POST', '/v1/config/validate')) {
      throw new RconError('This server build cannot check settings before saving them.', { code: 'unsupported' });
    }
    return this.request('POST', '/v1/config/validate', String(text));
  }

  /**
   * Replace the settings document. The whole document: whatever goes in here is
   * what the server becomes.
   *
   * `If-Match` is the safety catch. If anyone changed the settings since the
   * revision this text was built from, the server answers 412 and nothing is
   * written, instead of this quietly undoing their change.
   */
  writeConfig(text, revision) {
    const info = this.configInfo();
    if (!info.writable) {
      throw new RconError('This server build does not allow its settings to be changed.', { code: 'unsupported' });
    }
    if (!revision) {
      throw new RconError('Refusing to save settings without the revision they were read at.', { code: 'no_revision' });
    }
    return this.request('PUT', '/v1/config', String(text), { headers: { 'If-Match': `"${revision}"` } });
  }

  /** Which of the things SIXDOGS knows how to do this build actually serves. */
  supportedActions() {
    return {
      message: this.has('POST', '/v1/players/{steamId}/message'),
      broadcast: this.has('POST', '/v1/broadcast'),
      kick: this.has('POST', '/v1/players/{steamId}/kick'),
      move: this.has('PATCH', '/v1/players/{steamId}'),
      endMatch: this.has('POST', '/v1/match/end'),
      kill: this.has('POST', '/v1/players/{steamId}/kill'),
      restart: this.has('POST', '/v1/match/restart'),
      changeMap: this.has('POST', '/v1/match/map'),
      lighting: this.has('PUT', '/v1/world/lighting'),
      ban: this.has('POST', '/v1/bans'),
      audit: this.has('GET', '/v1/audit'),
    };
  }
}
