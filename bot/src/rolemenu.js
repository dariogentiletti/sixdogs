// #roles: one message, one reaction per role. React = get the role, remove your
// reaction = lose it. Your own reactions stay highlighted, so you can always
// see what you've picked.

import { ChannelType } from 'discord.js';

// The WARDOGS classes, plus the commander volunteer list.
// Pinged when enough people have said they'd play right now (see seeding.js).
// Opt-in and rare by design: nobody is pinged who didn't ask to be.
export const SEED_PING_ROLE_NAME = 'Match Alerts';

export function roleMenu(poolRoleName = 'Commander Pool') {
  return [
    { emoji: '🎖️', roleName: poolRoleName, label: 'Commander', blurb: "you'd like to run comms. When your faction needs a commander, you're asked first." },
    { emoji: '📣', roleName: SEED_PING_ROLE_NAME, label: 'Match Alerts', blurb: 'you want to be told when enough people are ready to start a match. One ping, only when the server is waking up.' },
    { emoji: '💥', roleName: 'Assault', label: 'Assault', blurb: 'rifle in hand, fighting inside the control zone and holding it.' },
    { emoji: '🩹', roleName: 'Medic', label: 'Medic', blurb: 'bandages for the wounded, the defib for anyone who goes down.' },
    { emoji: '🔭', roleName: 'Recon', label: 'Recon', blurb: 'binoculars and rangefinder. Marks vehicles, helicopters and positions for the team, and snipes from range.' },
    { emoji: '🔧', roleName: 'Support', label: 'Support', blurb: 'hammer and drill. Builds the base and the FOB, and keeps the vehicles running.' },
    { emoji: '🚙', roleName: 'Driver', label: 'Driver', blurb: 'gets the squad into the control zone, not just somewhere near it.' },
    { emoji: '🚁', roleName: 'Pilot', label: 'Pilot', blurb: 'flies the squad in by helicopter and puts them down on the zone.' },
  ];
}

export const CLASS_ROLE_NAMES = ['Assault', 'Medic', 'Recon', 'Support', 'Driver', 'Pilot'];

// Discord sometimes drops the invisible "emoji style" character (U+FE0F); compare without it.
const norm = (e) => String(e ?? '').replace(/\uFE0F/g, '');

export function entryForEmoji(emojiName, poolRoleName) {
  return roleMenu(poolRoleName).find((r) => norm(r.emoji) === norm(emojiName)) ?? null;
}

const TITLE = 'Pick your roles';
const LEGACY_MARKER = '**Pick your roles**'; // the old plain-text version of the menu
const EMBED_COLOR = 0x2b2d31;

/** The menu as a Discord message payload (an embed: coloured bar, title, footer). */
export function menuPayload(poolRoleName) {
  const lines = roleMenu(poolRoleName).map((r) => `${r.emoji}  **${r.label}**: ${r.blurb}`);
  return {
    content: '',
    embeds: [{
      title: TITLE,
      color: EMBED_COLOR,
      description: lines.join('\n\n'),
      footer: { text: 'Tap an emoji to take the role, tap it again to drop it. Class roles can be pinged, like @Pilot.' },
    }],
    allowedMentions: { parse: [] },
  };
}

const isOurs = (m, botUserId) => m?.author?.id === botUserId
  && (m.embeds?.[0]?.title === TITLE || (typeof m.content === 'string' && m.content.startsWith(LEGACY_MARKER)));

export function isMenuMessage(message, botUserId, rolesChannelName) {
  return message?.channel?.name === rolesChannelName && isOurs(message, botUserId);
}

async function findMenu(channel, botUserId) {
  const recent = await channel.messages.fetch({ limit: 50 }).catch(() => null);
  return recent?.find((m) => isOurs(m, botUserId)) ?? null;
}

/** Post (or refresh) the menu and make sure every emoji is on it. */
export async function ensureRoleMenu(guild, { rolesChannelName, poolRoleName }) {
  const channel = guild.channels.cache.find((c) => c.type === ChannelType.GuildText && c.name === rolesChannelName);
  if (!channel) return [`! no #${rolesChannelName} channel — role menu not posted`];
  const payload = menuPayload(poolRoleName);
  let msg = await findMenu(channel, guild.client.user.id);
  const report = [];
  if (!msg) {
    msg = await channel.send(payload);
    report.push(`+ role menu posted in #${rolesChannelName}`);
  } else if (msg.content || msg.embeds?.[0]?.description !== payload.embeds[0].description) {
    // Edited in place, so everyone's existing reactions (and roles) are kept.
    await msg.edit(payload);
    report.push(`~ role menu in #${rolesChannelName} updated`);
  }
  for (const r of roleMenu(poolRoleName)) {
    const has = msg.reactions.cache.some((x) => norm(x.emoji.name) === norm(r.emoji) && x.me);
    if (!has) await msg.react(r.emoji);
  }
  return report;
}

/**
 * Startup catch-up: anyone who reacted while the bot was offline gets their role.
 * (Only adds. Removing roles from people with no reaction would also strip roles
 * an admin handed out by hand.)
 */
export async function reconcileRoleMenu(guild, { rolesChannelName, poolRoleName }) {
  const channel = guild.channels.cache.find((c) => c.type === ChannelType.GuildText && c.name === rolesChannelName);
  if (!channel) return 0;
  const msg = await findMenu(channel, guild.client.user.id);
  if (!msg) return 0;
  let added = 0;
  for (const reaction of msg.reactions.cache.values()) {
    const entry = entryForEmoji(reaction.emoji.name, poolRoleName);
    const role = entry && guild.roles.cache.find((x) => x.name === entry.roleName);
    if (!role) continue;
    const users = await reaction.users.fetch({ limit: 100 }).catch(() => null);
    for (const user of users?.values() ?? []) {
      if (user.bot) continue;
      const member = guild.members.cache.get(user.id);
      if (member && !member.roles.cache.has(role.id)) {
        await member.roles.add(role, 'SIXDOGS: #roles reaction').catch(() => {});
        added++;
      }
    }
  }
  return added;
}
