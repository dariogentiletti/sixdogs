# SIXDOGS — notes for Claude Code

Community tooling for a WARDOGS server. Two processes plus a database, started with
`node run.mjs` (add `--mock` for the fake game server). Hosted on Railway; see
"How changes reach the world" below. With no `DATABASE_URL`, core uses PGlite (embedded
Postgres, files in `data/`); with one, a real Postgres, which is what Railway provides.


- `core/` — owns the RCON token, polls the game server every 5s, writes to Postgres, serves an internal API on :8080 (bearer `INTERNAL_TOKEN`). Plain Node 22 ESM; deps `pg` and `@electric-sql/pglite`.
- `bot/` — discord.js v14. Talks ONLY to core, never to the game server. Never give it the RCON password.
- `mock/mock-wardogs.mjs` — fake RCON server for local testing (`node run.mjs --mock`; control page on http://localhost:7776).

Work from the real API, not memory: `docs/wardogs-rcon.md` (and `docs/wardogs-openapi.json` if present). Do not invent WARDOGS endpoints or fields.

## WARDOGS RCON — the non-obvious rules

- The RCON listener is plain HTTP. Never rewrite the scheme to https; it refuses.
- The bearer token IS the full-access RCON password. Server-side only. Never logged.
- Branch on GET /v1/capabilities (`routes` is a list of "METHOD /path" strings). Don't catch 404s.
- Route parameter names are NOT stable: the live build says `/v1/players/{id}/...` but
  `/v1/bans/{steamId}`, and the reference documents `{steamId}` for both. `RconClient.has()`
  normalises `{anything}` and `:anything` before comparing. Never compare capability strings
  exactly; that once read private messages as unsupported and would have killed `/verify`.
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

## Confirmed against the live server (build `++Wardogs+Live-CL-501228`, API 1, Sept 2026)

Read off `/server` on the real SIXDOGS server, so these are facts now, not guesses:

- `factionScores[]` DOES carry a numeric `score`, alongside `name` and `colorHex`.
  `factionScoreTotal` already reads it first.
- The real faction colours are Lonestar `#4CB1EF`, Valkyra `#FA503E`, Manticore `#1DD65C`
  (not the Discord brand colours). `colorKeyFromHex` classifies all three correctly, and
  `gameFactionFor` maps blue/red/green back to Lonestar/Valkyra/Manticore.
- All five actions are served: message, broadcast, kick, move (`PATCH /v1/players/{id}`) and
  end match. The full observed route list is in `docs/wardogs-rcon.md`.
- `player.faction` carries the SAME strings as `factionScores[].name`: read off a live server
  with players on, `factionStrings` came back `["Valkyra", "Manticore"]`. So the plain-name
  fallback in `factionKeyFor` is the path that actually runs, both directions check out
  (Valkyra->red->Valkyra), and `FACTION_ALIASES` is not needed. No alias guessing required.
- Also served but unused so far: `GET`/`PUT /v1/config` + `POST /v1/config/validate` (server
  settings), `/v1/bans`, `/v1/match/map`, `/v1/match/restart`, `PUT /v1/world/lighting`,
  `/v1/rotation`, the `/v1/catalog/*` lists, `/v1/audit`, `POST /v1/players/{id}/kill`.
- `/v1/status` omits `matchSeconds` and `scoreCap` entirely on this build, idle or not. Both are
  treated as optional (`typeof === 'number'` guards); match detection leans on map, rotation
  index and the score reset. `summarize` sets `clockFromServer:false` in that case and
  `showClock` only once players are on, so the board never counts up a match nobody played.

## Still unverified — check against a live server before relying on them

- Whether `matchSeconds` counts up or down. Moot in practice on this build: `/server` with
  players on shows `matchSeconds: null` and no `matchSeconds` key in `statusKeys` at all, so
  there is no clock to infer a direction from. `clockDirection` stays null and the board falls
  back to when the bot first saw the match. Only worth revisiting if a future build starts
  sending the field.

## Deliberately cut — don't re-add

- `/code` (relaying tower digits): in-game TEAM chat already does this.
- `/squad` callsigns: the API has no squad data.
- One-click join links. WARDOGS ignores steam:// entirely, with or without the app id, so both
  the site and the board show the Server ID for Join by ID. Do not add a join button.
- Kicking people who aren't in Discord.
- AUTOBALANCING TEAMS. The owner has ruled it out: never move a player between factions
  automatically, during a match or between them. `/move` is an admin command and nothing may
  call `setFaction` on its own. Do not add a balance rule however sensible it looks.

## Factions

In Discord, factions are colours: Blue = Lonestar, Red = Valkyra, Green = Manticore. Keys are
`blue`/`red`/`green`; never use the in-game names for Discord roles or channels.

## #roles reaction menu

`bot/src/rolemenu.js`: one bot message in `#roles`, one emoji per role (Commander Pool, Match
Alerts and the six WARDOGS classes: Assault, Medic, Recon, Support, Driver, Pilot). Reaction add/remove = role
add/remove; startup catch-up only adds. Class roles are informational for now (mentionable).

## Channel layout

**#general is open to everyone, verified or not**, but @everyone is denied `EmbedLinks`,
`AttachFiles` and `UseExternalEmojis` there. Making people verify before they can say hello loses
the ones who were only half sure; the link and file ban is very nearly the whole scam vector,
since a drive-by account is there to paste a URL and will not bother with a wall of text. It also
leaves verifying with a point. #clips-screenshots stays verified-only, because pictures are what
it is for. `test/permissions.test.js` pins all of that per persona.

`applyVerificationLevel` sets Discord's own server-wide gate (`GUILD_VERIFICATION_LEVEL`, default
`high` = a member for 10 minutes before they can post). It runs in `enforceLayout`, so every
start. An unrecognised name changes NOTHING and reports itself rather than guessing at a level.

`enforceLayout` in `bot/src/setup.js` runs on every start: INFO channels created if missing,
ordered (rules, get-verified, how-to-play, roles, server-info, start-a-match, support-the-community, announcements) and locked (bot-only;
#announcements Admin-only), #clips renamed to #clips-screenshots, #looking-for-squad deleted,
faction listen channels allow UseEmbeddedActivities (wardogs.tech map) but not Speak.
COMMUNITY is #general, #clips-screenshots and #leaderboard. The leaderboard is there rather
than in INFO because it is something to come back FOR, not a notice read once, but it is still
read-only and the category's Verified and Moderator write grants are taken back per channel:
the board is one message found again by its heading in the last 50, so chat would bury it and
the bot would post a second one.
**enforceLayout MOVES a channel that is in the wrong category** rather than leaving it there.
Its channel lookup matches on name anywhere in the server, so before that a channel that
changed category kept its new permissions and its old home (and runSetup, which looks inside
the category, would have made a duplicate). Found the day #leaderboard left INFO. enforceLayout applies the WHOLE channelPlan
(creates missing categories/channels, sets overwrites) every start. Access model: @everyone
reads INFO + COMMUNITY and can only type in #get-verified (slash commands need a writable
channel; `guard.js` deletes other messages there); Verified writes in COMMUNITY and joins the
lobby; faction role = own listen channel only (Verified is explicitly denied there);
commander role = Speak in own channel. `guard.js` moves people out of voice channels they lost
access to. test/permissions.test.js simulates Discord's overwrite rules per persona.

## Project knowledge: stack.json

`stack.json` is the operational source of truth: what SIXDOGS runs on, what each piece costs,
what is still pending, and why the big choices were made. `community.json` is what PLAYERS see;
`stack.json` is what the OWNER pays for and runs.

**Keep it current as part of the work, not as a separate chore.** The moment the owner says they
signed up for something, paid for something, changed plan, set up a service, or dropped one,
edit `stack.json` in that same session. This already went wrong once: Railway Hobby was set up on
Claude's own recommendation and never recorded, so an hour later the donation page was built with
a guessed "about $10" for bot hosting instead of the real $5.

The public bill is DERIVED from `services[]` by `costsFromStack` in `tools/facts.mjs`, which fills
`costs.items` and `costs.total` for the website and `#support-the-community`. So:
- Adding a service to `stack.json` puts it on the bill everywhere. There is no second list.
- `confirmed: false` renders the figure as "about $5" and makes the total "about". Set it true
  only against a real invoice.
- `onBill: false` keeps something in the stack but off the public bill.
- Only the `leftover` wording still lives in `community.json`.

When the owner says something broad like "update the website and Discord with the new
information", that means: re-read `stack.json`, work out what changed since those pages were
written, and update the facts before touching wording. Do not wait to be told which facts.

`rules[]` records standing decisions the owner has made, the kind that are easy to undo by
accident. Read it before building anything that acts on its own.

`verified[]` records things checked against the live server, with the date. Trust it over
guessing, and add to it whenever something is confirmed rather than assumed.

NEVER put a password, token or account credential in it. The repo is public, and a test checks.

## Community facts (community.json)

`community.json` at the root is the single source for facts shown in several places: domain,
Discord invite, founder letter, donation platform/link/wording, Hardcore settings, server search
name, live status URL. The cost NUMBERS are not here: they are derived from `stack.json` (above).
Consumers:
- Discord posts: `content/*.md` use `{{key}}`, `{{#if}}`, `{{#each}}` (`tools/facts.mjs`),
  filled by `loadPosts` at bot start. A post whose template breaks is skipped and logged.
- Website: `website-src/index.html` -> `node tools/build.mjs` -> `website/index.html` and
  `website/_redirects` (/discord, /join, /donate). Never edit website/index.html directly.
- Guide panel play-h2 (Hardcore): `design/verify-guide/build_panels.py` reads it; render with
  render_panels.py and export `panels/hc.png` to `content/play-h2.jpg` (JPEG q88).
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
- Website: Cloudflare Pages runs `node tools/build.mjs` and publishes `website/`. Every page
  carries `<meta name="sixdogs-build" content="<sha> <time>">` and the console prints it on load.
  When the owner says a website change has not appeared, ASK FOR THAT FIRST: if the sha is not
  the latest commit the deploy is stale and nothing in the code is worth debugging.
- Bot + core: hosted on Railway, which redeploys on every push to `main` (`deploy/RAILWAY.md`).
  Root `package.json` holds the `start` script Railway uses.
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

The LEADERBOARD rides along on that same payload (`leaderboard:` from `publicLeaderboard`), so
there is one endpoint, one token and one thing that can be stale. Deliberate consequences:
- The Worker needs no change and the owner never pastes it again. It stores the blob whole and
  rejects anything over 20000 characters, so `push()` drops the leaderboard and pushes without it
  rather than letting a refused POST take the live board down silently. A realistic board is
  ~2.5k and there is a test pinning that.
- It is sent while the game server is OFFLINE too. It is history, not a reading, and an offline
  server is exactly when somebody on the site has time to read it.
- The page shows it for up to 24h (LB_STALE), not the live board's 10 minutes, because a 30-day
  board is still true two hours later.

## Leaderboard

`core/src/leaderboard.js` (the SQL and the numbers) + `bot/src/leaderboard.js` (the words and
the drawing) + `GET /internal/leaderboard?days=&top=`. One edited message in #leaderboard
(skipped by `syncPosts`) and the same boards on sixdogs.gg.

### It is a SCOREBOARD, not another embed

The first version was an embed with a list of names in it, which is what every other post the bot
makes looks like, and the owner said so in those words. Three ways to get a scoreboard into
Discord, and only one of them survives contact with this deploy:

1. **A rendered picture.** Best looking by a mile and not available. Railway has no browser and
   no font stack, and a board redrawn every 15 minutes cannot be a JPEG committed to the repo the
   way the guide panels are. A native rasteriser in a service the owner cannot debug fails as
   blank boxes with nothing in the logs. Do not reach for this without solving fonts first.
2. **An `ansi` code block**, which Discord colours. REJECTED, and do not re-add it: colour
   renders on desktop and web only, and depending on the phone's app version mobile shows either
   no colour or the raw escape codes scattered through the text.
3. **A plain code block** — monospace absolutely everywhere — inside a **Components V2**
   container. That is what it does.

`chart()` draws one board: rank, name padded to NAME_W, the value right-aligned, then a bar made
of `█` on a `·` track. Rules that came out of looking at it:

- **The bar goes LAST, after the number.** A code block does not wrap, it scrolls sideways, and a
  narrow phone has room for about 25 characters. Something has to be the column that falls off
  the edge and it must never be the score. Measured against a mock of Discord's dark theme, not
  guessed; the first draft was 37 columns and lost the numbers at 420px.
- **No bar without a `mag`.** Ground held has none on purpose: it is a shared team number, so
  teammates cluster and every bar came out full, which says nothing. Swing is signed and
  discipline is lower-is-better, so on both the longest bar would belong to the wrong person.
- **The value column lands at the same offset on every board** (there is a test). That column
  running straight down is what makes eight blocks read as one scoreboard.
- `monoName` strips anything that is not single-width. One emoji in a Steam name would shear
  every row under it.
- `short` is the narrow form for that column; `value` keeps the unit for the website.

Components V2 details worth not rediscovering: the message carries `flags: 1 << 15` and **cannot
have `content` or `embeds`** (Discord refuses the whole message), the limit is **4000 characters
across every text component** and 40 components, and a message keeps the shape it was sent with,
so an old embed board **cannot be edited into** a V2 one — `update()` catches the failure, deletes
and reposts, and `findBoard` deletes any leftover embed board on sight. With no embed there is no
footer to hide a marker in, so the heading `TITLE` is the marker. A test builds the hand-written
component JSON through discord.js's own `ContainerBuilder` so a shape it would refuse at send
time fails in `npm test` instead of silently never appearing.

**`BOARDS` in bot/src/leaderboard.js is the ONE definition** of every board's title, its
explanation and its number format. `leaderboardPost` (Discord) and `publicLeaderboard` (website)
both render from it, so the two cannot drift into describing the same number two different ways,
and there is a test asserting the website's `note` is the start of the Discord field. Add a board
there, not in two places.

Eight boards, not one blended score: a single weighted number is impossible to argue with and
impossible to chase, because nobody can work out what to do differently about it.

- The game gives kills/deaths/cash/faction and NOTHING else — no supplies, captures, revives or
  events — so nothing here claims to count them. The owner asked for "supplies delivered"; it
  does not exist and was said so plainly rather than approximated.
- **Ground** (score gained per minute while on the field) is a TEAM number and the board says so.
  Identical values across a whole side are correct, not a join bug; that was investigated in the
  raw data once already.
- **Swing** (on-field rate minus off-field rate) is the individual one, and it is `null` — not
  zero — for anyone who never left: with nothing to compare against there is no number. Needs
  `offMinutes >= minMinutes / 2`, so the board is empty until people come and go, and it says on
  itself that it fills in on its own rather than looking broken.
- Only score GAINS count (`GREATEST(score - LAG(score), 0)`): a drop is a reset or a cap, not
  something the players did.
- `fight` groups by match+player and NOT by faction, so a side-switcher's kills aren't doubled.
- kills/deaths reset per match, so a total is the sum of per-match peaks. `cash` is collected and
  NOT ranked: nobody has confirmed what moves it.
- Rate boards need LEADERBOARD_MIN_MINUTES (20). Without it one lucky ten minutes tops a table
  for a month.
- `people: true` marks the two boards keyed on Discord instead of the game. Each carries its own
  `anon` label for somebody who has left the guild, because "A commander" on the seeding board
  was plain wrong (found by the end-to-end check, not by a unit test).

**"Got matches going" is the point of the community half.** It counts seeding call-ins, is the
only board the game cannot see, and needs no minutes played at all — the whole point is that it
credits what somebody did while they were NOT in the server. `seed_credits` is written by the
call-in itself, in the SAME statement that clears the list
(`WITH cleared AS (DELETE ... RETURNING ...) INSERT INTO seed_credits ...`), because the list is
what holds the names and a separate write could lose them.

The website section is a 4x2 grid whose cards take their rows from the grid
(`grid-template-rows: subgrid`), so headings and explanations line up across a row at every
window width. A `min-height` cannot do it: the same explanation is two lines in one column and
five in another, and guessing an em value costs a round per breakpoint. There is an
`@supports not` fallback with the old min-heights. The card class is `.why`, not `.note`: the
hero already uses `.note` and was quietly making them flex containers.

## Channel posts

`content/<channel>.md` -> the bot's post in `#<channel>` (`bot/src/posts.js`), posted or edited
in place on start and on /setup-server. `{#name}` renders as a channel link. `image: x.jpg`
attaches a picture from content/ to that card (shown small, avoid for guides); `button: Label |
https://...` adds link buttons; `//` lines are notes (ignored); `panel: x.jpg` posts a picture as its own plain message (full
size; lines above the first card go before it). A post = all the bot's non-menu messages in the
channel, oldest first; same count -> edit in place, fewer -> delete the extras at the end, more -> delete and repost.

**#announcements is APPEND ONLY** (`APPEND_CHANNELS` in `posts.js`). Editing is right for #rules
and the guides, where nobody should be pinged because a sentence was tidied. It is wrong for news:
an edit notifies nobody and slides the announcement in above messages people have already read, so
it arrives silently and looks older than it is. Change `content/announcements.md` and the bot
SENDS a new message, leaving every earlier announcement untouched as history. It compares only
against the most recent post, so an unchanged file posts nothing (there is a test for that; the
same announcement going up on every restart would be spam within a day).

That file therefore holds the LATEST announcement only, replaced wholesale, with the date in the
title. Write the date BY HAND. A generated one would differ on every render and the bot would post
again every time it restarted.
Guide panels are 1200x675 (2x) in the briefing style: design/verify-guide/build_panels.py +
panels.css, rendered by render_panels.py, then saved as JPEG q88 into content/. The BODY is only
about 535px tall once the gold strip and padding are off, and the panel is `overflow:hidden`, so
content that does not fit is not flagged or wrapped: it is silently cut off the bottom of the
picture. A first draft of the start-a-match panel lost two of its four steps that way.

**Run `python3 measure_panels.py <page>` before rendering.** It reports the overflow (0 is what
you want) and the gap between each column and the footer rule, and exits non-zero on either
problem. A gap near zero is the crammed look even when nothing is technically cut off, which is
what the owner saw on the second draft of start-a-match. Measure, then look at the PNG; guessing
at type sizes costs several rounds.

Two layout things that came out of that panel. Four boxes in two rows needs 544px and does not
fit; three across one row does, and `.cols` has `flex:1` so the leftover height becomes breathing
room above the footer. And column 2 of a three-column row is the narrowest (it has padding on
both sides, the outer two do not), so its heading wraps first and drops its paragraph out of line
with the others: give every heading the same `min-height` when that happens.
`render_panels.py` finds the Chromium already on the machine (newest `/opt/pw-browsers/chromium-*`,
or `PW_CHROME`): Playwright pins an exact revision and otherwise tells you to download a second
copy of a browser that is already there.
#server-info, #start-a-match and #leaderboard are skipped: all three are live boards the bot keeps itself
(`skip` in `syncPosts`). #server-info is the live board (`bot/src/liveboard.js`, one message found by its
"Live board" footer, edited every LIVE_BOARD_MINUTES and on match/commander change). WARDOGS
has no direct-join URL and Discord link buttons can't use steam://, so the board shows the
Server ID (RCON /v1/server-id, override GAME_SERVER_ID) for "Join by ID". Tone: plain, warm,
short; no long dashes or stock AI phrasing (a test checks).

## Acting on the game server

`core/src/rcon.js` has the write actions: `message`, `broadcast`, `kick`, `setFaction`,
`endMatch`. Every one is gated on `has(METHOD, path)` from /v1/capabilities and throws
`RconError{code:'unsupported'}` with a readable sentence instead of calling out. Add new ones
the same way; never catch a 404 to feature-detect. `supportedActions()` is the summary.

Core routes: `POST /internal/broadcast`, `POST /internal/players/:steamId/kick`,
`POST /internal/players/:steamId/faction`, `POST /internal/match/end`,
`GET /internal/diagnostics`. An RconError with a 4xx status passes its real message through
(useful: "unknown faction X"); 5xx is replaced with a generic line.

Bot: `/say`, `/tell`, `/kick`, `/move`, `/endmatch` (needs `confirm:True`), `/server`.

**29 commands, and that is a ceiling worth defending.** The owner asked for the list to be cut
because it was filling up with things nobody would ever run. `/maps` (a lookup list) became
autocomplete on `/map` and `/lighting`, which is where anyone wanted it. `/rotation` (read-only
trivia), `/audit` (the game's own log, when `#admin-log` already records what the bot does) and
`/kill` (a novelty next to `/kick`) were removed outright, along with their now-dead client
methods. `/reroll` folded into `/set-commander`: with a member it puts that person in the chair,
without one it picks someone new at random, because those are the same job with and without a
name attached. Before adding a command, ask whether it is an option on one that exists.
`findPlayer` in `commands.js` resolves a name or SteamID and REFUSES ambiguous matches rather
than picking. `gameFactionFor` in `factions.js` turns blue/red/green into the server's own
faction string by reading `factionScores[]` back through `factionKeyFor`; it returns null when
nothing maps, and the command refuses. Never send a colour key to the game.

`/server` prints the raw numbers behind the three "Unverified" items above. Ask the owner to
run it and paste the output before tightening any of them.

The mock serves all of these; `MOCK_NO_ACTIONS=1` makes it pretend to be a read-only build.

## Server settings (read-only so far)

`rcon.getConfig()` + `GET /internal/config` + `/settings [section]` read the settings document.
`rcon.configInfo()` reports `{readable, writable, validatable, document}`; `writable` needs BOTH
`capabilities.config.writable` and the `PUT /v1/config` route.

`bot/src/serverconfig.js` parses the Unreal-style text for display: `parseConfigText` returns
sections of `{key, value, kind}` where kind is `set`, `clear` (`!Key=ClearArray`) or `append`
(`.Key=value`). The clear directive is NEVER reported as a value of Key — that is the whole point
of the `kind` field, and there is a test for it.

`/reserved` reads `GET /v1/reserved-slots`. There is NO route to write it on this build, so
granting a donor their promised slot means editing the settings document, which is why the write
path below matters: it is the only way to keep a public promise the donation page already makes.

The live document's six sections are in `docs/wardogs-rcon.md`, read off `/settings` on
2026-09-21. The build reports the document as **writable**. The KEY names inside those sections
have NOT been read yet, and must not be guessed.

`core/src/configedit.js` is the sharp end: `setConfigValue(text, {section, key, value})` changes
ONE ordinary `Key=Value` inside one `[Section]` and returns the whole document back, byte for byte
identical everywhere else, keeping CRLF, comments, blank lines and each line's own spacing. It
REFUSES rather than guesses: unknown section, unknown key (it will not invent a line), a key
listed twice, a value containing a line break, a `!Key`/`.Key` list line. Refusing is always safe
here; guessing breaks a live server in a way nobody sees until a match goes wrong. 15 tests.

WRITING ONE VALUE IS NOW IMPLEMENTED, and deliberately narrow: one ordinary `Key=Value` in one
`[Section]`, nothing else. There is no route that writes arbitrary text, and there shouldn't be.

`PUT /internal/config/value` `{section, key, value, apply}` does the whole dance:
GET the document -> `setConfigValue` changes that one line -> `POST /v1/config/validate` ->
`PUT /v1/config` with `If-Match: "<revision>"`. **`apply` defaults to FALSE**: the expensive
mistake is saving something nobody read, so the first call reports what would change and saves
nothing. A 412 comes back as `stale` ("someone changed the settings while this was being
prepared") and nothing is written, rather than quietly undoing them.

`explainConfigErrors` handles the trap: the server validates the WHOLE document, so a value that
was already wrong blocks an unrelated edit. Reported plainly that reads as "my edit was rejected"
and the admin looks in the wrong place, so an error outside the edit is named AND called
pre-existing.

Bot: `/settings section:X key:Y value:Z` shows the before/after and saves nothing;
`confirm:True` saves it and writes the change to `#admin-log`. Both `section` and `key`
AUTOCOMPLETE off the live document (`makeAutocomplete` in `commands.js`), because nobody should
be hand-typing `MatchState.PreMatch.WaitingForPlayers.PlayerCount` and a near miss is the whole
class of mistake worth removing. It fires on every keystroke, so the document is cached 30s, and
it must answer within 3 seconds: index.js routes autocomplete BEFORE anything that could throw,
and an empty list is always a valid answer. Discord caps a choice's value at 100 characters as
well as its label, and a truncated section name matches nothing, so an over-long name is left out
of the dropdown rather than offered broken. Only `kind: 'set'` keys are offered: a `!Key`/`.Key`
list line has no single value to set and `setConfigValue` refuses it. `rcon.request` sends a string body
as `text/plain`, since the document is text and not JSON wrapping text.

The mock serves `PUT /v1/config` and `POST /v1/config/validate` too, including If-Match conflicts
and a validation rule, so the whole path can be exercised without touching a live server.
`MOCK_BAD_CONFIG=1` seeds a document that is ALREADY invalid, which is the only way to rehearse
the pre-existing-bad-value case.

The real key names are in docs/wardogs-rcon.md. `/settings find:<text>` searches EVERY section
at once for a key (or section) whose name matches, which is how to locate a setting without
reading six sections one command at a time. `section:` falls back to the same search when it
names no real section: typing "afk" into the section box plainly means "find me the afk setting",
and it also keeps working while a Discord client is still caching a command definition that has
no `find:` on it yet. That is not hypothetical, it is how the option's first four uses were lost.

**The write path is proven against the live server**, not just the mock: `MinimumRequiredPlayers`
went 20 -> 45 through `/settings` on 2026-09-21 and the server accepted it. 45 is the owner's
decision, made after being told twice what it means; do not keep re-raising it.

No AFK or idle-kick setting exists in either section read so far, and four sections have never
been looked at.

## Reserved slots (the donation promise)

Reserved slots are an ARRAY in the settings document, not the writable route that
`GET /v1/reserved-slots` made them look like. That is why the donation page could promise a slot
for a $10 donation and nothing could deliver one.

`setConfigListMember(text, {section, key, value, action, max})` adds or removes ONE member of an
Unreal list, byte for byte identical everywhere else. Separate from `setConfigValue` on purpose:
an array is a `!Key=ClearArray` directive plus `.Key=value` members, so "the value of the list" is
not a thing, and treating a plain `Key=Value` as a list would quietly turn a setting into an
array (there is a `not_a_list` refusal and a test for it). It keeps the directive first, copies
the spacing of the lines around it, refuses duplicates, refuses to pass `max`, and refuses to
invent a list the server does not already have.

Core: `GET /internal/reserved`, `POST /internal/reserved` `{steamId, apply}`,
`DELETE /internal/reserved/:steamId` `{apply}`. Same validate-then-write-with-If-Match path as a
value change, and `apply` still defaults to false.

Bot: `/reserved` lists who holds one BY DISCORD MEMBER (resolved through the links), and
`/reserved grant:@member` / `revoke:@member` gives or takes one. Never by SteamID: the link
already knows which is which, and a mistyped SteamID would hand a paid slot to a stranger. The
cap comes from `MaxReservedSlots` read from that same section, never from the first match
anywhere in the document (`getConfigValue` is section-scoped, and there is a test using a
document where two sections share the key name).

A row of zeros is a placeholder, not a person: it is reported but not counted as granted.

**`DELETE` carries a body in core's router.** It was added for `{apply}` on revoke; without it
every revoke silently stayed a dry run, which is exactly how it was found.

## Seeding ("I want to play")

A standing list of who wants a match, and two different messages built on it.
`core/src/seeding.js` is pure and tested; core holds the settings so there is ONE copy of them
and they survive a bot restart.

THE LIST IS DELIBERATELY DUMB. A name goes on when someone clicks and stays there. It is NOT
removed because that person went and waited in the server. An earlier version did that and the
owner hit it immediately: he clicked, went to warm up in game, and vanished off his own list.
Wanting to play and being in the server are the same intention, not opposites. Do not re-add
any rule that takes a name off because of where that person is.

Two messages, and they are NOT the same thing:
- **nudge** at `SEED_NUDGE_AT` (10). "10 people want to play! (10/45), click the button."
  Recruits the rest, so it fires once per round, early. Does NOT clear the list.
- **call** at `SEED_TARGET` (45). "45 of us want to play, get in." Clears the list, so the next
  round needs people who want THAT match.

They keep SEPARATE cooldowns (`seed_pings.kind`), because a nudge blocking the call it recruited
for is the obvious bug here and there is a test named after it. Nothing is sent when the server
isn't answering or when `playersOn >= target` (the match is already on).

`SEED_PLEDGE_MINUTES` is 180, not 45: collecting 45 clicks takes hours, and a short window means
the target is never reached. If the target is raised, raise this too.

Tables `seed_pledges` / `seed_pings` / `seed_credits` (who was on the list when a call fired —
see the leaderboard section; the call clears the list, so nothing else remembers).
Core routes `GET /internal/seed`,
`POST /internal/seed/pledge`, `POST /internal/seed/ping` (`{kind, force}`). Core, not the bot,
decides whether a message really goes out: the cooldown is enforced by the INSERT itself, so two
ticks landing together cannot ping twice.

Bot: `bot/src/seeding.js` keeps TWO messages in `#start-a-match`: the explainer picture
(`content/start-a-match.jpg`, kept in step by `ensureGuide`, matched on attachment name AND BYTE
SIZE) and the board below it (found again by its "Seeding board" footer), refreshed on a 15s beat and
on every click. The picture is posted by the seeding code rather than from `content/` as a normal
channel post, because `syncPosts` skips this channel and would otherwise delete the board. If the
picture has only just gone up, the board is reposted so it lands underneath it.

Matching on the file NAME alone is not enough and that was a real bug: the panel was redrawn, the
name did not change, so the old picture stayed up and the owner reported "the image looks the
same". The size is compared too, the way `syncPosts` tells its own pictures apart, and a picture
that no longer matches the file is deleted and reposted. Any redrawn guide picture reaches Discord
on the next deploy without anyone clearing the channel by hand.

The board leads with the SITUATION, not the mechanism: "Not enough people on to play?" Somebody
seeing the channel for the first time has to recognise their own problem before a button means
anything. There are tests on that wording, on the promise that a name stays on the list while you
go and do something else, and on what happens when the target is met. It lists EVERYONE on the
list, not a sample, because seeing your own name is the confirmation that the click worked; the
only cap is a safety net against Discord's 4096 character embed limit. The board drops its buttons
once `playersOn >= target` and shows the Server ID instead. `/seed` is the admin view, with
`call-now:True`, which skips the TARGET but never the cooldown.

**`SEED_TARGET` is only a fallback.** The target is read from the GAME SERVER's own
`MinimumRequiredPlayers` (`matchTarget` in api.js, cached 5 minutes), because the two numbers
have to agree: a server that starts a match at 20 while seeding calls people in at 45 means the
call-in announces something that already happened. Keeping a second copy guarantees they drift,
so there is no second copy. Change it with `/settings` and seeding follows, with no Railway
variable to remember. `SEED_TARGET` is used only when the server can't be asked, and `/seed` says
which of the two the number came from.

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

## Slash commands change under people

`guild.commands.set(commandDefinitions)` runs on every start, so adding or changing a command's
OPTIONS re-registers it. Discord clients cache the old definition and answer "This command is
outdated, please try again in a few minutes" until they refresh (Ctrl+R, or force-close on
mobile). It is not a bug and not worth debugging: it is the expected result of a deploy that
changed a command's shape, and it clears itself. Tell the owner to reload rather than going
looking for a cause.

## When nothing happens for a new player

`/healthcheck` (admin) walks the whole chain and names the broken link: core reachable, game
server answering, in-game private messages supported, every role the bot hands out, and who is on
the server right now with whether they are linked. `bot/src/health.js` holds the checks; they are
pure, so the interesting cases are tested without a Discord server.

Written because a friend of the owner joined and got nothing: no code, no team role, no commander
offer. Every step had failed safely into `console.warn`, which on Railway nobody reads.

Two things to know when this comes up again:

- **Commander offers only go to LINKED players** (`state.players.filter(p => p.discordId)`). So a
  failed `/verify` explains "no role AND no message AND no commander" all at once. Check
  verification first; the rest is downstream of it.
- **Discord refuses to let a bot hand out a role at or above its own highest role.** It is the
  commonest cause of a bot appearing to do nothing, it is invisible (setup looks fine, the
  assignment throws later), and dragging any role in the list is enough to cause it. `roleHealth`
  checks position for every role the bot assigns. Roles given out by hand (Admin, Moderator,
  Supporter) are deliberately NOT checked: the bot never touches them.

Role failures now reach `#admin-log` rather than the console: the commander grant (which was not
even wrapped in a try/catch, so it threw mid-grant and left someone thinking they were commander
with none of the access), the faction sync (latched, so it reports once per outage rather than
every 5 seconds), the `#roles` reaction menu (also latched) and the Verified role.

**`node tools/check-core-loop.mjs` walks the whole loop for real.** It starts the mock game server
and core over real HTTP with a real database, and drives the bot's real `CommanderManager`,
`FactionTracker` and `VerifiedRole`: join -> `/verify` -> a code actually whispered in game and
read back out of the mock -> `/confirm` -> Verified role -> team role -> commander offer ->
accept -> commander role -> the server told who is commanding. Only Discord is faked, because
there is no offline Discord. It also rehearses the two failures that actually happen: a role
above the bot (refused, reported, and nobody left recorded as commander) and a player whose
Discord DMs are closed.

**The DM goes out before the in-game whisper, on purpose.** Whether it arrived decides what the
whisper should say: "press Accept in your DMs" is useless to someone who cannot see the DM, and
an offer that times out because they never saw a button looks exactly like one they ignored.
`offerWhisper` is pure and tested; the admin-log line says the DM failed and suggests they turn
on direct messages from server members. Run it after touching
anything on that path; `npm test` stays fast and Discord-free, this is the deliberate one.

## Conventions

- Scope each session to one runnable thing and stop there.
- If the game server is unreachable, the bot changes nothing for OUTAGE_CLEAR_MIN (10) minutes, then clears team + commander roles once.
- Faction roles are mutually exclusive and fully bot-owned: every holder is tracked (linked or not) and loses it after LEAVE_GRACE_SEC off that side; at a match change, anyone absent loses it immediately (`tracker.dropAbsent`). Discord-only mode clears them all at start.
- Verified role (`bot/src/verified.js`, VERIFIED_ROLE_NAME): held by exactly the linked members. Given on /confirm and admin /link, removed on /unlink and /unlink-member, re-given when a linked member rejoins, and reconciled against `GET /internal/links` on startup. Created on startup if missing.
- Links are by SteamID; names are only used to find someone at /verify time. /verify also takes a SteamID64 or /profiles/ link to break name ties.
- Tests: `npm test` in `core/` and `bot/` (node:test, no Discord or DB needed).
