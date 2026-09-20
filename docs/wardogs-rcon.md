# WARDOGS RCON HTTP API — working reference

Compiled 2026-09-18 from https://wardogs.tech/openapi.json and https://wardogs.tech/rcon-reference
(an *unofficial* community reference). Save the originals next to this file:

- `docs/wardogs-openapi.json` ← https://wardogs.tech/openapi.json
- the "Prompt for AI tools" block from https://wardogs.tech/rcon-reference → paste below this file's end

## Connection

| | |
|---|---|
| Scheme | plain HTTP (no TLS) — the password crosses the wire in clear text |
| Default | `http://127.0.0.1:7776` |
| Auth | `Authorization: Bearer <rcon-password>` |
| Server settings | `bEnabled=true` (off by default), `BindAddress=127.0.0.1` (loopback by default), `Port=7776`, `Password=` or `PasswordHash=` (hash wins) |
| Rate | no published limit; the official panel refreshes every 3–5s |

Because it's plain HTTP, reaching it across the internet means the password travels unencrypted.
Prefer running SIXDOGS on a machine in the same datacentre/network as the game server, or ask
your host about a private network / IP allow-list.

## Routes used by SIXDOGS

| Route | Returns / body |
|---|---|
| `GET /v1/capabilities` | `{ apiVersion, build, auth{scheme,header}, limits{maxBodyBytes,maxRequestsPerMinutePerIp}, config{writable,document}, routes: ["METHOD /path", …] }` |
| `GET /v1/status` | `{ serverName, map, experiences[], lighting, alternator, scoreTick{current,min,max}, scoreCap, matchSeconds, players{current,max}, factionScores[{name,colorHex,…}], rotation{nowIndex,nextIndex}? }` |
| `GET /v1/players` | `{ players: [{ name, steamId, faction, kills, deaths, cash, pingMs }] }` |
| `GET /v1/health` | `{ status, uptimeSeconds, connections{active}, gameThreadQueue{inFlight,depth,rejectedTotal} }` |
| `POST /v1/players/{steamId}/message` | body `{ message }` → `{ ok, message }` — private in-game message |
| `POST /v1/broadcast` | body `{ message }` → `{ ok, message }` |

## Other routes (not used yet)

- `GET /v1/server-id` → `{ serverId }` (stable across restarts)
- `GET /v1/audit?limit=1..500`
- `GET/POST /v1/bans`, `DELETE /v1/bans/{steamId}` — body `{ steamId, reason }`
- `POST /v1/players/{steamId}/kick` `{ reason }`, `POST /v1/players/{steamId}/kill`
- `PATCH /v1/players/{steamId}` `{ faction }` — capability-gated
- `POST /v1/match/map` `{ map, experiences[], lighting, zoneAlternator }`, `POST /v1/match/end`, `POST /v1/match/restart`
- `PUT /v1/world/lighting` `{ lighting }`
- `GET /v1/rotation` → `{ enabled, mode, entries[] }`
- `GET /v1/catalog/maps|lightings|experiences`, `GET /v1/catalog/maps/{id}/experiences|alternators`
- `GET /v1/config` → `{ revision, writable, text, sections[], warnings[] }`
- `PUT /v1/config` — plain-text body, `If-Match: "<revision>"`, query `force`, `fullApply`
- `POST /v1/config/validate` — plain-text body
- `GET /v1/sponsor`
- Deprecated in current build: reserved-slots routes, rotation entry edits, `PUT /v1/sponsor`, `PATCH /v1/settings`

## Errors

- General: `{ error: { code, message } }`
- Config 422 (validation) and 412 (revision conflict): `{ ok: false, errors: [{ section, key, code, message }] }`

## Gaps in the published schema (verify on your server)

1. `factionScores[]` only documents `name` and `colorHex`. The reference says to match factions by
   `colorHex`, not name. No score field is documented.
2. `matchSeconds` direction (elapsed vs remaining) isn't documented.
3. `player.faction` is "a server-defined name string"; exact values unknown. Factions are
   Lonestar (blue), Valkyra (red), Manticore (green) — SIXDOGS uses the colours in Discord.

Once RCON works, run this from the SIXDOGS machine and paste the output into this file:

```
curl -s -H "Authorization: Bearer $RCON_PASSWORD" http://<host>:<port>/v1/status
curl -s -H "Authorization: Bearer $RCON_PASSWORD" http://<host>:<port>/v1/players
```
