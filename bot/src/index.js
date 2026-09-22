import { Client, Events, GatewayIntentBits, MessageFlags, Partials } from 'discord.js';
import { loadConfig } from './config.js';
import { CoreClient, CoreError } from './core-client.js';
import { FACTIONS, factionKeyFor } from './factions.js';
import { FactionTracker } from './tracker.js';
import { VerifiedRole } from './verified.js';
import { LiveBoard } from './liveboard.js';
import { Leaderboard } from './leaderboard.js';
import { WebStatus } from './webstatus.js';
import { checkVoice, tidyGetVerified } from './guard.js';
import { CommanderManager } from './commander.js';
import { commandDefinitions, makeAutocomplete, makeHandlers } from './commands.js';
import { ensureRoleMenu, entryForEmoji, isMenuMessage, reconcileRoleMenu } from './rolemenu.js';
import { applyOperationsVisibility, enforceLayout } from './setup.js';
import { syncPosts } from './posts.js';
import { Ratings } from './ratings.js';
import { Seeding } from './seeding.js';
import { applyIdentity } from './identity.js';

// Started by run.mjs: exit when it does, so closing the window never leaves an old bot running.
if (process.env.SIXDOGS_SUPERVISED === '1') {
  process.stdin.on('end', () => process.exit(0));
  process.stdin.on('close', () => process.exit(0));
  process.stdin.resume();
}

const config = loadConfig();
const core = new CoreClient({ baseUrl: config.coreUrl, token: config.internalToken, disabled: config.coreDisabled });
const tracker = new FactionTracker({ graceMs: config.leaveGraceSec * 1000 });

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,     // privileged: turn on "Server Members Intent" in the developer portal
    GatewayIntentBits.GuildVoiceStates, // who's sitting in which voice channel
    GatewayIntentBits.GuildMessageReactions, // the #roles reaction menu
    GatewayIntentBits.GuildMessages,    // to keep #get-verified clean (no message content needed)
  ],
  // Reactions on messages posted before the bot started arrive as "partials".
  partials: [Partials.Message, Partials.Channel, Partials.Reaction, Partials.User],
});

let guild = null;
let logChannel = null;
async function log(text) {
  console.log('[log]', text.replace(/\*\*/g, ''));
  await logChannel?.send({ content: text, allowedMentions: { parse: [] } }).catch(() => {});
}

const commanders = new CommanderManager({ core, config, log });
const ratings = new Ratings({ core, config, log });
const seeding = new Seeding({ core, config, log });
const verified = new VerifiedRole({ roleName: config.verifiedRoleName, onError: (text) => log(text) });
const board = new LiveBoard({ core, commanders, config });
const leaderboard = new Leaderboard({ core, config });
const web = new WebStatus({ core, commanders, config });
const handlers = makeHandlers({ core, commanders, ratings, seeding, config, log, verified });
const autocomplete = makeAutocomplete({ core });

// ---------------------------------------------------------------------------
// Faction role sync
// ---------------------------------------------------------------------------

const factionRoles = () => new Map(FACTIONS.map((f) => [f.key, guild.roles.cache.find((r) => r.name === f.roleName)]));
const unknownFactionStrings = new Set();
let lastMatchId = null;
let lastCoreError = null;
let syncing = false;
let lastCmdSig = null;
let roleTroubleLogged = false;  // so a broken role list is reported once, not every 5s
let menuTroubleLogged = false;  // same, for the #roles reaction menu
let outageSince = null;   // when we lost game data (core or game server unreachable)
let outageCleared = false;

/** Remove every faction role from everyone. Returns how many members changed. */
async function clearFactionRoles(reason) {
  let n = 0;
  for (const [, role] of factionRoles()) {
    for (const member of role?.members.values() ?? []) {
      await member.roles.remove(role, `SIXDOGS: ${reason}`).then(() => n++, (err) =>
        console.warn(`[sync] couldn't remove ${role.name} from ${member.user.tag}: ${err.message}`));
    }
  }
  tracker.reset();
  return n;
}

/** Short hiccups change nothing. A long outage clears team roles, since nobody can be sure who's where. */
async function noteOutage(now = Date.now()) {
  outageSince ??= now;
  if (outageCleared || now - outageSince < config.outageClearMin * 60_000) return;
  outageCleared = true;
  const n = await clearFactionRoles('game server offline');
  await commanders.clearAllRoles();
  await log(`⚠️ No game data for ${config.outageClearMin} min. Cleared team roles (${n}). They come back when the server does.`);
}

async function syncOnce() {
  if (syncing || !guild || config.coreDisabled) return;
  syncing = true;
  try {
    let state;
    try {
      state = await core.state();
    } catch (err) {
      if (lastCoreError !== err.message) console.warn('[sync] core:', err.message);
      lastCoreError = err.message;
      await noteOutage();
      return;
    }
    lastCoreError = null;

    // The seeding board reads the same core state, outage or not: when the game
    // server is down it says so rather than quietly collecting names for a
    // server nobody can join. Not awaited — it must never hold up role syncing.
    seeding.tick(state).catch((err) => console.warn(`[seed] ${err.message}`));

    // Game server unreachable: change nothing for a while. Stripping everyone's
    // roles because the host hiccuped would be worse than a stale role. After
    // OUTAGE_CLEAR_MIN minutes, team roles are cleared (see noteOutage).
    if (!state.ok) { await noteOutage(); return; }
    outageSince = null;
    outageCleared = false;

    // Faction roles belong to the bot. Anyone holding one gets tracked, so it
    // comes off if they're not actually playing on that side (hand-given roles,
    // leftovers from practice mode, people who unlinked).
    const now = Date.now();
    for (const [key, role] of factionRoles()) {
      for (const m of role?.members.values() ?? []) if (!tracker.has(m.id)) tracker.seed(m.id, key, now);
    }

    if (state.matchId !== lastMatchId) {
      const firstSeen = lastMatchId === null;
      const endedMatch = lastMatchId;
      lastMatchId = state.matchId;
      // Anyone who isn't on the server loses their team role right away; the
      // rest switch as soon as the server puts them on their new side.
      tracker.dropAbsent(new Set(state.players.map((p) => p.discordId).filter(Boolean)));
      await commanders.onMatchChange(state.matchId, { firstSeen });
      if (!firstSeen) board.update();
      // A match just ended: ask each faction to rate its commander(s).
      if (!firstSeen && endedMatch) {
        ratings.openForMatch(endedMatch, state.status?.factionScores)
          .catch((err) => console.warn(`[ratings] couldn't open voting for match #${endedMatch}: ${err.message}`));
      }
    }

    // Commander picks prefer the best-rated people.
    const scores = await ratings.scores();
    commanders.scoreOf = (id) => scores[id]?.score ?? 0;

    const linked = state.players
      .filter((p) => p.discordId)
      .map((p) => {
        const factionKey = factionKeyFor(p.faction, config.factionAliases, state.status?.factionScores);
        if (p.faction && !factionKey && !unknownFactionStrings.has(p.faction)) {
          unknownFactionStrings.add(p.faction);
          console.warn(`[sync] unknown faction string "${p.faction}" — add it to FACTION_ALIASES if it's a real faction`);
        }
        return { ...p, factionKey };
      });

    const desired = tracker.update(linked, now);
    const roles = factionRoles();
    for (const [discordId, want] of desired) {
      const member = guild.members.cache.get(discordId) ?? await guild.members.fetch(discordId).catch(() => null);
      if (!member) continue;
      const toAdd = [];
      const toRemove = [];
      for (const [key, role] of roles) {
        if (!role) continue;
        const has = member.roles.cache.has(role.id);
        if (key === want && !has) toAdd.push(role);
        if (key !== want && has) toRemove.push(role);
      }
      if (!toAdd.length && !toRemove.length) continue;
      try {
        if (toRemove.length) await member.roles.remove(toRemove, 'SIXDOGS faction sync');
        if (toAdd.length) await member.roles.add(toAdd, 'SIXDOGS faction sync');
        console.log(`[sync] ${member.user.tag}: ${want ?? 'no faction'}`);
        roleTroubleLogged = false;
      } catch (err) {
        console.warn(`[sync] couldn't update roles for ${member.user.tag}: ${err.message}`);
        // Once per outage, not once per tick: this runs every 5 seconds and
        // would otherwise bury #admin-log. Silence was the old behaviour and it
        // is how a broken role list went unnoticed until players complained.
        if (!roleTroubleLogged) {
          roleTroubleLogged = true;
          await log(`❌ I can't hand out team roles: ${err.message}\n`
            + 'Most likely my own role sits below them. Server Settings -> Roles, drag mine above the team roles, '
            + 'then run `/healthcheck`.');
        }
      }
    }

    await commanders.tick(linked, (id) => tracker.factionOf(id));
    // A new or departed commander shows on the live board straight away.
    const cmdSig = FACTIONS.map((f) => commanders.state[f.key]?.commanderId ?? '-').join(',');
    if (lastCmdSig !== null && cmdSig !== lastCmdSig) board.update();
    lastCmdSig = cmdSig;
  } catch (err) {
    console.error('[sync] error:', err);
  } finally {
    syncing = false;
  }
}

// ---------------------------------------------------------------------------
// Discord wiring
// ---------------------------------------------------------------------------

client.once(Events.ClientReady, async (c) => {
  console.log(`[bot] logged in as ${c.user.tag}`);
  guild = await c.guilds.fetch(config.guildId).catch(() => null);
  if (!guild) {
    console.error(`[bot] I'm not in the server with DISCORD_GUILD_ID=${config.guildId}. Invite me first (see README).`);
    process.exit(1);
  }
  await guild.members.fetch();
  await guild.channels.fetch();
  commanders.attach(guild);
  ratings.attach(guild);
  seeding.attach(guild);
  verified.attach(guild);
  board.attach(guild);
  leaderboard.attach(guild);
  logChannel = guild.channels.cache.find((ch) => ch.isTextBased() && ch.name === config.logChannelName) ?? null;
  if (!logChannel) console.warn(`[bot] no #${config.logChannelName} channel yet — run /setup-server`);

  // Name and profile picture (bot/assets/avatar.png).
  for (const line of await applyIdentity(c, guild, { name: config.botName }).catch((e) => [`! ${e.message}`])) {
    if (line.startsWith('!')) console.warn(`[bot] ${line.slice(2)}`); else console.log(`[bot] ${line}`);
  }

  await guild.commands.set(commandDefinitions);
  console.log(`[bot] registered ${commandDefinitions.length} slash commands in ${guild.name}`);

  // Discord-only mode: there's no game to be on a team in, so nobody keeps a
  // team or commander role (e.g. leftovers from practice mode). With a game
  // server, role holders are picked up by the first sync instead.
  if (config.coreDisabled) {
    const n = await clearFactionRoles('no game server connected');
    await commanders.clearAllRoles();
    if (n) console.log(`[sync] removed team roles from ${n} member(s): no game server connected`);
  }

  // Verified role: exactly the members who linked their Steam account.
  try {
    const made = await verified.ensure();
    if (made) console.log(`[verified] ${made}`);
    if (!config.coreDisabled) {
      const [added, removed] = await verified.reconcile(await core.linkedIds());
      if (added || removed) console.log(`[verified] ${config.verifiedRoleName} role: +${added} -${removed}`);
    }
  } catch (err) {
    console.warn(`[verified] couldn't sync the ${config.verifiedRoleName} role: ${err.message}`);
  }

  // Keep the #roles menu text current (edited in place; reactions are kept).
  try {
    const menuReport = await ensureRoleMenu(guild, { rolesChannelName: config.rolesChannelName, poolRoleName: config.commanderPoolRoleName });
    if (menuReport.length) for (const line of menuReport) console.log(`[roles] ${line}`);
    else console.log(`[roles] #${config.rolesChannelName} menu is up to date`);
  } catch (err) {
    console.error(`[roles] couldn't update the #${config.rolesChannelName} menu: ${err.message}`);
  }

  // Channel layout: locked info channels, #clips-screenshots, no #looking-for-squad.
  try {
    for (const line of await enforceLayout(guild, config)) console.log(`[setup] ${line}`);
    await guild.channels.fetch();
    // Anyone already sitting somewhere they're no longer allowed goes to the lobby.
    for (const vs of guild.voiceStates.cache.values()) if (vs.member) await checkVoice(vs.member, { log });
  } catch (err) {
    console.warn(`[setup] couldn't update the channel layout: ${err.message}`);
  }

  // Channel posts from the content/ folder (#rules, #server-info, #announcements).
  try {
    const isMenu = (m) => isMenuMessage(m, client.user.id, config.rolesChannelName);
    for (const line of await syncPosts(guild, { isMenu, skip: [config.liveBoardChannel, config.seedChannel, config.leaderboardChannel] })) {
      if (line.startsWith('!')) console.warn(`[posts] ${line.slice(2)}`);
      else console.log(`[posts] ${line.slice(2)}`);
    }
  } catch (err) {
    console.error(`[posts] couldn't update channel posts: ${err.message}`);
  }

  // Operations are off for now (24/7 server, no scheduled ops): keep that category hidden.
  await applyOperationsVisibility(guild, config)
    .then((line) => line && console.log(`[setup] ${line}`))
    .catch((err) => console.warn(`[setup] couldn't hide OPERATIONS: ${err.message}`));

  // Catch up on #roles reactions made while the bot was offline.
  const caughtUp = await reconcileRoleMenu(guild, { rolesChannelName: config.rolesChannelName, poolRoleName: config.commanderPoolRoleName })
    .catch((err) => { console.warn('[roles] catch-up skipped:', err.message); return 0; });
  if (caughtUp) console.log(`[roles] gave ${caughtUp} role(s) for reactions made while offline`);

  await log(config.coreDisabled
    ? '🟡 SIXDOGS bot online — Discord only, no game server connected yet.'
    : '🟢 SIXDOGS bot online.');
  // Live board in #server-info.
  await board.update();
  setInterval(() => board.update(), config.liveBoardMinutes * 60_000);
  // The leaderboard is a heavier query than the live board, so it runs slower.
  await leaderboard.update();
  setInterval(() => leaderboard.update(), config.leaderboardMinutes * 60_000);
  web.start(guild);
  setInterval(syncOnce, config.syncIntervalMs);
  if (!config.coreDisabled) setInterval(() => ratings.notifyDue().catch(() => {}), 60_000);
  syncOnce();
});

// ---------------------------------------------------------------------------
// #roles reaction menu
// ---------------------------------------------------------------------------

async function onRoleReaction(reaction, user, adding) {
  if (user.bot || !guild) return;
  try {
    if (reaction.partial) await reaction.fetch();
    const msg = reaction.message.partial ? await reaction.message.fetch() : reaction.message;
    if (msg.guildId !== guild.id || !isMenuMessage(msg, client.user.id, config.rolesChannelName)) return;
    const entry = entryForEmoji(reaction.emoji.name, config.commanderPoolRoleName);
    if (!entry) {
      // Not one of ours: tidy it away so the menu stays readable.
      if (adding) await reaction.users.remove(user.id).catch(() => {});
      return;
    }
    const role = guild.roles.cache.find((r) => r.name === entry.roleName);
    if (!role) return console.warn(`[roles] role "${entry.roleName}" missing — run /setup-server`);
    const member = await guild.members.fetch(user.id);
    if (adding && !member.roles.cache.has(role.id)) await member.roles.add(role, 'SIXDOGS: #roles reaction');
    if (!adding && member.roles.cache.has(role.id)) await member.roles.remove(role, 'SIXDOGS: #roles reaction removed');
    console.log(`[roles] ${member.user.tag} ${adding ? '+' : '-'} ${entry.roleName}`);
    menuTroubleLogged = false;
  } catch (err) {
    console.warn(`[roles] couldn't update role: ${err.message} (is my role above the class roles?)`);
    // Same silent failure as the team roles: someone taps an emoji in #roles,
    // nothing happens, and only the console knows. Latched, because a broken
    // role list would otherwise log once per tap.
    if (!menuTroubleLogged) {
      menuTroubleLogged = true;
      await log(`❌ I can't hand out the roles in #${config.rolesChannelName}: ${err.message}\n`
        + "Most likely my own role sits below them. Server Settings -> Roles, drag mine above the class roles, "
        + 'then run `/healthcheck`.');
    }
  }
}
// Someone linked left the server and came back: give Verified back.
client.on(Events.GuildMemberAdd, async (member) => {
  if (config.coreDisabled || member.guild.id !== guild?.id) return;
  const linked = await core.getLink(member.id).then(() => true, () => false);
  if (linked) await verified.set(member.id, true);
});

// Lost the role that let you into a voice channel (e.g. reshuffled to another team)?
// You're moved to the lobby. Also checked on join, in case a permission was missed.
client.on(Events.GuildMemberUpdate, (before, after) => {
  if (after.guild.id !== guild?.id || before.roles.cache.size === after.roles.cache.size
    && before.roles.cache.every((r) => after.roles.cache.has(r.id))) return;
  checkVoice(after, { log }).catch(() => {});
});
client.on(Events.VoiceStateUpdate, (_before, after) => {
  if (after.guild.id === guild?.id && after.channelId && after.member) checkVoice(after.member, { log }).catch(() => {});
});

// #get-verified is for slash commands only.
client.on(Events.MessageCreate, (message) => {
  if (message.guild?.id === guild?.id) tidyGetVerified(message).catch(() => {});
});

client.on(Events.MessageReactionAdd, (reaction, user) => onRoleReaction(reaction, user, true));
client.on(Events.MessageReactionRemove, (reaction, user) => onRoleReaction(reaction, user, false));

client.on(Events.ChannelCreate, (ch) => {
  if (!logChannel && guild && ch.guildId === guild.id && ch.isTextBased() && ch.name === config.logChannelName) logChannel = ch;
});

client.on(Events.InteractionCreate, async (i) => {
  try {
    // Fires on every keystroke and must answer within 3 seconds, so it never
    // falls through to the error handling below: an empty list is a fine
    // answer, an exception would leave the box spinning.
    if (i.isAutocomplete()) {
      const fill = autocomplete[i.commandName];
      if (!fill) return i.respond([]);
      return fill(i).catch(() => i.respond([]).catch(() => {}));
    }
    if (i.isButton() && i.customId.startsWith('rate:')) return ratings.onButton(i);
    if (i.isButton() && i.customId.startsWith('seed:')) return seeding.onButton(i);
    if (i.isButton() && i.customId.startsWith('cmd:')) {
      const [, action, , matchId] = i.customId.split(':');
      if (Number(matchId) !== commanders.matchId) {
        return i.reply({ content: 'That offer was for a previous match.', flags: MessageFlags.Ephemeral });
      }
      const r = action === 'accept' ? await commanders.accept(i.user.id) : await commanders.decline(i.user.id);
      return i.update({ content: r.message, components: [] });
    }
    if (!i.isChatInputCommand()) return;
    const handler = handlers[i.commandName];
    if (!handler) return;
    await handler(i);
  } catch (err) {
    const message = err instanceof CoreError
      ? (err.code === 'unreachable' ? "I can't reach the SIXDOGS core service right now. Tell an admin." : err.message)
      : 'Something went wrong. An admin can check the bot logs.';
    if (!(err instanceof CoreError)) console.error(`[bot] /${i.commandName ?? i.customId} failed:`, err);
    const payload = { content: message, flags: MessageFlags.Ephemeral };
    if (i.deferred || i.replied) await i.editReply(message).catch(() => {});
    else await i.reply(payload).catch(() => {});
  }
});

process.on('SIGTERM', () => { client.destroy(); process.exit(0); });
process.on('SIGINT', () => { client.destroy(); process.exit(0); });

client.login(config.discordToken).catch((err) => {
  if (err.code === 'TokenInvalid') {
    console.error('[bot] Discord rejected DISCORD_TOKEN. Reset it in the Developer Portal (Bot tab) and save the new one wherever your settings live: .env, or the variables set by your host.');
  } else if (/disallowed intents/i.test(err.message)) {
    console.error('[bot] Turn on "Server Members Intent": Developer Portal → your app → Bot → Privileged Gateway Intents. Then start again.');
  } else {
    console.error(`[bot] could not log in to Discord (${err.code ?? err.message}). Check DISCORD_TOKEN in your settings (.env, or the variables set by your host) and your internet connection.`);
  }
  process.exit(1);
});
