# SIXDOGS — notes for Claude Code

Community tooling for a WARDOGS server. Two processes plus a database. Normally started with
`node run.mjs` (or `start.bat` / `start-practice.bat` on Windows) — no Docker. With no
`DATABASE_URL`, core uses PGlite (embedded Postgres, files in `data/`); with one, a real Postgres.
`docker-compose.yml` is an optional alternative.


- `core/` — owns the RCON token, polls the game server every 5s, writes to Postgres, serves an internal API on :8080 (bearer `INTERNAL_TOKEN`). Plain Node 22 ESM; deps `pg` and `@electric-sql/pglite`.
- `bot/` — discord.js v14. Talks ONLY to core, never to the game server. Never give it the RCON password.
- `mock/mock-wardogs.mjs` — fake RCON server for local testing (`node run.mjs --mock`; control page on http://localhost:7776).

Work from the real API, not memory: `docs/wardogs-rcon.md` (and `docs/wardogs-openapi.json` if present). Do not invent WARDOGS endpoints or fields.

## WARDOGS RCON — the non-obvious rules

- The RCON listener is plain HTTP. Never rewrite the scheme to https; it refuses.
- The bearer token IS the full-access RCON password. Server-side only. Never logged.
- Branch on GET /v1/capabilities (`routes` is a list of "METHOD /path" strings). Don't catch 404s.
- PUT /v1/config replaces the ENTIRE document. GET, edit that text, PUT back with If-Match.
  A pre-existing bad value blocks unrelated edits — read errors[] and name the key.
- Config arrays use Unreal operators: !Key=ClearArray empties, .Key=value appends.
  The !Key line is a directive, not a member — skip it when indexing.
- Poll no faster than every 3–5s. Watch /v1/health gameThreadQueue for backpressure.
- /v1/players returns { name, steamId, faction, kills, deaths, cash, pingMs } and nothing else.
  No squad data exists. Don't invent a squad field.
- cash is a PERSISTENT wallet across matches, not a match score.
- Resolve display names via Steam ISteamUser/GetPlayerSummaries. Batch and cache.
- The API has no events and no history. "Joined", "left", "match started" are all inferred by
  comparing consecutive polls. `core/src/match.js` holds the match-boundary heuristics.

## Unverified — check against a live server before relying on them

- Whether `matchSeconds` counts up or down (core infers it).
- The score field name inside `factionScores[]` (schema only shows `name`, `colorHex`).
- The exact strings in `player.faction`. The bot maps them to blue/red/green via the matching
  `factionScores[].colorHex` hue, then the names Lonestar/Valkyra/Manticore, then a colour word;
  `FACTION_ALIASES` overrides (`bot/src/factions.js`).

## Deliberately cut — don't re-add

- `/code` (relaying tower digits): in-game TEAM chat already does this.
- `/squad` callsigns: the API has no squad data.
- Kicking people who aren't in Discord.

## Factions

In Discord, factions are colours: Blue = Lonestar, Red = Valkyra, Green = Manticore. Keys are
`blue`/`red`/`green`; never use the in-game names for Discord roles or channels.

## #roles reaction menu

`bot/src/rolemenu.js`: one bot message in `#roles`, one emoji per role (Commander Pool + the six
WARDOGS classes: Assault, Medic, Recon, Support, Driver, Pilot). Reaction add/remove = role
add/remove; startup catch-up only adds. Class roles are informational for now (mentionable).

## Channel layout

`enforceLayout` in `bot/src/setup.js` runs on every start: INFO channels created if missing,
ordered (rules, get-verified, how-to-play, roles, server-info, support-the-community, announcements) and locked (bot-only;
#announcements Admin-only), #clips renamed to #clips-screenshots, #looking-for-squad deleted,
faction listen channels allow UseEmbeddedActivities (wardogs.tech map) but not Speak.
COMMUNITY is #general and #clips-screenshots only. enforceLayout applies the WHOLE channelPlan
(creates missing categories/channels, sets overwrites) every start. Access model: @everyone
reads INFO + COMMUNITY and can only type in #get-verified (slash commands need a writable
channel; `guard.js` deletes other messages there); Verified writes in COMMUNITY and joins the
lobby; faction role = own listen channel only (Verified is explicitly denied there);
commander role = Speak in own channel. `guard.js` moves people out of voice channels they lost
access to. test/permissions.test.js simulates Discord's overwrite rules per persona.

## Community facts (community.json)

`community.json` at the root is the single source for facts shown in several places: domain,
Discord invite, founder letter, donation platform/link/wording, costs, Hardcore settings,
server search name, live status URL. Consumers:
- Discord posts: `content/*.md` use `{{key}}`, `{{#if}}`, `{{#each}}` (`tools/facts.mjs`),
  filled by `loadPosts` at bot start. A post whose template breaks is skipped and logged.
- Website: `website-src/index.html` -> `node tools/build.mjs` -> `website/index.html` and
  `website/_redirects` (/discord, /join, /donate). Never edit website/index.html directly.
- Guide panel play-h2 (Hardcore): `design/verify-guide/build_panels.py` reads it; render with
  render_panels.py and export `panels/hc.png` to `content/play-h2.jpg` (JPEG q88).
- Bot config: INVITE_DOMAIN defaults to `domain`.
When the owner says "change X" (e.g. "change donation to PayPal"): edit community.json (and any
wording that names the old thing, e.g. donate.how), `grep -ri` for the old name across content/,
website-src/, design/verify-guide/, README.md and PRODUCT.md, run `node tools/build.mjs`, re-render
panels if hardcore/join facts changed, run tests, then `git commit` and `git push` to `main`.
Pushing is the whole deploy: Cloudflare Pages rebuilds the website, and the VPS pulls the new
code and restarts the bot within ~2 minutes. Nothing is manual any more.
api.cloudflare.com is blocked from this sandbox, so never try to deploy with wrangler or the
Cloudflare API: push to GitHub instead.

## How changes reach the world

There is no local machine in the loop. The owner is not a programmer and does not run
commands: everything happens by pushing to GitHub `main`.

- `main` is production. A push to it deploys.
- Website: Cloudflare Pages runs `node tools/build.mjs` and publishes `website/`.
- Bot + core: hosted on Railway, which redeploys on every push to `main` (`deploy/RAILWAY.md`).
  Root `package.json` holds the `start` script Railway uses. `deploy/README.md` keeps the
  plain-Linux/systemd path for if that is ever wanted again.
- Settings are Railway variables, NOT a file. `run.mjs` reads a `.env` file when there is one
  and real environment variables when there is not. Claude cannot read or set Railway
  variables, so a change needing a new setting means telling the owner what to add, in plain
  words. The database is Railway Postgres via `DATABASE_URL`, so PGlite is not used there.
- The GitHub repo is PUBLIC. Never commit a secret, and never paste one into a doc or post.
- Work on the branch you were given, but say clearly that it has to reach `main` to go live.

## Website live status

`bot/src/webstatus.js` POSTs `publicStatus()` (no Discord IDs) every STATUS_PUSH_MINUTES to
STATUS_PUSH_URL with STATUS_PUSH_TOKEN; `cloudflare/live-worker.js` (KV binding STATUS, secret
PUSH_TOKEN, custom domain live.sixdogs.gg) stores it and serves GET /status with CORS. The site
hides #live unless the data is under 10 minutes old.

## Channel posts

`content/<channel>.md` -> the bot's post in `#<channel>` (`bot/src/posts.js`), posted or edited
in place on start and on /setup-server. `{#name}` renders as a channel link. `image: x.jpg`
attaches a picture from content/ to that card (shown small, avoid for guides); `button: Label |
https://...` adds link buttons; `//` lines are notes (ignored); `panel: x.jpg` posts a picture as its own plain message (full
size; lines above the first card go before it). A post = all the bot's non-menu messages in the
channel, oldest first; same count -> edit in place, fewer -> delete the extras at the end, more -> delete and repost.
Guide panels are 1200x675 (2x) in the briefing style: design/verify-guide/build_panels.py +
panels.css, rendered by render_panels.py.
#server-info is skipped: it's the live board (`bot/src/liveboard.js`, one message found by its
"Live board" footer, edited every LIVE_BOARD_MINUTES and on match/commander change). WARDOGS
has no direct-join URL and Discord link buttons can't use steam://, so the board shows the
Server ID (RCON /v1/server-id, override GAME_SERVER_ID) for "Join by ID". Tone: plain, warm,
short; no long dashes or stock AI phrasing (a test checks).

## Post-match ratings

Core: `rating_rounds` / `rating_voters` / `rating_votes`, scoring in `core/src/ratings.js`
(good +1, poor -1, toxic -3, capped at +-3 per round, last RATING_WINDOW_DAYS). Commander terms
come from `commander_log`, voters from `player_samples` (so it survives bot restarts).
Who rates whom: `POST /internal/matches/:id/rating-plan` (voter must be on the faction for
RATING_MIN_PLAY_MIN *during that commander's term*; top RATING_MAX_PER_FACTION by time).
Bot: `bot/src/ratings.js` opens rounds when it sees a match change and sends ONE ballot DM per
player per match (a button row per commander; state is read back from the message itself),
then the commander a summary when a round closes. Selection: pool members by best score (random among ties), else anyone on the faction at random.

## Operations (off)

Scheduled ops are off while this is a 24/7 server: no OPERATIONS category, no Operator role.
An existing OPERATIONS category is hidden on startup (`applyOperationsVisibility`), never
deleted. `OPERATIONS_ENABLED=true` brings it back.

## Commander selection

Continuous rule in `bot/src/commander.js`: every tick, an empty faction slot is offered to
someone on that faction (Commander Pool by best rating, else random; voice doesn't matter).
A commander keeps it until /standdown, COMMANDER_AWAY_SEC (300s) off the server, switching
sides, or match end. Never a
one-off pick at match start. Cooldowns in `COOLDOWN_MS`. Never bump a sitting commander.

## Conventions

- Scope each session to one runnable thing and stop there.
- If the game server is unreachable, the bot changes nothing for OUTAGE_CLEAR_MIN (10) minutes, then clears team + commander roles once.
- Faction roles are mutually exclusive and fully bot-owned: every holder is tracked (linked or not) and loses it after LEAVE_GRACE_SEC off that side; at a match change, anyone absent loses it immediately (`tracker.dropAbsent`). Discord-only mode clears them all at start.
- Verified role (`bot/src/verified.js`, VERIFIED_ROLE_NAME): held by exactly the linked members. Given on /confirm and admin /link, removed on /unlink and /unlink-member, re-given when a linked member rejoins, and reconciled against `GET /internal/links` on startup. Created on startup if missing.
- Links are by SteamID; names are only used to find someone at /verify time. /verify also takes a SteamID64 or /profiles/ link to break name ties.
- Tests: `npm test` in `core/` and `bot/` (node:test, no Discord or DB needed).
