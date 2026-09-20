// Two small guards that keep the permissions honest in practice.
//
// Voice: Discord doesn't always pull someone out of a voice channel when they lose
// the role that let them in (a Blue player reshuffled to Red is still sitting in
// "Blue Command (listen)"). Whenever a member's roles change, or they join a channel,
// check they're still allowed there; if not, move them to the lobby (or disconnect).
//
// #get-verified: unverified people can type there (slash commands need that), but
// it isn't a chat. Anything posted by a person is removed with a short hint.

import { PermissionFlagsBits as P, ChannelType } from 'discord.js';

/** Pure: may this member stay in this voice channel? */
export function mayStay(perms) {
  return !!perms && perms.has(P.ViewChannel) && perms.has(P.Connect);
}

export async function checkVoice(member, { lobbyName = 'Command Lobby', log = async () => {} } = {}) {
  const channel = member?.voice?.channel;
  if (!channel || member.user?.bot) return null;
  if (mayStay(channel.permissionsFor(member))) return null;
  const lobby = member.guild.channels.cache.find((c) => c.type === ChannelType.GuildVoice && c.name === lobbyName);
  const target = lobby && mayStay(lobby.permissionsFor(member)) ? lobby : null;
  try {
    await member.voice.setChannel(target, 'SIXDOGS: no longer allowed in that channel');
    const where = target ? `moved to ${target.name}` : 'disconnected';
    await log(`🔈 <@${member.id}> ${where}: not allowed in ${channel.name} any more.`);
    return where;
  } catch (err) {
    console.warn(`[guard] couldn't move ${member.user?.tag} out of ${channel.name}: ${err.message} (does the bot have Move Members?)`);
    return null;
  }
}

export async function tidyGetVerified(message, { channelName = 'get-verified' } = {}) {
  if (!message.guild || message.author?.bot || message.system) return false;
  if (message.channel?.name !== channelName) return false;
  if (message.member?.permissions.has(P.Administrator)) return false; // admins may post notes
  await message.delete().catch(() => {});
  const hint = await message.channel.send({
    content: `<@${message.author.id}> this channel is only for verifying. Type \`/verify\` and your in-game name, then \`/confirm\` with the code you get in game.`,
    allowedMentions: { users: [message.author.id] },
  }).catch(() => null);
  if (hint) setTimeout(() => hint.delete().catch(() => {}), 15_000).unref?.();
  return true;
}
