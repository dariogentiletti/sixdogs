import { SlashCommandBuilder, PermissionFlagsBits as P, MessageFlags } from 'discord.js';
import { FACTIONS, byKey } from './factions.js';
import { runSetup } from './setup.js';
import { syncPosts } from './posts.js';
import { isMenuMessage } from './rolemenu.js';

const factionChoice = (o) => o.setName('faction').setDescription('Which faction').setRequired(true)
  .addChoices(...FACTIONS.map((f) => ({ name: f.label, value: f.key })));

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
].map((c) => c.toJSON());

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
