import { SlashCommandBuilder, PermissionFlagsBits as P, MessageFlags } from 'discord.js';
import { FACTIONS, byKey, gameFactionFor } from './factions.js';
import { runSetup } from './setup.js';
import { parseConfigText, findSection, summarise, renderSection } from './serverconfig.js';
import { syncPosts } from './posts.js';
import { isMenuMessage } from './rolemenu.js';

const factionChoice = (o) => o.setName('faction').setDescription('Which faction').setRequired(true)
  .addChoices(...FACTIONS.map((f) => ({ name: f.label, value: f.key })));

const playerChoice = (o) => o.setName('player').setDescription('In-game name, or their SteamID64')
  .setRequired(true).setMaxLength(100);

export const commandDefinitions = [
  new SlashCommandBuilder().setName('verify').setDescription('Link your Discord to your WARDOGS character (be in-game first)')
    .addStringOption((o) => o.setName('name').setDescription('Your in-game name as on the scoreboard (or your Steam profile link)').setRequired(true).setMaxLength(100)),
  new SlashCommandBuilder().setName('confirm').setDescription('Finish /verify with the code you were sent in-game')
    .addStringOption((o) => o.setName('code').setDescription('The code you were sent in-game').setRequired(true).setMaxLength(12)),
  new SlashCommandBuilder().setName('unlink').setDescription('Unlink your Discord from your WARDOGS character'),
  new SlashCommandBuilder().setName('whoami').setDescription('Show which WARDOGS character you are linked to'),

  new SlashCommandBuilder().setName('commanders').setDescription("Who's commanding this match"),
  new SlashCommandBuilder().setName('rating').setDescription('Commander score from post-match votes')
    .addUserOption((o) => o.setName('member').setDescription('Someone else (admins only)')),
  new SlashCommandBuilder().setName('accept').setDescription('Accept a commander offer'),
  new SlashCommandBuilder().setName('standdown').setDescription('Stop commanding (someone else gets picked)'),
  new SlashCommandBuilder().setName('claim').setDescription("Take command of your faction if nobody's been picked"),

  new SlashCommandBuilder().setName('seed').setDescription("ADMIN: who's ready to play, and call everyone in")
    .addBooleanOption((o) => o.setName('call-now').setDescription('Call everyone in right now, without waiting for the target'))
    .setDefaultMemberPermissions(P.ManageRoles),

  new SlashCommandBuilder().setName('reroll').setDescription('ADMIN: pick a new commander for a faction')
    .addStringOption(factionChoice)
    .setDefaultMemberPermissions(P.ManageRoles),
  new SlashCommandBuilder().setName('link').setDescription('ADMIN: link a member to a SteamID without the in-game code')
    .addUserOption((o) => o.setName('member').setDescription('Discord member').setRequired(true))
    .addStringOption((o) => o.setName('steamid').setDescription('SteamID64 (17 digits)').setRequired(true))
    .setDefaultMemberPermissions(P.ManageRoles),
  new SlashCommandBuilder().setName('unlink-member').setDescription("ADMIN: remove someone else's link")
    .addUserOption((o) => o.setName('member').setDescription('Discord member').setRequired(true))
    .setDefaultMemberPermissions(P.ManageRoles),
  new SlashCommandBuilder().setName('setup-server').setDescription('ADMIN: create the SIXDOGS roles and channels')
    .addBooleanOption((o) => o.setName('reapply-permissions').setDescription('Also reset permissions on channels that already exist'))
    .setDefaultMemberPermissions(P.Administrator),

  // ---- acting on the game server ----
  new SlashCommandBuilder().setName('say').setDescription('ADMIN: announce something to everyone in-game')
    .addStringOption((o) => o.setName('message').setDescription('What to say').setRequired(true).setMaxLength(300))
    .setDefaultMemberPermissions(P.ManageRoles),
  new SlashCommandBuilder().setName('tell').setDescription('ADMIN: send one player a private in-game message')
    .addStringOption(playerChoice)
    .addStringOption((o) => o.setName('message').setDescription('What to say').setRequired(true).setMaxLength(300))
    .setDefaultMemberPermissions(P.ManageRoles),
  new SlashCommandBuilder().setName('kick').setDescription('ADMIN: kick a player off the game server')
    .addStringOption(playerChoice)
    .addStringOption((o) => o.setName('reason').setDescription('Shown to them in-game').setMaxLength(150))
    .setDefaultMemberPermissions(P.ManageRoles),
  new SlashCommandBuilder().setName('move').setDescription('ADMIN: move a player to another team')
    .addStringOption(playerChoice)
    .addStringOption(factionChoice)
    .setDefaultMemberPermissions(P.ManageRoles),
  new SlashCommandBuilder().setName('endmatch').setDescription('ADMIN: end the match now')
    .addBooleanOption((o) => o.setName('confirm').setDescription('Yes, end it for everyone playing').setRequired(true))
    .setDefaultMemberPermissions(P.Administrator),
  new SlashCommandBuilder().setName('server').setDescription('ADMIN: what the game server reports and what it lets the bot do')
    .setDefaultMemberPermissions(P.ManageRoles),
  new SlashCommandBuilder().setName('reserved').setDescription('ADMIN: who holds a reserved slot on the game server')
    .setDefaultMemberPermissions(P.ManageRoles),
  new SlashCommandBuilder().setName('settings').setDescription("ADMIN: read, and change, the game server's settings")
    .addStringOption((o) => o.setName('section').setDescription('Show one section in full').setMaxLength(100))
    .addStringOption((o) => o.setName('key').setDescription('With value: the setting to change, inside that section').setMaxLength(100))
    .addStringOption((o) => o.setName('value').setDescription('What to change it to. Shows you the change first; nothing is saved without confirm').setMaxLength(200))
    .addBooleanOption((o) => o.setName('confirm').setDescription('Yes, save it to the live server'))
    .setDefaultMemberPermissions(P.Administrator),

  // ---- match and world control ----
  new SlashCommandBuilder().setName('map').setDescription('ADMIN: change the map now')
    .addStringOption((o) => o.setName('map').setDescription('Map name (see /maps)').setRequired(true).setMaxLength(100))
    .addStringOption((o) => o.setName('lighting').setDescription('Day, Night, ... (see /maps)').setMaxLength(60))
    .setDefaultMemberPermissions(P.Administrator),
  new SlashCommandBuilder().setName('maps').setDescription('ADMIN: list the maps and lightings this server offers')
    .setDefaultMemberPermissions(P.ManageRoles),
  new SlashCommandBuilder().setName('lighting').setDescription('ADMIN: change the time of day')
    .addStringOption((o) => o.setName('lighting').setDescription('Day, Night, ... (see /maps)').setRequired(true).setMaxLength(60))
    .setDefaultMemberPermissions(P.Administrator),
  new SlashCommandBuilder().setName('restart').setDescription('ADMIN: restart the current match')
    .addBooleanOption((o) => o.setName('confirm').setDescription('Yes, restart it for everyone playing').setRequired(true))
    .setDefaultMemberPermissions(P.Administrator),
  new SlashCommandBuilder().setName('rotation').setDescription('ADMIN: what the map rotation is set to')
    .setDefaultMemberPermissions(P.ManageRoles),

  // ---- moderation ----
  new SlashCommandBuilder().setName('ban').setDescription('ADMIN: ban a player from the game server')
    .addStringOption((o) => o.setName('player').setDescription('In-game name (if on now), or their SteamID64').setRequired(true).setMaxLength(100))
    .addStringOption((o) => o.setName('reason').setDescription('Kept with the ban').setMaxLength(150))
    .setDefaultMemberPermissions(P.BanMembers),
  new SlashCommandBuilder().setName('unban').setDescription('ADMIN: lift a ban')
    .addStringOption((o) => o.setName('steamid').setDescription('SteamID64 (see /bans)').setRequired(true).setMaxLength(30))
    .setDefaultMemberPermissions(P.BanMembers),
  new SlashCommandBuilder().setName('bans').setDescription('ADMIN: who is banned from the game server')
    .setDefaultMemberPermissions(P.BanMembers),
  new SlashCommandBuilder().setName('kill').setDescription('ADMIN: kill a player in-game (they respawn)')
    .addStringOption(playerChoice)
    .addBooleanOption((o) => o.setName('confirm').setDescription('Yes, kill them now').setRequired(true))
    .setDefaultMemberPermissions(P.Administrator),
  new SlashCommandBuilder().setName('audit').setDescription("ADMIN: the game server's own log of recent admin actions")
    .setDefaultMemberPermissions(P.Administrator),
].map((c) => c.toJSON());

/** One line saying where the verified players live, and whether that is safe. */
export function dbLine(db) {
  if (!db) return '**Players stored**: unknown';
  const count = db.links === null ? '' : ` · ${db.links} linked`;
  if (db.persistent) return `**Players stored**: 🟢 Postgres (survives restarts and deploys)${count}`;
  if (db.ephemeralHost) {
    return `**Players stored**: 🔴 built-in database inside the container${count}\n`
      + '⚠️ This host replaces the container on every deploy, so every verified player is lost on the next push. Add a Postgres database and set `DATABASE_URL`.';
  }
  return `**Players stored**: 🟡 built-in database on disk${count}`;
}

/**
 * A ban can target someone who has already left, so a bare SteamID64 is taken
 * at face value here instead of being looked up in the online list.
 */
export function resolveTarget(players, needle) {
  const q = String(needle ?? '').trim();
  if (/^\d{15,25}$/.test(q)) {
    const online = players.find((p) => p.steamId === q);
    return { steamId: q, label: online ? online.name : q };
  }
  const { player, error } = findPlayer(players, q);
  return error ? { error } : { steamId: player.steamId, label: player.name };
}

/**
 * Find one online player by in-game name or SteamID64. Returns { player } or
 * { error } with a sentence to show. Never picks for you when it is ambiguous:
 * kicking or moving the wrong person is worse than asking again.
 */
export function findPlayer(players, needle) {
  const q = String(needle ?? '').trim();
  if (!q) return { error: 'Give me a name or a SteamID.' };
  if (/^\d{15,25}$/.test(q)) {
    const byId = players.find((p) => p.steamId === q);
    return byId ? { player: byId } : { error: `Nobody with SteamID \`${q}\` is on the server.` };
  }
  const low = q.toLowerCase();
  const exact = players.filter((p) => String(p.name ?? '').toLowerCase() === low);
  if (exact.length === 1) return { player: exact[0] };
  if (exact.length > 1) return { error: `More than one player is called **${q}**. Use their SteamID instead.` };
  const part = players.filter((p) => String(p.name ?? '').toLowerCase().includes(low));
  if (part.length === 1) return { player: part[0] };
  if (part.length > 1) {
    return { error: `**${q}** matches ${part.length} players (${part.slice(0, 5).map((p) => p.name).join(', ')}). Be more exact, or use a SteamID.` };
  }
  return { error: `Nobody called **${q}** is on the server right now.` };
}

const ephemeral = (content) => ({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });

export function makeHandlers({ core, commanders, ratings, seeding, config, log, verified }) {
  return {
    async verify(i) {
      await i.deferReply({ flags: MessageFlags.Ephemeral });
      const r = await core.verifyStart(i.user.id, i.options.getString('name', true));
      await i.editReply(`📨 I've sent a ${r.digits ?? 3}-digit code to **${r.name}** in-game (private message). Type \`/confirm <code>\` here within ${Math.round(r.expiresInSec / 60)} minutes.`);
    },

    async confirm(i) {
      await i.deferReply({ flags: MessageFlags.Ephemeral });
      const r = await core.verifyConfirm(i.user.id, i.options.getString('code', true));
      await verified.set(i.user.id, true);
      await i.editReply(`✅ Linked to **${r.name ?? r.steamId}**. You're **Verified**, and your team role will follow you in-game from now on.`);
      await log(`🔗 <@${i.user.id}> verified as **${r.name ?? r.steamId}** (${r.steamId}).`);
    },

    // Seeding: the "I'd play right now" list. The board in #start-a-match shows
    // the same numbers to everyone; this adds the reason it hasn't fired yet.
    async seed(i) {
      await i.deferReply({ flags: MessageFlags.Ephemeral });
      if (i.options.getBoolean('call-now')) {
        const r = await seeding.post('call', { force: true });
        await i.editReply(r.fired
          ? `📣 Called everyone in. ${r.ready} ${r.ready === 1 ? 'person was' : 'people were'} on the list.`
          : `Nothing sent: ${r.reason}.`);
        return;
      }
      await i.editReply(await seeding.describe());
    },

    async unlink(i) {
      const r = await core.unlink(i.user.id);
      if (r.removed) await verified.set(i.user.id, false);
      await i.reply(ephemeral(r.removed ? 'Unlinked. Your Verified and team roles will drop off shortly.' : "You weren't linked."));
      if (r.removed) await log(`🔗 <@${i.user.id}> unlinked themselves.`);
    },

    async whoami(i) {
      try {
        const { link } = await core.getLink(i.user.id);
        await i.reply(ephemeral(`Linked to **${link.last_name ?? '(name unknown)'}** — SteamID ${link.steam_id}, since <t:${Math.floor(new Date(link.verified_at).getTime() / 1000)}:D>.`));
      } catch (err) {
        if (err.code === 'not_linked') return i.reply(ephemeral('Not linked yet. Join the server, then run `/verify <your in-game name>`.'));
        throw err;
      }
    },

    async commanders(i) {
      await i.reply(ephemeral(commanders.summary()));
    },

    async rating(i) {
      const other = i.options.getUser('member');
      if (other && other.id !== i.user.id && !i.memberPermissions?.has(P.ManageRoles)) {
        return i.reply(ephemeral('You can check your own rating. Only admins can look up other people.'));
      }
      const who = other ?? i.user;
      await i.deferReply({ flags: MessageFlags.Ephemeral });
      const text = await ratings.describe(who.id);
      await i.editReply({ content: who.id === i.user.id ? text : `<@${who.id}>: ${text}`, allowedMentions: { parse: [] } });
    },

    async accept(i) { await i.reply(ephemeral((await commanders.accept(i.user.id)).message)); },
    async standdown(i) { await i.reply(ephemeral((await commanders.standdown(i.user.id)).message)); },
    async claim(i) {
      await i.deferReply({ flags: MessageFlags.Ephemeral });
      await i.editReply((await commanders.claim(i.user.id)).message);
    },

    // ---- acting on the game server ----
    // All of these go through core, which owns the RCON password and refuses
    // anything this server build cannot do. An unsupported action comes back
    // as a plain sentence, which is shown as-is.

    async say(i) {
      const message = i.options.getString('message', true);
      await i.deferReply({ flags: MessageFlags.Ephemeral });
      await core.broadcast(message);
      await i.editReply(`📢 Sent to everyone in-game: "${message}"`);
      await log(`📢 <@${i.user.id}> announced in-game: "${message}"`);
    },

    async tell(i) {
      await i.deferReply({ flags: MessageFlags.Ephemeral });
      const message = i.options.getString('message', true);
      const { player, error } = findPlayer((await core.state()).players ?? [], i.options.getString('player', true));
      if (error) return i.editReply(error);
      await core.message(player.steamId, message);
      await i.editReply(`💬 Sent to **${player.name}** in-game: "${message}"`);
      await log(`💬 <@${i.user.id}> messaged **${player.name}** in-game: "${message}"`);
    },

    async kick(i) {
      await i.deferReply({ flags: MessageFlags.Ephemeral });
      const reason = i.options.getString('reason') || 'Kicked by an admin';
      const { player, error } = findPlayer((await core.state()).players ?? [], i.options.getString('player', true));
      if (error) return i.editReply(error);
      await core.kick(player.steamId, reason);
      await i.editReply(`👢 Kicked **${player.name}**. Reason: ${reason}`);
      await log(`👢 <@${i.user.id}> kicked **${player.name}** (${player.steamId}). Reason: ${reason}`);
    },

    async move(i) {
      await i.deferReply({ flags: MessageFlags.Ephemeral });
      const key = i.options.getString('faction', true);
      const state = await core.state();
      const { player, error } = findPlayer(state.players ?? [], i.options.getString('player', true));
      if (error) return i.editReply(error);
      // The game wants its own name for the faction. If the server hasn't
      // reported one that maps to this colour, refuse rather than invent it.
      const gameFaction = gameFactionFor(key, config.factionAliases, state.status?.factionScores ?? []);
      if (!gameFaction) {
        return i.editReply(`I don't know what this server calls the ${byKey(key).label} team yet. Run \`/server\` and send me what it says.`);
      }
      await core.setFaction(player.steamId, gameFaction);
      await i.editReply(`🔀 Moved **${player.name}** to **${byKey(key).label}** (${gameFaction}). Their Discord role follows within a few seconds.`);
      await log(`🔀 <@${i.user.id}> moved **${player.name}** to ${byKey(key).label}.`);
    },

    async endmatch(i) {
      if (!i.options.getBoolean('confirm', true)) {
        return i.reply(ephemeral('Nothing done. Run it again with **confirm: True** if you really want to end the match for everyone playing.'));
      }
      await i.deferReply({ flags: MessageFlags.Ephemeral });
      await core.endMatch();
      await i.editReply('🏁 Match ended.');
      await log(`🏁 <@${i.user.id}> ended the match from Discord.`);
    },

    // Where the verified players are actually stored. Worth saying plainly:
    // on a host that rebuilds the container, the built-in database is wiped on
    // every deploy, and every link with it.
    async server(i) {
      await i.deferReply({ flags: MessageFlags.Ephemeral });
      const d = await core.diagnostics();
      const yn = (b) => (b ? '✅' : '❌');
      const lines = [
        `**Game server**: ${d.rconOk ? '🟢 connected' : '🔴 not reachable'}${d.lastError ? ` (${d.lastError})` : ''}`,
        `API ${d.apiVersion ?? '?'}, build \`${d.build ?? '?'}\`, server ID \`${d.serverId ?? '?'}\``,
        `RCON host \`${d.rconHost ?? '?'}\` (the machine the game runs on)`,
        '',
        dbLine(d.database),
        '',
        '**What it lets the bot do**',
        `${yn(d.actions?.message)} private messages  ${yn(d.actions?.broadcast)} announcements  ${yn(d.actions?.kick)} kick`,
        `${yn(d.actions?.move)} move between teams  ${yn(d.actions?.endMatch)} end the match`,
        '',
        '**What it reports** (send this to Claude)',
        '```json',
        JSON.stringify({
          clockDirection: d.clockDirection,
          matchSeconds: d.matchSeconds,
          statusKeys: d.statusKeys,
          factionScores: d.factionScores,
          factionStrings: d.factionStrings,
          playerCount: d.playerCount,
        }).slice(0, 800),
        '```',
        `**Routes it advertises** (${(d.routes ?? []).length})`,
        '```',
        (d.routes ?? []).join('\n').slice(0, 800),
        '```',
      ];
      await i.editReply(lines.join('\n').slice(0, 1990));
    },

    // ---- match and world control ----

    async map(i) {
      await i.deferReply({ flags: MessageFlags.Ephemeral });
      const map = i.options.getString('map', true);
      const lighting = i.options.getString('lighting') || undefined;
      await core.setMap({ map, lighting });
      await i.editReply(`🗺️ Switching to **${map}**${lighting ? ` (${lighting})` : ''}.`);
      await log(`🗺️ <@${i.user.id}> changed the map to **${map}**${lighting ? ` (${lighting})` : ''}.`);
    },

    async maps(i) {
      await i.deferReply({ flags: MessageFlags.Ephemeral });
      const [maps, lightings] = await Promise.all([
        core.catalog('maps').catch(() => []),
        core.catalog('lightings').catch(() => []),
      ]);
      const name = (x) => (typeof x === 'string' ? x : x?.name ?? x?.id ?? JSON.stringify(x));
      const lines = [
        `**Maps** (${maps.length})`, '```', maps.map(name).join('\n').slice(0, 900) || '(none reported)', '```',
        `**Lightings** (${lightings.length})`, '```', lightings.map(name).join(', ').slice(0, 400) || '(none reported)', '```',
      ];
      await i.editReply(lines.join('\n').slice(0, 1990));
    },

    async lighting(i) {
      await i.deferReply({ flags: MessageFlags.Ephemeral });
      const lighting = i.options.getString('lighting', true);
      await core.setLighting(lighting);
      await i.editReply(`🌤️ Lighting set to **${lighting}**.`);
      await log(`🌤️ <@${i.user.id}> set the lighting to **${lighting}**.`);
    },

    async restart(i) {
      if (!i.options.getBoolean('confirm', true)) {
        return i.reply(ephemeral('Nothing done. Run it again with **confirm: True** to restart the match for everyone playing.'));
      }
      await i.deferReply({ flags: MessageFlags.Ephemeral });
      await core.restartMatch();
      await i.editReply('🔄 Match restarted.');
      await log(`🔄 <@${i.user.id}> restarted the match.`);
    },

    async rotation(i) {
      await i.deferReply({ flags: MessageFlags.Ephemeral });
      const r = await core.rotation();
      const entries = Array.isArray(r?.entries) ? r.entries : [];
      const lines = [
        `**Rotation**: ${r?.enabled ? 'on' : 'off'}${r?.mode ? `, mode \`${r.mode}\`` : ''}`,
        '```',
        entries.map((e, n) => `${n + 1}. ${typeof e === 'string' ? e : e?.map ?? JSON.stringify(e)}`).join('\n').slice(0, 1500) || '(no entries)',
        '```',
      ];
      await i.editReply(lines.join('\n').slice(0, 1990));
    },

    // ---- moderation ----

    async ban(i) {
      await i.deferReply({ flags: MessageFlags.Ephemeral });
      const reason = i.options.getString('reason') || 'Banned by an admin';
      const { steamId, label, error } = resolveTarget((await core.state()).players ?? [], i.options.getString('player', true));
      if (error) return i.editReply(`${error}\nIf they have already left, give me their SteamID64 instead.`);
      await core.ban(steamId, reason);
      await i.editReply(`🔨 Banned **${label}** (\`${steamId}\`). Reason: ${reason}`);
      await log(`🔨 <@${i.user.id}> banned **${label}** (${steamId}). Reason: ${reason}`);
    },

    async unban(i) {
      await i.deferReply({ flags: MessageFlags.Ephemeral });
      const steamId = i.options.getString('steamid', true).trim();
      if (!/^\d{15,25}$/.test(steamId)) return i.editReply('That is not a SteamID64. Run `/bans` to see the list.');
      await core.unban(steamId);
      await i.editReply(`✅ Ban lifted for \`${steamId}\`.`);
      await log(`✅ <@${i.user.id}> lifted the ban on ${steamId}.`);
    },

    async bans(i) {
      await i.deferReply({ flags: MessageFlags.Ephemeral });
      const list = await core.bans();
      if (!list.length) return i.editReply('Nobody is banned.');
      const row = (b) => (typeof b === 'string' ? b : `${b.steamId ?? '?'}  ${b.name ?? ''} ${b.reason ? `— ${b.reason}` : ''}`.trim());
      await i.editReply(`**Banned** (${list.length})\n\`\`\`\n${list.map(row).join('\n').slice(0, 1700)}\n\`\`\``);
    },

    async kill(i) {
      if (!i.options.getBoolean('confirm', true)) {
        return i.reply(ephemeral('Nothing done. Run it again with **confirm: True**.'));
      }
      await i.deferReply({ flags: MessageFlags.Ephemeral });
      const { player, error } = findPlayer((await core.state()).players ?? [], i.options.getString('player', true));
      if (error) return i.editReply(error);
      await core.kill(player.steamId);
      await i.editReply(`💀 Killed **${player.name}** in-game. They respawn normally.`);
      await log(`💀 <@${i.user.id}> killed **${player.name}** in-game.`);
    },

    async audit(i) {
      await i.deferReply({ flags: MessageFlags.Ephemeral });
      const entries = await core.audit();
      if (!entries.length) return i.editReply('The game server has no recent admin actions logged.');
      const row = (e) => (typeof e === 'string' ? e : [e.at ?? e.timestamp, e.action ?? e.type, e.actor, e.target, e.detail].filter(Boolean).join('  '));
      await i.editReply(`**Server audit log** (${entries.length})\n\`\`\`\n${entries.map(row).join('\n').slice(0, 1700)}\n\`\`\``);
    },

    // Donors at $10 or more are promised a reserved slot, so an admin needs to
    // see who currently has one. Read only: the build offers no route to grant
    // a slot, so that lives in the settings document.
    async reserved(i) {
      await i.deferReply({ flags: MessageFlags.Ephemeral });
      const r = await core.reservedSlots();
      const slots = r.slots ?? [];
      const row = (x) => (typeof x === 'string' ? x : [x.steamId ?? x.id, x.name, x.note].filter(Boolean).join('  '));
      const lines = [
        `**Reserved slots**: ${slots.length} in use`,
        slots.length ? '```\n' + slots.map(row).join('\n').slice(0, 1400) + '\n```' : '_Nobody holds one right now._',
      ];
      // Until we know the shape on a live server, show the raw reply too.
      if (!slots.length && r.raw) lines.push('What the server sent back:', '```json', JSON.stringify(r.raw).slice(0, 400), '```');
      await i.editReply(lines.join('\n').slice(0, 1990));
    },

    async settings(i) {
      await i.deferReply({ flags: MessageFlags.Ephemeral });
      const wanted = i.options.getString('section');
      const key = i.options.getString('key');
      const value = i.options.getString('value');

      // section + key + value is a change. Deliberately two steps: the first
      // call says what would happen and saves nothing, and it only touches the
      // live server once somebody has read that and asked again with confirm.
      if (key !== null || value !== null) {
        if (!wanted || key === null || value === null) {
          return i.editReply('To change a setting I need all three: `section`, `key` and `value`. '
            + 'Run `/settings section:<name>` first to see the keys that section actually has.');
        }
        const apply = i.options.getBoolean('confirm') === true;
        const r = await core.setServerSetting(wanted, key, value, apply);
        if (!r.changed) return i.editReply(`Nothing to do: **${r.key}** is already \`${r.from || '(empty)'}\`.`);
        const change = `**[${r.section}]** \`${r.key}\`\n\`${r.from || '(empty)'}\` → \`${r.to || '(empty)'}\``;
        if (!r.applied) {
          return i.editReply(`${change}\n\nThe game server says it would accept that. **Nothing has been saved yet.** `
            + 'Run the same command again with `confirm:True` to save it.');
        }
        await log(`⚙️ <@${i.user.id}> changed a game server setting: [${r.section}] ${r.key}: ${r.from || '(empty)'} → ${r.to || '(empty)'}`);
        return i.editReply(`✅ Saved to the live server.\n${change}`);
      }

      const c = await core.serverConfig();
      const sections = parseConfigText(c.text);

      if (wanted) {
        const sec = findSection(sections, wanted);
        if (!sec) {
          const names = sections.map((x) => x.name).filter(Boolean);
          return i.editReply(`No section called **${wanted}**. There is: ${names.join(', ') || '(none)'}`);
        }
        return i.editReply(`**[${sec.name}]** — ${summarise(sec)}\n\`\`\`ini\n${renderSection(sec)}\n\`\`\`\n`
          + `Change one with \`/settings section:${sec.name} key:<key> value:<value>\`.`);
      }

      const lines = [
        `**Server settings** (revision \`${c.revision ?? '?'}\`, ${c.writable ? 'writable' : 'read-only'})`,
        '',
        ...sections.map((sec) => `\`${sec.name || '(top)'}\` — ${summarise(sec)}`),
        '',
        'Use `/settings section:<name>` to see one in full.',
      ];
      if (c.warnings?.length) {
        lines.push('', `⚠️ The server reports ${c.warnings.length} warning(s):`, '```', c.warnings.map((w) => (typeof w === 'string' ? w : JSON.stringify(w))).join('\n').slice(0, 500), '```');
      }
      await i.editReply(lines.join('\n').slice(0, 1990));
    },

    async reroll(i) {
      const faction = i.options.getString('faction', true);
      await i.deferReply({ flags: MessageFlags.Ephemeral });
      await log(`🎲 <@${i.user.id}> re-rolled ${byKey(faction).label} command.`);
      await commanders.adminReroll(faction);
      await i.editReply(`Re-rolled ${byKey(faction).label}.\n${commanders.summary()}`);
    },

    async link(i) {
      const user = i.options.getUser('member', true);
      const steamId = i.options.getString('steamid', true).trim();
      await core.adminLink(user.id, steamId);
      await verified.set(user.id, true);
      await i.reply(ephemeral(`Linked <@${user.id}> to SteamID ${steamId}.`));
      await log(`🔗 <@${i.user.id}> manually linked <@${user.id}> to ${steamId}.`);
    },

    async 'unlink-member'(i) {
      const user = i.options.getUser('member', true);
      const r = await core.unlink(user.id);
      if (r.removed) await verified.set(user.id, false);
      await i.reply(ephemeral(r.removed ? `Unlinked <@${user.id}>.` : `<@${user.id}> wasn't linked.`));
      if (r.removed) await log(`🔗 <@${i.user.id}> unlinked <@${user.id}>.`);
    },

    async 'setup-server'(i) {
      await i.deferReply({ flags: MessageFlags.Ephemeral });
      const report = await runSetup(i.guild, {
        poolRoleName: config.commanderPoolRoleName,
        verifiedRoleName: config.verifiedRoleName,
        rolesChannelName: config.rolesChannelName,
        operationsEnabled: config.operationsEnabled,
        logChannelName: config.logChannelName,
        reapply: i.options.getBoolean('reapply-permissions') ?? false,
      });
      await i.guild.channels.fetch();
      const isMenu = (m) => isMenuMessage(m, i.client.user.id, config.rolesChannelName);
      report.push(...await syncPosts(i.guild, { isMenu, skip: [config.liveBoardChannel] }));
      const text = report.join('\n');
      await i.editReply((`Done.\n${text}`).slice(0, 1900) +
        '\n\nNext: drag my own role (**SIXDOGS** or whatever the bot is called) above the faction and commander roles in Server Settings → Roles, or I can\'t hand them out.');
    },
  };
}
