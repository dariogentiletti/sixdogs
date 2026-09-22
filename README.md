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

You want `registered 31 slash commands` in the Railway deployment log.

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
`#how-to-play`, `#roles`, `#server-info`, `#start-a-match`, `#support-the-community`,
`#announcements`. All are
read-only (only the bot posts), `#announcements` is Admin-only, `#clips` becomes
`#clips-screenshots`, and `#looking-for-squad` is removed. In the faction voice channels everyone
on the team can watch Activities (the wardogs.tech live map); only the commander can talk.

**#leaderboard sits in COMMUNITY**, not INFO: it is something to come back for rather than a
notice you read once, so it belongs with the places people hang around in. It is still read-only.
The board is one message the bot finds again by its footer in the last 50 messages of the channel,
so people chatting over it would bury it and end up with two boards.

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

The **leaderboard** rides along in the same push, so there is one endpoint, one token and one
thing that can be stale. It is history rather than a live reading, so it keeps being sent while
the game server is down, and the site shows it for up to 24 hours rather than the live board's 10
minutes. Commanders and match-starters are looked up to their Discord display names before the
payload leaves; the ids are dropped, same as everywhere else here.

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

> **"This command is outdated, please try again in a few minutes"?** That's Discord's client
> cache, not a broken bot. It shows up when a command gains or loses options and your Discord
> is still holding the old version. Press **Ctrl+R** (Cmd+R on Mac) to reload Discord, or
> force-close the mobile app. It also clears by itself after a few minutes. Seeing it is
> actually a sign the new code deployed.


| Who | Command | What |
|---|---|---|
| Everyone | `/verify <in-game name>` | Sends a code to you in-game (you must be on the server). Same name as someone else? Use your Steam profile link instead |
| | `/confirm <code>` | Finishes linking |
| | `/whoami`, `/unlink` | Check / remove your link |
| | *(react in #roles)* | Pick Commander, Match Alerts and/or classes; remove the reaction to drop one |
| | *(buttons in #start-a-match)* | Say you'd play right now, or take your name off |
| | `/commanders` | Who's commanding this match |
| | `/rating` | Your commander score (admins: `/rating @member`) |
| | *(DM after a match)* | Rate your commander: 👍 / 👎 / 🚫 |
| | `/accept` | Accept a commander offer (or use the DM button) |
| | `/standdown` | Stop commanding; someone else is picked |
| | `/claim` | Take command if nobody was picked (e.g. everyone passed) |
| Admin | `/seed [call-now]` | Who's ready to play, why nobody's been called in yet, or call them in now |
| | `/set-commander <faction> [@member]` | Put someone in command. Leave the member out and the bot picks someone new at random |
| | `/link @member <steamid>` / `/unlink-member @member` | Manual link fixes |
| | `/setup-server [reapply-permissions]` | Build (or repair) the server layout |
| | `/say <message>` | Announce something to everyone in-game |
| | `/tell <player> <message>` | Private in-game message to one player |
| | `/kick <player> [reason]` | Kick someone off the game server |
| | `/move <player> <faction>` | Move someone to another team |
| | `/endmatch confirm:True` | End the match now |
| | `/server` | What the game server reports, and what it lets the bot do |
| | `/healthcheck` | Can a new player verify and get their roles? Names the broken link if not |
| | `/settings [section]` | Read the game server's settings document |
| | `/settings find:<text>` | Search every section for a setting by name |
| | `/settings section: key: value: [confirm]` | Change one setting. Shows the before/after and saves nothing until `confirm:True` |
| | `/reserved` | Who holds a reserved slot, by Discord member |
| | `/reserved grant:@member` / `revoke:@member` | Give or take back a donor's reserved slot. Shows the change first; saves on `confirm:True` |
| | `/map <map> [lighting]` | Change the map now. Both boxes offer the server's own lists |
| | `/lighting <lighting>` | Change the time of day without changing the map |
| | `/restart confirm:True` | Restart the current match |
| | `/ban <player> [reason]` / `/unban <steamid>` / `/bans` | Ban list on the game server |

That's the whole list: 29 commands, and nothing hidden. Anything that acts on
the game is checked against what your server build actually supports first, so
an action it can't do comes back as a sentence saying so rather than a failure.
`/server` lists which are available.

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

## Getting a match going

A 24/7 server with nobody on it stays that way: nobody wants to be the first one on an empty map,
and sitting there AFK waiting for company is nobody's idea of an evening.

So in `#start-a-match` the bot keeps a board with an **I want to play** button. Click it and your
name goes on the list. **It stays there**, whether you go and warm up in the server or go and do
something else. Wanting to play and being in the server aren't opposites.

Two things come out of that list, and they're not the same:

- **A heads-up at 10.** `@Match Alerts` gets one message: "10 people want to play! (10/45), click
  the button if you do too." Its job is to recruit the other 35, so it fires once per round and
  leaves the list alone.
- **The call-in at 45.** "45 of us want to play, get in." That's three teams of fifteen, which is
  a real match. This one empties the list, so the next round needs people who want *that* match.

The two keep separate cooldowns, so the recruiting message can never hold back the match it
recruited for.

- **Who gets pinged:** only the **Match Alerts** role, which you take yourself with 📣 in `#roles`.
  The bot never uses `@everyone`.
- **How often:** each kind of message at most once every 45 minutes (`SEED_COOLDOWN_MINUTES`).
- **Your name comes off** by itself after 3 hours (`SEED_PLEDGE_MINUTES`). It's long on purpose:
  collecting 45 clicks takes a while, and a short window means the target is never reached.
- **Nothing is sent** once the match is running, or when the game server isn't answering. Calling
  people to a black screen is how you lose them.
- **Once the match is on the buttons disappear** and the board shows the Server ID instead.
- **Admins:** `/seed` says how many want in and, if nothing has been sent, exactly why.
  `/seed call-now:True` calls everyone in without waiting for 45. It still respects the cooldown:
  the promise to everyone holding the ping role is that it can't go off twice in a row.

**The number comes from the game server itself**, not from a setting here. Seeding reads the
server's own match-start threshold, so the two can never disagree. Change it with `/settings` and
seeding follows, with no variable to remember. `SEED_TARGET` is only used if the server can't be
asked, and `/seed` tells you which of the two the number came from.

Pick that number for your Discord, not for the server's 100 slots: a threshold nobody can reach
on a quiet evening means no matches start at all.

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

## Leaderboard

One message the bot keeps in `#leaderboard`, and the same boards on sixdogs.gg under the live
tracker. Eight short lists over the last 30 days, not one blended score: a single number out of
ten is impossible to argue with and impossible to chase, because nobody can tell what to do
differently about it.

**What the game actually gives us is the whole constraint here.** `/v1/players` returns a name, a
SteamID, a faction, kills, deaths, cash and a ping, and nothing else. There are no supply
deliveries, no zone captures, no revives, and no events of any kind, so nothing on here claims to
count them. What we do have is a poll every five seconds, written down, which lets the strategic
boards be worked out from how the numbers move rather than read off a field:

| Board | What it means |
|---|---|
| **Kills** | Most kills. Turning up counts. |
| **Kill / death** | Best ratio, with 20+ minutes played behind it |
| **Stayed alive** | Deaths per 10 minutes, fewest first. Holding a position rather than pushing alone |
| **Ground held** | How fast your side's objective score climbed while you were on the field. A **team** number: everyone out there shares it, and the board says so |
| **Swing** | How much faster your side scored with you on than without you. The individual one |
| **Commanders** | Their post-match rating, from the section above |
| **Time on the server** | The people who actually keep it alive |
| **Got matches going** | How many matches started because they put their name down in `#start-a-match` while the server was quiet |

Two of those are worth explaining properly.

**Swing** is the honest way to get an individual number out of team data. Everyone on the field at
the same moment shares the same objective score, so the only thing that separates two players is
how their side did while they were *not* on. Somebody whose team scores 5/min with them and 2/min
without them is +3. It needs both on-field and off-field time in the same match, so it stays empty
until people come and go — and when there is nothing to compare against there is **no number**,
not a zero. Calling it zero would flatter or punish people depending on how their team happened to
do without them.

**Got matches going** is the only board the game cannot see, and on a server this size it is the
one that matters most. A quiet server stays quiet unless somebody says they want a game, so
everyone on the seeding list when a call-in goes out is credited with that match. It needs no
minutes played at all: the whole point is that it counts what you did while you were *not* in the
server.

Kills and deaths reset each match on this build, so a total is the sum of per-match peaks. `cash`
is a persistent wallet and nobody has confirmed what moves it, so it is collected but **not
ranked**. Rate boards need `LEADERBOARD_MIN_MINUTES` (20) behind them, or one lucky ten minutes
tops a table forever.

## Reserved slots for donors

The donation page promises a reserved slot to anyone giving $10 or more. There are six, and they
live inside the game server's settings rather than behind a switch, so the bot edits that
document to grant one.

- `/reserved` lists who holds one, **by Discord member** rather than by SteamID.
- `/reserved grant:@member` gives one out. They have to have run `/verify` first, because the
  slot is tied to their WARDOGS account and the link is what knows which account that is.
- `/reserved revoke:@member` takes it back, freeing the slot for the next donor.

Both show you the change and save nothing until you add `confirm:True`, and both refuse to go
past the six the server allows. Nothing is ever granted by typing a SteamID: a mistyped one would
hand a paid slot to a stranger.

## Announcements

`content/announcements.md` is the latest announcement, and `#announcements` is append only. Change
that file and the bot posts it as a **new message** next time it starts, leaving the older ones
above it as history. It never edits one: an edit notifies nobody and would slip the news in above
messages people have already read.

Two things to keep to when you write one:

- **Replace the whole file**, don't add to it. What's in there is what gets posted.
- **Put the date in the title**, written out by hand, e.g. `# What's new: 21 September 2026`. That
  is how people tell what's actually new. Don't make it generate itself, or the bot would post the
  same announcement again every time it restarts.

If you change nothing, nothing is posted.

## Checking the core loop

`node tools/check-core-loop.mjs` walks the whole new-player path against a fake game server:
join, `/verify`, the code arriving in game, `/confirm`, the Verified role, the team role, being
offered command and taking it. It uses the real code for all of it, so if this passes the loop
itself works and anything still wrong is in the live setup (roles, permissions, the game server).

It also rehearses the commonest failure, a role positioned above the bot's own, and checks that
it is refused loudly rather than silently.

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
