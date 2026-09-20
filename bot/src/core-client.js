// The bot's only connection to anything game-related: the core service.

export class CoreError extends Error {
  constructor(message, code = 'core_error', status = 0) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export class CoreClient {
  constructor({ baseUrl, token, disabled = false }) {
    this.baseUrl = baseUrl;
    this.disabled = disabled;
    Object.defineProperty(this, '_auth', { value: `Bearer ${token}`, enumerable: false });
  }

  async request(method, path, body) {
    if (this.disabled) {
      throw new CoreError("This needs the game server, and SIXDOGS isn't connected to one yet.", 'no_game_server');
    }
    let res;
    try {
      res = await fetch(this.baseUrl + path, {
        method,
        headers: { Authorization: this._auth, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(8000),
      });
    } catch (err) {
      throw new CoreError(`core unreachable (${err.cause?.code || err.message})`, 'unreachable');
    }
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new CoreError(json?.error?.message || `core returned ${res.status}`, json?.error?.code || 'http_error', res.status);
    }
    return json;
  }

  state() { return this.request('GET', '/internal/state'); }
  verifyStart(discordId, name) { return this.request('POST', '/internal/verify/start', { discordId, name }); }
  verifyConfirm(discordId, code) { return this.request('POST', '/internal/verify/confirm', { discordId, code }); }
  linkedIds() { return this.request('GET', '/internal/links').then((r) => r.discordIds); }
  getLink(discordId) { return this.request('GET', `/internal/links/${discordId}`); }
  unlink(discordId) { return this.request('DELETE', `/internal/links/${discordId}`); }
  adminLink(discordId, steamId) { return this.request('POST', '/internal/links', { discordId, steamId }); }
  message(steamId, message) { return this.request('POST', '/internal/message', { steamId, message }); }
  matchCommanders(matchId) { return this.request('GET', `/internal/matches/${matchId}/commanders`); }
  matchParticipants(matchId) { return this.request('GET', `/internal/matches/${matchId}/participants`); }
  ratingPlan(matchId, body) { return this.request('POST', `/internal/matches/${matchId}/rating-plan`, body); }
  openRatingRound(body) { return this.request('POST', '/internal/ratings/rounds', body); }
  rateVote(roundId, voterId, value) { return this.request('POST', '/internal/ratings/votes', { roundId, voterId, value }); }
  ratingScores() { return this.request('GET', '/internal/ratings/scores'); }
  ratingsDue() { return this.request('GET', '/internal/ratings/due'); }
  ratingNotified(roundId) { return this.request('POST', `/internal/ratings/rounds/${roundId}/notified`, {}); }
  commanderLog(matchId, faction, discordId, event) {
    return this.request('POST', '/internal/commander-log', { matchId, faction, discordId, event }).catch(() => {});
  }
}
