// A fake WARDOGS RCON server for testing SIXDOGS without renting anything.
// Serves the same /v1 routes core uses, with made-up players.
//
//   node mock/mock-wardogs.mjs            (listens on :7776, password "test")
//
// Control endpoints (no auth, mock only):
//   GET  /mock/messages                 -> private messages core has sent (read verification codes here)
//   POST /mock/join     {name, steamId, faction}
//   POST /mock/leave    {steamId}
//   POST /mock/faction  {steamId, faction}
//   POST /mock/new-match                -> resets clock, reshuffles factions

import http from 'node:http';

if (process.env.SIXDOGS_SUPERVISED === '1') {
  process.stdin.on('end', () => process.exit(0));
  process.stdin.resume();
}

const PORT = Number(process.env.MOCK_PORT ?? 7776);
const PASSWORD = process.env.MOCK_PASSWORD ?? 'test';
// In-game names; the bot shows them as Blue / Red / Green (from colorHex below).
const FACTIONS = ['Lonestar', 'Valkyra', 'Manticore'];
const FACTION_COLORS = ['#2f6fd6', '#d13b3b', '#3aa655'];

let matchStart = Date.now();
let map = 'Harbor';
let lighting = 'Day';
let rotationIndex = 0;
const messages = [];
const players = new Map();

function add(name, steamId, faction) {
  players.set(steamId, { name, steamId, faction, kills: 0, deaths: 0, cash: 1000, pingMs: 40 + Math.floor(Math.random() * 40) });
}
['Rook', 'Vex', 'Mako', 'Juno', 'Tally', 'Birch', 'Cato', 'Pike', 'Wren'].forEach((n, i) =>
  add(n, String(76561198000000000n + BigInt(i + 1)), FACTIONS[i % 3]));

const json = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
};

// Set MOCK_NO_ACTIONS=1 to pretend to be an older build that only reads, so the
// capability gating in core can be exercised.
const ROUTES = [
  'GET /v1/capabilities', 'GET /v1/status', 'GET /v1/players', 'GET /v1/health', 'GET /v1/server-id',
  'POST /v1/players/{steamId}/message', 'POST /v1/broadcast',
  'GET /v1/config',
  ...(process.env.MOCK_NO_ACTIONS === '1' ? [] : [
    'POST /v1/players/{steamId}/kick',
    'PATCH /v1/players/{steamId}',
    'POST /v1/match/end',
    'POST /v1/match/restart',
    'POST /v1/match/map',
    'PUT /v1/world/lighting',
    'POST /v1/players/{id}/kill',
    'GET /v1/bans', 'POST /v1/bans', 'DELETE /v1/bans/{steamId}',
    'GET /v1/catalog/maps', 'GET /v1/catalog/lightings', 'GET /v1/catalog/experiences',
    'GET /v1/rotation', 'GET /v1/audit',
  ]),
];

// Resets the clock, moves the rotation on and reshuffles everyone. Used by the
// control page and by RCON's POST /v1/match/end.
function newMatch() {
  matchStart = Date.now();
  rotationIndex++;
  const list = [...players.values()].sort(() => Math.random() - 0.5);
  list.forEach((pl, i) => { pl.faction = FACTIONS[i % 3]; pl.kills = 0; pl.deaths = 0; });
  console.log('[mock] new match started, factions reshuffled');
}

const CONFIG_TEXT = `; SIXDOGS mock server settings
[/Script/Wardogs.ServerSettings]
ServerName=SIXDOGS | Command net in Discord (MOCK)
MaxPlayers=99
bKillCam=False
bReducedHUD=True
bFirstPersonVehicles=True
bDestruction=True

[/Script/Wardogs.MapRotation]
bEnabled=True
!Maps=ClearArray
.Maps=Harbor
.Maps=Ridge
.Maps=Foundry
`;
let configRevision = 7;
const MAPS = ['Harbor', 'Ridge', 'Foundry', 'Delta'];
const LIGHTINGS = ['Day', 'Dusk', 'Night'];
const EXPERIENCES = ['Assault', 'Domination'];
const bans = new Map();
const auditLog = [];
const note = (action, detail) => auditLog.unshift({ at: new Date().toISOString(), action, detail });

async function body(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const text = Buffer.concat(chunks).toString();
  return text ? JSON.parse(text) : {};
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://mock');
  const p = url.pathname;

  // Friendly control page: open http://localhost:7776 in a browser.
  if (req.method === 'GET' && (p === '/' || p === '/mock')) {
    const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const rows = [...players.values()].map((pl) => `<tr><td>${esc(pl.name)}</td><td>${esc(pl.faction)} (${['Blue', 'Red', 'Green'][FACTIONS.indexOf(pl.faction)] ?? '?'})</td><td>${pl.steamId}</td></tr>`).join('');
    const msgs = messages.slice(-15).reverse().map((m) => `<li><b>${esc(players.get(m.steamId)?.name ?? m.steamId)}</b>: ${esc(m.message)} <small>${m.at.slice(11, 19)}</small></li>`).join('') || '<li>none yet</li>';
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(`<!doctype html><meta http-equiv="refresh" content="5"><title>Fake WARDOGS server</title>
<body style="font-family:system-ui;max-width:760px;margin:24px auto;padding:0 16px">
<h1>Fake WARDOGS server</h1>
<p>Match clock: ${Math.floor((Date.now() - matchStart) / 1000)}s &nbsp;
<form method="post" action="/mock/new-match" style="display:inline"><button>Start a new match (reshuffles factions)</button></form></p>
<h2>In-game messages sent by the bot</h2><ul>${msgs}</ul>
<h2>Players online</h2><table border="1" cellpadding="4" style="border-collapse:collapse">
<tr><th>Name</th><th>Faction</th><th>SteamID</th></tr>${rows}</table>
<p><small>This page refreshes every 5 seconds.</small></p></body>`);
  }

  if (p.startsWith('/mock/')) {
    const b = req.method === 'POST' && (req.headers['content-type'] ?? '').includes('json') ? await body(req) : {};
    if (p === '/mock/messages') return json(res, 200, messages);
    if (p === '/mock/join') { add(b.name, String(b.steamId), b.faction); return json(res, 200, { ok: true }); }
    if (p === '/mock/leave') { players.delete(String(b.steamId)); return json(res, 200, { ok: true }); }
    if (p === '/mock/faction') { const pl = players.get(String(b.steamId)); if (pl) pl.faction = b.faction; return json(res, 200, { ok: !!pl }); }
    if (p === '/mock/new-match') {
      newMatch();
      if ((req.headers['content-type'] ?? '').includes('form')) { res.writeHead(303, { Location: '/' }); return res.end(); }
      return json(res, 200, { ok: true });
    }
    return json(res, 404, { error: { code: 'not_found', message: 'no mock route' } });
  }

  if (req.headers.authorization !== `Bearer ${PASSWORD}`) {
    return json(res, 401, { error: { code: 'unauthorized', message: 'bad password' } });
  }

  if (req.method === 'GET' && p === '/v1/capabilities') {
    return json(res, 200, {
      apiVersion: '1', build: 'mock', auth: { scheme: 'bearer', header: 'Authorization' },
      limits: { maxBodyBytes: 65536, maxRequestsPerMinutePerIp: 600 },
      config: { writable: true, document: 'ServerSettings.ini' }, routes: ROUTES,
    });
  }
  if (req.method === 'GET' && p === '/v1/status') {
    const secs = Math.floor((Date.now() - matchStart) / 1000);
    return json(res, 200, {
      serverName: 'SIXDOGS | Command net in Discord (MOCK)', map, experiences: [], lighting, alternator: 'A',
      scoreTick: { current: 30, min: 10, max: 60 }, scoreCap: 100, matchSeconds: secs,
      players: { current: players.size, max: 99 },
      factionScores: FACTIONS.map((name, i) => ({ name, colorHex: FACTION_COLORS[i] })),
      rotation: { nowIndex: rotationIndex, nextIndex: rotationIndex + 1 },
    });
  }
  if (req.method === 'GET' && p === '/v1/players') {
    for (const pl of players.values()) if (Math.random() < 0.1) pl.kills++;
    return json(res, 200, { players: [...players.values()] });
  }
  if (req.method === 'GET' && p === '/v1/health') {
    return json(res, 200, { status: 'ok', uptimeSeconds: process.uptime(), connections: { active: 1 }, gameThreadQueue: { inFlight: 0, depth: 0, rejectedTotal: 0 } });
  }
  if (req.method === 'GET' && p === '/v1/server-id') return json(res, 200, { serverId: 'mock-server' });
  const m = /^\/v1\/players\/(\d+)\/message$/.exec(p);
  if (req.method === 'POST' && m) {
    const b = await body(req);
    if (!players.has(m[1])) return json(res, 404, { error: { code: 'player_not_found', message: 'not online' } });
    messages.push({ steamId: m[1], message: b.message, at: new Date().toISOString() });
    console.log(`[mock] whisper to ${players.get(m[1]).name}: ${b.message}`);
    return json(res, 200, { ok: true, message: 'sent' });
  }
  if (req.method === 'POST' && p === '/v1/broadcast') {
    const b = await body(req);
    console.log(`[mock] broadcast: ${b.message}`);
    return json(res, 200, { ok: true, message: 'sent' });
  }
  const mk = /^\/v1\/players\/([^/]+)\/kick$/.exec(p);
  if (req.method === 'POST' && mk) {
    if (!ROUTES.includes('POST /v1/players/{steamId}/kick')) return json(res, 404, { error: { code: 'not_found', message: 'no such route' } });
    const b = await body(req);
    const pl = players.get(mk[1]);
    if (!pl) return json(res, 404, { error: { code: 'player_not_found', message: 'not online' } });
    players.delete(mk[1]);
    console.log(`[mock] kicked ${pl.name}: ${b.reason}`);
    return json(res, 200, { ok: true, kicked: pl.name });
  }
  const mf = /^\/v1\/players\/([^/]+)$/.exec(p);
  if (req.method === 'PATCH' && mf) {
    if (!ROUTES.includes('PATCH /v1/players/{steamId}')) return json(res, 404, { error: { code: 'not_found', message: 'no such route' } });
    const b = await body(req);
    const pl = players.get(mf[1]);
    if (!pl) return json(res, 404, { error: { code: 'player_not_found', message: 'not online' } });
    if (!FACTIONS.includes(b.faction)) {
      return json(res, 422, { error: { code: 'bad_faction', message: `unknown faction "${b.faction}"` } });
    }
    pl.faction = b.faction;
    console.log(`[mock] moved ${pl.name} to ${b.faction}`);
    return json(res, 200, { ok: true, faction: pl.faction });
  }
  if (req.method === 'POST' && p === '/v1/match/restart') {
    matchStart = Date.now();
    note('match.restart', '');
    console.log('[mock] match restarted');
    return json(res, 200, { ok: true });
  }
  if (req.method === 'POST' && p === '/v1/match/map') {
    const b = await body(req);
    if (!MAPS.includes(b.map)) return json(res, 422, { error: { code: 'bad_map', message: `unknown map "${b.map}"` } });
    if (b.lighting && !LIGHTINGS.includes(b.lighting)) return json(res, 422, { error: { code: 'bad_lighting', message: `unknown lighting "${b.lighting}"` } });
    map = b.map;
    if (b.lighting) lighting = b.lighting;
    newMatch();
    note('match.map', `${b.map}${b.lighting ? ' ' + b.lighting : ''}`);
    console.log(`[mock] map changed to ${b.map}`);
    return json(res, 200, { ok: true, map });
  }
  if (req.method === 'PUT' && p === '/v1/world/lighting') {
    const b = await body(req);
    if (!LIGHTINGS.includes(b.lighting)) return json(res, 422, { error: { code: 'bad_lighting', message: `unknown lighting "${b.lighting}"` } });
    lighting = b.lighting;
    note('world.lighting', b.lighting);
    console.log(`[mock] lighting set to ${b.lighting}`);
    return json(res, 200, { ok: true, lighting });
  }
  const mkill = /^\/v1\/players\/([^/]+)\/kill$/.exec(p);
  if (req.method === 'POST' && mkill) {
    const pl = players.get(mkill[1]);
    if (!pl) return json(res, 404, { error: { code: 'player_not_found', message: 'not online' } });
    pl.deaths += 1;
    note('player.kill', pl.name);
    console.log(`[mock] killed ${pl.name}`);
    return json(res, 200, { ok: true });
  }
  if (req.method === 'GET' && p === '/v1/bans') return json(res, 200, { bans: [...bans.values()] });
  if (req.method === 'POST' && p === '/v1/bans') {
    const b = await body(req);
    bans.set(String(b.steamId), { steamId: String(b.steamId), reason: b.reason ?? '', at: new Date().toISOString() });
    players.delete(String(b.steamId));
    note('ban.add', String(b.steamId));
    console.log(`[mock] banned ${b.steamId}: ${b.reason}`);
    return json(res, 200, { ok: true });
  }
  const munban = /^\/v1\/bans\/([^/]+)$/.exec(p);
  if (req.method === 'DELETE' && munban) {
    if (!bans.delete(munban[1])) return json(res, 404, { error: { code: 'not_banned', message: 'not in the ban list' } });
    note('ban.remove', munban[1]);
    console.log(`[mock] unbanned ${munban[1]}`);
    return json(res, 200, { ok: true });
  }
  if (req.method === 'GET' && p === '/v1/catalog/maps') return json(res, 200, { maps: MAPS });
  if (req.method === 'GET' && p === '/v1/catalog/lightings') return json(res, 200, { lightings: LIGHTINGS });
  if (req.method === 'GET' && p === '/v1/catalog/experiences') return json(res, 200, { experiences: EXPERIENCES });
  if (req.method === 'GET' && p === '/v1/rotation') {
    return json(res, 200, { enabled: true, mode: 'sequential', entries: MAPS.map((m) => ({ map: m })) });
  }
  if (req.method === 'GET' && p.startsWith('/v1/audit')) {
    return json(res, 200, { entries: auditLog.slice(0, 50) });
  }
  if (req.method === 'GET' && p === '/v1/config') {
    return json(res, 200, {
      revision: String(configRevision),
      writable: true,
      text: CONFIG_TEXT,
      sections: ['/Script/Wardogs.ServerSettings', '/Script/Wardogs.MapRotation'],
      warnings: [],
    });
  }
  if (req.method === 'POST' && p === '/v1/match/end') {
    if (!ROUTES.includes('POST /v1/match/end')) return json(res, 404, { error: { code: 'not_found', message: 'no such route' } });
    newMatch();
    console.log('[mock] match ended by RCON');
    return json(res, 200, { ok: true });
  }
  json(res, 404, { error: { code: 'not_found', message: `${req.method} ${p}` } });
}).listen(PORT, () => console.log(`[mock] fake WARDOGS server running — open http://localhost:${PORT} in your browser`));
