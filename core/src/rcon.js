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

  /** Does this server build serve e.g. has('POST', '/v1/players/{steamId}/message')? */
  has(method, path) {
    return this.routes?.has(`${method} ${path}`) ?? false;
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
}
