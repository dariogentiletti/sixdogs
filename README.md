# SIXDOGS bot

Faction-synced Discord roles and commander selection for a WARDOGS community server —
Step 4 of the setup runbook. What it does:

- **`/setup-server`** builds the Step 2 Discord layout for you: roles, categories, channels, and
  the listen-only faction voice channels (everyone hears, only the commander speaks).
- **`/verify`** links a Discord account to an in-game character by whispering a code in-game.
  Once linked, the member gets the **Verified** role (gold). Unlinking removes it.
- **Faction role sync**: factions are named by colour in Discord — **Blue** (Lonestar),
  **Red** (Valkyra), **Green** (Manticore). While you're on the server, you hold exactly one
  faction role — the one you're playing. Switch faction, the role switches. Leave, it drops after 60s.
  At match end, anyone who's already gone loses it straight away. Nobody keeps one without playing.
- **`#roles`**: one card with an emoji per role. React to get the role, remove your reaction
  to drop it; your reactions stay highlighted so you can see what you picked. Roles:
  🎖️ Commander, and the six WARDOGS classes 💥 Assault, 🩹 Medic, 🔭 Recon, 🔧 Support,
  🚙 Driver, 🚁 Pilot. The classes show on profiles and can be @mentioned ("@Pilot need a lift").
- **Commander selection**: people who want to command react 🎖️ in `#roles`, which gives them the
  **Commander Pool** role (or you give it to them). It's a continuous rule, not a one-off pick:
  whenever a faction has no commander, the bot offers the job to a pool member on that faction,
  or if there isn't one, to someone on it at random (people in the faction's voice channel first).
  The pick is messaged in-game and gets 60s to accept. Players joining, leaving and switching
  factions mid-match are all handled — see "How commanders are chosen" below.

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

1. Go to https://discord.com/developers/applications → **New Application** → name it `SIXDOGS`.
2. **Bot** tab → **Reset Token** → copy it. That's `DISCORD_TOKEN`. Treat it like a password.
3. Same tab → **Privileged Gateway Intents** → turn on **Server Members Intent** → Save.
4. **OAuth2 → URL Generator**: tick `bot` and `applications.commands`, then under Bot Permissions
   tick **Administrator**. Open the generated URL and add the bot to your server.
   (Administrator is needed for `/setup-server` to create the Admin role and lock channels down.
   Once setup is done you can swap it for: Manage Roles, Manage Channels, View Channels,
   Send Messages, Connect, Speak, Mute Members, Move Members.)
5. In Discord: User Settings → Advanced → turn on **Developer Mode**. Right-click your server
   icon → **Copy Server ID**. That's `DISCORD_GUILD_ID`.

## 2. Install Node.js (once)

Download the **LTS** version from https://nodejs.org and install it with the default options.
That's the only thing you need to install. The database is built in and lives in a `data`
folder that appears next to this README.

## 3. Fill in the settings

Make a copy of `.env.example` and name it `.env` (in File Explorer: View → Show → File name
extensions, so it doesn't end up as `.env.txt`). Open it in Notepad and fill in `DISCORD_TOKEN`
and `DISCORD_GUILD_ID`. Leave the rest for now.

## 4. Set up your Discord — no game server needed

Double-click **`start.bat`**. The first time it downloads a few things (a minute or so). With no
game server in `.env` yet, it runs in **Discord-only mode**; when you see
`registered 13 slash commands`, the bot is online. Keep the window open; closing it stops the bot.

Then in Discord:

1. `/setup-server` → creates the roles, channels and the `#roles` menu.
2. **Server Settings → Roles**: drag the bot's role **above** all the roles it created, otherwise
   it can't hand them out.

(Already ran it with the old Lonestar/Valkyra/Manticore names? Running it again renames those
roles and channels to Blue/Red/Green in place, adds `#roles`, and removes the old Commander Pool
button from `#op-signup`.)

**Operations are off for now.** This is a 24/7 server, so there are no scheduled ops yet: the
bot doesn't create the OPERATIONS channels or the Operator role, and if your server already has
the OPERATIONS category, it's hidden from everyone but admins (nothing is deleted). When you
start weekend events, put `OPERATIONS_ENABLED=true` in `.env`, restart, and run
`/setup-server` with `reapply-permissions` to bring it back.

**Who can do what.** On every start the bot sets every channel's permissions to this plan
(and creates anything missing), so you never have to fix them by hand:

| | Not verified | Verified | On a team (Blue/Red/Green) | That team's commander |
|---|---|---|---|---|
| INFO channels | read | read | read | read |
| `#get-verified` | type `/verify` (anything else is deleted) | same | same | same |
| `#general`, `#clips-screenshots` | read | write, react, post clips | same | same |
| 🔊 Command Lobby | see it, can't join | join and talk | same | same |
| 🔊 own team's `Command (listen)` | hidden | hidden | join, listen, watch the live map | talk |
| 🔊 other teams' channels | hidden | hidden | hidden | hidden |
| STAFF | hidden | hidden | hidden | hidden (Moderators see it) |

If someone loses the role that let them into a voice channel (teams reshuffle at a new
match, or they unlink), the bot moves them to the Command Lobby, or disconnects them if they
aren't allowed there either. **Admins see and join everything**: that's how Discord's
Administrator permission works and a channel can't block it, so test with a normal account.
The old **Member** role isn't used any more (Verified replaced it); you can delete it.

**Channel layout.** On every start the bot keeps INFO in this order: `#rules`, `#get-verified`,
`#how-to-play`, `#roles`, `#server-info`, `#support-the-community`, `#announcements`. It creates `#get-verified` and
`#how-to-play` if they're missing. All of them are read-only (only the bot posts there),
`#announcements` is for Admins, `#clips` becomes `#clips-screenshots`, and `#looking-for-squad`
is removed. Admins can still post anywhere: Discord's Administrator permission can't be blocked
per channel. In the faction voice channels, everyone on the team can watch Activities (the
wardogs.tech live map); only the commander can talk.

**Channel posts.** The bot fills `#rules`, `#get-verified`, `#how-to-play` and `#announcements`
from the files in the `content` folder (`rules.md` goes in `#rules`, and so on). The guides are
a series of wide pictures, one per message so Discord shows them full size (`verify-v1..v5.jpg`,
`play-h1..h5.jpg`, made by `design/verify-guide/build_panels.py`), followed by a short text card. To change a post, edit the file and restart the bot; it edits the existing
message, so nobody gets pinged. `{#roles}` in a file becomes a clickable link to `#roles`.

**Community facts: `community.json`.** One file holds the facts that appear in more than one
place: the web address and Discord invite, the founder letter, the donation platform and link,
the monthly costs and the Hardcore settings. The Discord posts fill in `{{...}}` from it when the
bot starts, and `design/verify-guide/build_panels.py` uses it for the Hardcore guide picture.
The website is built from it by Cloudflare: the project lives in the GitHub repo `sixdogs`, and
every push makes Cloudflare Pages run `node tools/build.mjs` and publish the `website` folder
(see `website/DEPLOY.md`). So: ask Claude to change something, Claude edits `community.json`,
saves it here and pushes; the site updates itself in about a minute. Your only manual step is
restarting the bot, which is what puts the new text in Discord.

**Support the community.** `#support-the-community` shows the founder letter, the monthly
running costs and a **Donate** button (Ko-fi for now: 0% fee on one-off donations; cards,
PayPal, Apple Pay and Google Pay from any country, no account needed). The button and the
website's donate button appear once `donate.url` in `community.json` has your link.

**Live board.** `#server-info` is one message the bot keeps up to date: online or offline, map,
match number, when it started or ends, points and the target score, players and free slots,
each team's players and commander, the top players this match, and how to join. It refreshes
every 5 minutes (`LIVE_BOARD_MINUTES`), and straight away when a match ends or a commander
changes. Times like "ends in 12 minutes" keep counting on everyone's screen between refreshes.
Buttons: open WARDOGS on Steam, How we play, Get verified.

Joining: WARDOGS has no direct-join links, and Discord buttons can only open web pages, so the
board shows the **Server ID** for the in-game *Community servers → Join by ID* box. It reads the
ID from the game server; if players need a different one, set `GAME_SERVER_ID` in `.env`.
`JOIN_URL` changes where the Steam button goes.

**Website live status.** The bot can also send the same summary to sixdogs.gg every 2 minutes
(through a small Cloudflare Worker at live.sixdogs.gg, see `website/DEPLOY.md` part 5). Only
public things leave your PC: map, clock, scores, team sizes, commanders' names and the top
players' in-game names. The website hides the section until fresh data arrives.

**Live map (Wardogs Tech).** A free, fan-made Discord Activity: a shared WARDOGS map people draw
on together inside a voice channel. An admin installs it once from https://wardogs.tech/add.
Commanders then open it from the Activities (rocket) button in their team's `Command (listen)`
channel, and everyone listening sees the arrows and markers live.

That's the Discord done. `#roles` works from now on — but only while `start.bat` is running,
since the bot hands out the roles. `/verify`, faction roles and commander picks wait for a game
server (step 6).

## 5. Optional: practice with a fake game server

Want to see verification, faction roles and commander picks before renting a server? Close
`start.bat` and double-click **`start-practice.bat`** instead. It runs the same bot plus a **fake
WARDOGS server** with nine made-up players (Rook, Vex, Mako, Juno, Tally, Birch, Cato, Pike,
Wren). Open **http://localhost:7776** in your browser to see who's on which faction, the in-game
messages the bot sends, and a button to start a new match.

1. `/verify Rook` → the code appears on the http://localhost:7776 page.
2. `/confirm 123456` (your code) → you get Rook's faction role within 5 seconds.
3. In `#roles`, react 🎖️ to join the Commander Pool.
4. Click **Start a new match** on the fake-server page. Factions reshuffle, so watch your role
   change. About 90s later you'll get a commander offer by DM. Accept it and you can speak.

Practice data is stored separately (`data-practice`), so none of it carries over to the real thing.

## 6. Going live

Two things must be true first (ask your host — see runbook Step 1):

- RCON is **enabled** and **reachable** from wherever this runs (not just 127.0.0.1).
- You have the RCON address, port and password.

Put them in `.env` as `RCON_URL` and `RCON_PASSWORD`, then restart **`start.bat`**
(or `node run.mjs` on Linux) — it switches from Discord-only to the full thing by itself. In the output you want `connected to WARDOGS RCON`.
`can't reach RCON yet` means a host/firewall problem, not a code problem.

It has to run somewhere that's always on — your PC works for trying it out on op nights, but
long-term that's a small VPS (~£4–6/month) or a community member's homelab. The same folder
and `node run.mjs` work there. (There's also a `docker-compose.yml` for people who like Docker;
you don't need it.)

**Then check the three unknowns** in `docs/wardogs-rcon.md` ("Gaps in the published schema")
against your real server. The bot recognises factions by the colour the server reports for them
(and by the names Lonestar/Valkyra/Manticore as a fallback), so this should just work. If it logs
`unknown faction string "…"`, add that string to `FACTION_ALIASES` in `.env`.

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

Everything the bot does is logged to `#admin-log`.

## Rules the bot follows

- Name and picture: on start the bot names itself `SIXDOGS` (change with `BOT_NAME` in `.env`)
  and uses `bot/assets/avatar.png` as its profile picture. Swap the image for another square
  PNG and restart to change it. Discord allows about 2 name changes per hour.

- `#roles`: every start, the bot refreshes the menu text in place (reactions are kept) and says
  so in the window: `[roles] … updated` or `[roles] … up to date`. If it can't, it prints why.
- Closing the window stops everything; no copy of the bot is left running in the background.

- Team roles (Blue/Red/Green) belong to the bot. Anyone holding one who isn't playing on that
  side loses it after 60s, linked or not, including roles given by hand or left over from
  practice mode. In Discord-only mode nobody has a team, so they're all removed at start.
- If the game server drops for a moment, nothing changes. If it's gone for 10 minutes
  (`OUTAGE_CLEAR_MIN`), team and commander roles are cleared and come back when it returns.
- Verification is tied to the Steam account (SteamID), not the name. Changing your Steam name
  doesn't unlink you; the bot just picks up the new name. If two people share a name, `/verify`
  asks for the Steam profile link instead, and the code only ever goes to that account in-game,
  so nobody can link as someone else by copying their name.
- **Verified** is given when someone links (`/confirm`, or an admin's `/link`) and removed when they unlink.
  On start the bot creates the role if it's missing and fixes anyone who has it wrong. Like the
  team roles, drag the bot's role above **Verified** so it can hand it out.
- Commander roles are cleared at every match end. The Commander Pool and class roles only
  change when someone reacts in `#roles` (or an admin changes them by hand). Reactions made
  while the bot was off are caught up when it starts.

## How commanders are chosen

Every 5 seconds, for each faction: **if there's no commander and nobody is being asked, ask someone.**

- **Who:** a Commander Pool member on that faction, the best rated first (random among ties).
  If nobody from the pool is there, anyone verified on it, at random.
- **When:** from 90s after a match starts (so people can load in), then any time the slot is empty.
- **Faction empty?** Nothing happens until someone joins it, then they're asked straight away.
- **How long do they keep it?** Until they `/standdown`, leave the server for more than 5
  minutes (`COMMANDER_AWAY_SEC`), or get moved to another faction. Being out of voice doesn't
  matter. If they were moved, they can be asked to command their new faction.
- **Someone doesn't answer or says no?** The next person is asked. They're skipped for a while
  (5 min for no answer, 15 min for "no" or `/standdown`), then can be asked again.
- **A pool member joins while someone else is commanding?** Nothing — a sitting commander is
  never bumped mid-fight.
- **Match ends?** All commander roles are cleared and it starts over.

## Post-match ratings

When a match ends, every commander who led for 5+ minutes gets rated by their own faction:

- Each player gets **one DM per match**, with a row of buttons for each commander they played
  under: 👍 Good calls (+1), 👎 Not great (−1), 🚫 Toxic (−3). Anonymous, changeable, open 30 minutes.
- You can only rate a commander if you were on that faction for 5+ minutes **while they were
  leading**. Joined late? You only rate whoever was in charge after you arrived.
- If a faction went through lots of commanders, only the 3 who led longest are rated.
- Every match has a number (#1, #2, ...) kept in the bot's database in the `data` folder, along
  with who played where, every commander change and every vote. Practice mode has its own.
- Each match counts for at most +3 or −3, so one full lobby or one angry group can't swing a
  score on its own. Only the last 60 days count.
- When voting closes, the commander gets a DM with their totals and new score.
- Three or more 🚫 in one match posts an alert in `#admin-log`.
- Commander picks use the score: within the pool, **highest score** first.
  New commanders start at 0, so they rank above people with bad ratings.
- `/rating` shows your own score; admins can check anyone with `/rating @member`.

It needs the game server (it knows who played where from the match data), so it's inactive in
Discord-only mode.

## Working on it with Claude Code

`CLAUDE.md` holds the WARDOGS API rules so Claude Code doesn't invent endpoints. Keep each session
to one change. Tests: `cd core && npm install && npm test`, same for `bot`.
