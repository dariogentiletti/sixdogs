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
    .addStringOption((o) => o.setName('code').setDescription('Six-digit code').setRequired(true).setMaxLength(12)),
  new SlashCommandBuilder().setName('unlink').setDescription('Unlink your Discord from your WARDOGS character'),
  new SlashCommandBuilder().setName('whoami').setDescription('Show which WARDOGS character you are linked to'),

  new SlashCommandBuilder().setName('commanders').setDescription("Who's commanding this match"),
  new SlashCommandBuilder().setName('rating').setDescription('Commander score from post-match votes')
    .addUserOption((o) => o.setName('member').setDescription('Someone else (admins only)')),
  new SlashCommandBuilder().setName('accept').setDescription('Accept a commander offer'),
  new SlashCommandBuilder().setName('standdown').setDescription('Stop commanding (someone else gets picked)'),
  new SlashCommandBuilder().setName('claim').setDescription("Take command of your faction if nobody's been picked"),

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
  new SlashCommandBuilder().setName('settings').setDescription("ADMIN: read the game server's settings")
    .addStringOption((o) => o.setName('section').setDescription('Show one section in full').setMaxLength(100))
    .setDefaultMemberPermissions(P.Administrator),
].map((c) => c.toJSON());

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

export function makeHandlers({ core, commanders, ratings, config, log, verified }) {
  return {
    async verify(i) {
      await i.deferReply({ flags: MessageFlags.Ephemeral });
      const r = await core.verifyStart(i.user.id, i.options.getString('name', true));
      await i.editReply(`📨 I've sent a six-digit code to **${r.name}** in-game (private message). Type \`/confirm <code>\` here within ${Math.round(r.expiresInSec / 60)} minutes.`);
    },

    async confirm(i) {
      await i.deferReply({ flags: MessageFlags.Ephemeral });
      const r = await core.verifyConfirm(i.user.id, i.options.getString('code', true));
      await verified.set(i.user.id, true);
      await i.editReply(`✅ Linked to **${r.name ?? r.steamId}**. You're **Verified**, and your team role will follow you in-game from now on.`);
      await log(`🔗 <@${i.user.id}> verified as **${r.name ?? r.steamId}** (${r.steamId}).`);
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

    async server(i) {
      await i.deferReply({ flags: MessageFlags.Ephemeral });
      const d = await core.diagnostics();
      const yn = (b) => (b ? '✅' : '❌');
      const lines = [
        `**Game server**: ${d.rconOk ? '🟢 connected' : '🔴 not reachable'}${d.lastError ? ` (${d.lastError})` : ''}`,
        `API ${d.apiVersion ?? '?'}, build \`${d.build ?? '?'}\`, server ID \`${d.serverId ?? '?'}\``,
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

    async settings(i) {
      await i.deferReply({ flags: MessageFlags.Ephemeral });
      const c = await core.serverConfig();
      const sections = parseConfigText(c.text);
      const wanted = i.options.getString('section');

      if (wanted) {
        const sec = findSection(sections, wanted);
        if (!sec) {
          const names = sections.map((x) => x.name).filter(Boolean);
          return i.editReply(`No section called **${wanted}**. There is: ${names.join(', ') || '(none)'}`);
        }
        return i.editReply(`**[${sec.name}]** — ${summarise(sec)}\n\`\`\`ini\n${renderSection(sec)}\n\`\`\``);
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
        memberRoleName: config.memberRoleName,
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
