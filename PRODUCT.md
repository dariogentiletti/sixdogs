# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
WARDOGS players who join the SIXDOGS community server, usually for the first time. They arrive through Discord, often on a phone, and want to get into a match with minimal setup. Secondary: SIXDOGS admins, who run the bot and edit its posts.

## Product Purpose
SIXDOGS is a WARDOGS community (Discord plus a 24/7 game server) built around playing as a team. A Discord bot links each member's Discord to their Steam account, gives them their live team colour role, picks a commander per faction and runs post-match commander ratings. Success: new players get verified in one go and end up in their faction's voice channel listening to their commander.

## Positioning
Every faction has one commander, the only voice in the faction's listen channel, chosen by the bot from a pool and rated by their own side after each match. Public WARDOGS servers leave squads to play their own game.

## Operating Context
- Discord server with locked info channels (#rules, #roles, #server-info, #announcements), a #roles reaction menu, and per-faction "X Command (listen)" voice channels.
- Verification: be on the game server, `/verify <in-game name>` in Discord, receive a short numeric code as an in-game private message (valid 10 minutes), `/confirm <code>`. Duplicate names are resolved with a Steam profile link or SteamID. Links are by SteamID; Steam name changes do not unlink.
- Factions are named by colour in Discord: Blue (Lonestar), Red (Valkyra), Green (Manticore).
- Channel posts are Discord embeds generated from `content/*.md`; guides are shared as images in channels.

## Capabilities and Constraints
- Verified players get their faction role automatically, which unlocks that faction's listen channel.
- Commander Pool role via 🎖️ in #roles; the bot offers command to pool members first.
- After each match, players who served under a commander 5+ minutes get a DM to rate them (good / poor / toxic).
- Server policy (owner-stated): players who are not verified on Discord get kicked from the game server. OPEN: the bot does not enforce this yet (the RCON API has a kick endpoint).
- Game server address is not public yet (TBD).
- The game server runs WARDOGS Hardcore mode: no kill cam, reduced HUD, first-person-only vehicles, destruction on (list in community.json). The mortar shell camera cannot be turned off by server settings (Sept 2026).

## Brand Commitments
- Name: SIXDOGS. Logo: a square "6" drawn in the style of the WARDOGS lettering, dark on gold #c9a227 (`design/logo/`, avatar at `bot/assets/avatar.png`).
- Server gold #c9a227 must appear in visual work.
- Web address: sixdogs.gg (Namecheap), redirects to the permanent Discord invite.
- Faction colours: Blue #3a7bd5, Red #d13b3b, Green #3aa655.
- Voice: plain, warm, direct. No em dashes, no stock AI phrasing, not corporate or overly polite.

## Evidence on Hand
- Real bot copy (verify/confirm replies, in-game code message) in `bot/src/commands.js` and `core/src/verify.js`.
- No real screenshots of the WARDOGS in-game message UI yet; mockups of it are illustrative.
- No player counts, testimonials or server stats exist; do not invent them.

## Product Principles
- Teamwork over solo play: everything points toward one faction, one commander, one plan.
- Setup must be quick and hard to get wrong; one-time, one minute.
- Say it plainly. Players should understand each step without reading twice.
- Fair by design: anonymous ratings, commanders earn their spot.
