# SIXDOGS bot

Faction-synced Discord roles and commander selection for a WARDOGS community server.

- **`/setup-server`** builds the whole Discord layout: roles, categories, channels, and the
  listen-only faction voice channels (everyone hears, only the commander speaks).
- **`/verify`** links a Discord account to an in-game character by whispering a code in-game.
  Once linked, the member gets the **Verified** role (gold). Unlinking removes it.
- **Faction role sync**: factions are named by colour in Discord — **Blue** (Lonestar),
  **Red** (Valkyra), **Green** (Manticore). While you're on the server you hold exactly one
  faction role, the one you're playing. Switch faction, the role switches. Leave, it drops after
  60s. At match end, anyone already gone loses it straight away.
- **`#roles`**: one card with an emoji per role. React to get it, remove your reaction to drop
  it. Roles: 🎖️ Commander, and the six WARDOGS classes 💥 Assault, 🩹 Medic, 🔭 Recon,
  🔧 Support, 🚙 Driver, 🚁 Pilot. The classes show on profiles and can be @mentioned.
- **Commander selection**: a continuous rule, not a one-off pick. Whenever a faction has no
  commander, the bot offers the job to a Commander Pool member on that faction, or to someone on
  it at random. See "How commanders are chosen" below.

```
 WARDOGS server ──RCON (HTTP)──▶ core ──▶ Postgres
                                   ▲
                                   │ internal API (private)
                                   │
                    Discord ◀──── bot
```

The RCON password lives only in `core`. The bot can't touch the game server except through core.

---

## 1. Create the Discord bot (10 minutes, once)

1. https://discord.com/developers/applications → **New Application** → name it `SIXDOGS`.
2. **Bot** tab → **Reset Token** → copy it. That's `DISCORD_TOKEN`. Treat it like a password.
3. Same tab → **Privileged Gateway Intents** → turn on **Server Members Intent** → Save.
4. **OAuth2 → URL Generator**: tick `bot` and `applications.commands`, then under Bot Permissions
   tick **Administrator**. Open the generated URL and add the bot to your server.
   (Administrator is needed for `/setup-server` to create the Admin role and lock channels down.)
5. In Discord: User Settings → Advanced → turn on **Developer Mode**. Right-click your server
   icon → **Copy Server ID**. That's `DISCORD_GUILD_ID`.

## 2. Put it online

The bot runs on Railway. **[deploy/RAILWAY.md](deploy/RAILWAY.md)** is the walkthrough: make the
project, add a Postgres database, paste in the two Discord settings above, and it starts.

There is nothing to install and no server to log into. Once it is running it stays running, and
every change pushed to GitHub `main` redeploys it by itself.

You want `registered 20 slash commands` in the Railway deployment log.

## 3. Set up your Discord

With the bot online, in Discord:

1. `/setup-server` → creates the roles, channels and the `#roles` menu.
2. **Server Settings → Roles**: drag the bot's role **above** all the roles it created,
   otherwise it can't hand them out.

With no game server configured yet the bot runs in **Discord-only mode**: `#roles`, the channel
posts and the admin commands all work. `/verify`, faction roles and commander picks wait for a
game server (section 4).

**Operations are off for now.** This is a 24/7 server, so there are no scheduled ops: the bot
doesn't create the OPERATIONS channels or the Operator role, and an existing OPERATIONS category
is hidden from everyone but admins (nothing is deleted). To bring it back, set
`OPERATIONS_ENABLED=true` and run `/setup-server` with `reapply-permissions`.

**Who can do what.** On every start the bot sets every channel's permissions to this plan (and
creates anything missing), so you never have to fix them by hand:

| | Not verified | Verified | On a team (Blue/Red/Green) | That team's commander |
|---|---|---|---|---|
| INFO channels | read | read | read | read |
| `#get-verified` | type `/verify` (anything else is deleted) | same | same | same |
| `#general`, `#clips-screenshots` | read | write, react, post clips | same | same |
| 🔊 Command Lobby | see it, can't join | join and talk | same | same |
| 🔊 own team's `Command (listen)` | hidden | hidden | join, listen, watch the live map | talk |
| 🔊 other teams' channels | hidden | hidden | hidden | hidden |
| STAFF | hidden | hidden | hidden | hidden (Moderators see it) |

If someone loses the role that let them into a voice channel, the bot moves them to the Command
Lobby, or disconnects them if they aren't allowed there either. **Admins see and join
everything**: that's how Discord's Administrator permission works and a channel can't block it,
so test with a normal account.

**Channel layout.** On every start the bot keeps INFO in this order: `#rules`, `#get-verified`,
`#how-to-play`, `#roles`, `#server-info`, `#support-the-community`, `#announcements`. All are
read-only (only the bot posts), `#announcements` is Admin-only, `#clips` becomes
`#clips-screenshots`, and `#looking-for-squad` is removed. In the faction voice channels everyone
on the team can watch Activities (the wardogs.tech live map); only the commander can talk.

**Channel posts.** The bot fills `#rules`, `#get-verified`, `#how-to-play` and `#announcements`
from the files in `content/` (`rules.md` goes in `#rules`, and so on). The guides are wide
pictures, one per message so Discord shows them full size (`verify-v1..v5.jpg`, `play-h1..h5.jpg`,
made by `design/verify-guide/build_panels.py`), followed by a short text card. Changing a post
edits the existing message, so nobody gets pinged. `{#roles}` becomes a clickable channel link.

**Community facts: `community.json`.** One file holds the facts that appear in more than one
place: the web address and Discord invite, the founder letter, the donation platform and link,
the monthly costs and the Hardcore settings. The Discord posts fill in `{{...}}` from it, and
`design/verify-guide/build_panels.py` uses it for the Hardcore guide picture. The website is
built from it too. Ask Claude to change something and it edits `community.json` and pushes; the
site and the bot both update themselves.

**Live board.** `#server-info` is one message the bot keeps up to date: online or offline, map,
match number, when it started or ends, points and target score, players and free slots, each
team's players and commander, the top players this match, and how to join. It refreshes every 5
minutes (`LIVE_BOARD_MINUTES`) and straight away when a match ends or a commander changes.

Joining: WARDOGS has no direct-join links and Discord buttons can only open web pages, so the
board shows the **Server ID** for the in-game *Community servers → Join by ID* box. It reads the
ID from the game server; override it with `GAME_SERVER_ID`. `JOIN_URL` changes where the Steam
button goes.

**Website live status.** The bot can send the same summary to sixdogs.gg every 2 minutes, through
a small Cloudflare Worker at live.sixdogs.gg (see `website/DEPLOY.md`). Only public things are
sent: map, clock, scores, team sizes, commanders' names and the top players' in-game names. No
Discord IDs. The website hides the section until fresh data arrives.

**Live map (Wardogs Tech).** A free, fan-made Discord Activity: a shared WARDOGS map people draw
on together inside a voice channel. An admin installs it once from https://wardogs.tech/add.
Commanders open it from the Activities (rocket) button in their team's `Command (listen)`
channel, and everyone listening sees the arrows and markers live.

## 4. Adding the game server

Two things must be true first (ask your host):

- RCON is **enabled** and **reachable** from outside the game server. It ships disabled and bound
  to `127.0.0.1` only.
- You have the RCON address, port and password.

Add them as `RCON_URL` and `RCON_PASSWORD` (on Railway: the service's Variables tab). The bot
restarts itself and switches from Discord-only to the full thing. You want `connected to WARDOGS
RCON` in the log. `can't reach RCON yet` is a host or firewall problem, not a code problem.

The RCON listener is plain HTTP. Keep `http://`; an `https://` address is refused, not corrected.

**Then check the three unknowns** in `docs/wardogs-rcon.md` ("Gaps in the published schema")
against your real server. The bot recognises factions by the colour the server reports for them
(and by the names Lonestar/Valkyra/Manticore as a fallback), so this should just work. If it logs
`unknown faction string "…"`, add that string to `FACTION_ALIASES`.

## Commands

| Who | Command | What |
|---|---|---|
| Everyone | `/verify <in-game name>` | Sends a code to you in-game (you must be on the server). Same name as someone else? Use your Steam profile link instead |
| | `/confirm <code>` | Finishes linking |
| | `/whoami`, `/unlink` | Check / remove your link |
| | *(react in #roles)* | Pick Commander and/or classes; remove the reaction to drop one |
| | `/commanders` | Who's commanding this match |
| | `/rating` | Your commander score (admins: `/rating @member`) |
| | *(DM after a match)* | Rate your commander: 👍 / 👎 / 🚫 |
| | `/accept` | Accept a commander offer (or use the DM button) |
| | `/standdown` | Stop commanding; someone else is picked |
| | `/claim` | Take command if nobody was picked (e.g. everyone passed) |
| Admin | `/reroll <faction>` | Replace the current commander |
| | `/link @member <steamid>` / `/unlink-member @member` | Manual link fixes |
| | `/setup-server [reapply-permissions]` | Build (or repair) the server layout |
| | `/say <message>` | Announce something to everyone in-game |
| | `/tell <player> <message>` | Private in-game message to one player |
| | `/kick <player> [reason]` | Kick someone off the game server |
| | `/move <player> <faction>` | Move someone to another team |
| | `/endmatch confirm:True` | End the match now |
| | `/server` | What the game server reports, and what it lets the bot do |
| | `/settings [section]` | Read the game server's settings document |

The last seven need a game server. Each one is checked against what your server
build actually supports first, so an action it can't do comes back as a
sentence saying so rather than a failure. `/server` lists which are available.

Everything the bot does is logged to `#admin-log`.

## Rules the bot follows

- Name and picture: on start the bot names itself `SIXDOGS` (change with `BOT_NAME`) and uses
  `bot/assets/avatar.png` as its profile picture. Swap the image for another square PNG to change
  it. Discord allows about 2 name changes per hour.
- `#roles`: every start the bot refreshes the menu text in place (reactions are kept). Reactions
  made while the bot was off are caught up when it starts.
- Team roles (Blue/Red/Green) belong to the bot. Anyone holding one who isn't playing on that
  side loses it after 60s, linked or not, including roles given by hand. In Discord-only mode
  nobody has a team, so they're all removed at start.
- If the game server drops for a moment, nothing changes. If it's gone for 10 minutes
  (`OUTAGE_CLEAR_MIN`), team and commander roles are cleared and come back when it returns.
- Verification is tied to the Steam account (SteamID), not the name. Changing your Steam name
  doesn't unlink you. If two people share a name, `/verify` asks for the Steam profile link
  instead, and the code only ever goes to that account in-game, so nobody can link as someone
  else by copying their name.
- **Verified** is given when someone links (`/confirm`, or an admin's `/link`) and removed when
  they unlink. On start the bot creates the role if missing and fixes anyone who has it wrong.
  Drag the bot's role above **Verified** so it can hand it out.
- Commander roles are cleared at every match end. **A restart is not a match end**: if the bot
  restarts mid-match, the sitting commanders keep their roles.
- The Commander Pool and class roles only change when someone reacts in `#roles` (or an admin
  changes them by hand).

## How commanders are chosen

Every 5 seconds, for each faction: **if there's no commander and nobody is being asked, ask someone.**

- **Who:** a Commander Pool member on that faction, best rated first (random among ties). If
  nobody from the pool is there, anyone verified on it, at random.
- **When:** from 90s after a match starts (so people can load in), then any time the slot is empty.
- **Faction empty?** Nothing happens until someone joins it, then they're asked straight away.
- **How long do they keep it?** Until they `/standdown`, leave the server for more than 5 minutes
  (`COMMANDER_AWAY_SEC`), or get moved to another faction. Being out of voice doesn't matter.
- **Someone doesn't answer or says no?** The next person is asked. They're skipped for a while
  (5 min for no answer, 15 min for "no" or `/standdown`), then can be asked again.
- **A pool member joins while someone else is commanding?** Nothing. A sitting commander is never
  bumped mid-fight.
- **Match ends?** All commander roles are cleared and it starts over.

## Post-match ratings

When a match ends, every commander who led for 5+ minutes gets rated by their own faction:

- Each player gets **one DM per match**, with a row of buttons for each commander they played
  under: 👍 Good calls (+1), 👎 Not great (−1), 🚫 Toxic (−3). Anonymous, changeable, open 30
  minutes.
- You can only rate a commander if you were on that faction for 5+ minutes **while they were
  leading**. Joined late? You only rate whoever was in charge after you arrived.
- If a faction went through lots of commanders, only the 3 who led longest are rated.
- Every match has a number (#1, #2, ...) kept in the database, along with who played where, every
  commander change and every vote.
- Each match counts for at most +3 or −3, so one full lobby or one angry group can't swing a
  score on its own. Only the last 60 days count.
- When voting closes, the commander gets a DM with their totals and new score.
- Three or more 🚫 in one match posts an alert in `#admin-log`.
- Commander picks use the score: within the pool, **highest score** first. New commanders start
  at 0, so they rank above people with bad ratings.
- `/rating` shows your own score; admins can check anyone with `/rating @member`.

It needs the game server (it knows who played where from the match data), so it's inactive in
Discord-only mode.

## Settings

Every setting, with its default and what it does, is in **`.env.example`**. On Railway those
names go in the service's Variables tab instead of a file; only `DISCORD_TOKEN`,
`DISCORD_GUILD_ID` and `DATABASE_URL` are needed to start.

## Working on it

Ask Claude. It edits the project, pushes to GitHub `main`, and both the bot and the website
update themselves. `CLAUDE.md` holds the WARDOGS API rules so Claude doesn't invent endpoints.

Running it locally (Claude does this to test changes):

```
node run.mjs            # needs a .env file
node run.mjs --mock     # fake WARDOGS server with nine made-up players,
                        # control page on http://localhost:7776
npm test                # both test suites
```

Practice mode keeps its data separately (`data-practice`), so none of it reaches the real thing.
