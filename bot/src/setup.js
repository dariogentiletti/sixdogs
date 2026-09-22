// /setup-server: builds the Step 2 Discord layout (roles, categories,
// channels, permissions). Safe to run twice — anything that already exists
// (matched by name) is left alone unless you ask it to re-apply permissions.

import { ChannelType, OverwriteType, PermissionFlagsBits as P, PermissionsBitField } from 'discord.js';
import { FACTIONS } from './factions.js';
import { CLASS_ROLE_NAMES, SEED_PING_ROLE_NAME, ensureRoleMenu } from './rolemenu.js';

// Top to bottom. Discord puts each new role at the bottom, so creating them
// in this order leaves them in this order.
export const VERIFIED_COLOR = 0xc9a227;
// Donors. Purely cosmetic and given out by hand: the bot creates the role and
// never adds or removes anyone, unlike the faction roles it owns outright.
export const SUPPORTER_ROLE_NAME = '\u2605 Supporter';
export const SUPPORTER_COLOR = 0xe3bc3c;

export function rolePlan(poolRoleName = 'Commander Pool', { operationsEnabled = false, verifiedRoleName = 'Verified' } = {}) {
  return [
    { name: 'Admin', permissions: [P.Administrator], hoist: true },
    { name: 'Moderator', permissions: [P.KickMembers, P.BanMembers, P.ManageMessages, P.MuteMembers, P.MoveMembers, P.ModerateMembers], hoist: true },
    // Hoisted so donors show as their own group in the member list.
    { name: SUPPORTER_ROLE_NAME, color: SUPPORTER_COLOR, hoist: true, permissions: [] },
    ...FACTIONS.map((f) => ({ name: f.commanderRoleName, color: f.color, hoist: true, permissions: [] })),
    ...FACTIONS.map((f) => ({ name: f.roleName, color: f.color, permissions: [] })),
    { name: poolRoleName, permissions: [] },
    // WARDOGS classes, self-assigned in #roles. Mentionable so people can ping "@Pilot".
    ...CLASS_ROLE_NAMES.map((name) => ({ name, permissions: [], mentionable: true })),
    // Opt-in in #roles. The bot pings it when enough people are ready to play.
    { name: SEED_PING_ROLE_NAME, permissions: [], mentionable: true },
    ...(operationsEnabled ? [{ name: 'Operator', permissions: [] }] : []),
    // Given by the bot to everyone who linked their Steam account (/confirm or admin /link).
    // It's the key to the server: writing in chat and joining voice.
    { name: verifiedRoleName, color: VERIFIED_COLOR, permissions: [] },
  ];
}

/**
 * Discord's own gate on who may talk at all, set server-wide.
 *
 *   low       a verified email
 *   medium    registered with Discord for over 5 minutes
 *   high      a member of THIS server for over 10 minutes
 *   veryhigh  a verified phone number
 *
 * `high` is the one worth having now that #general is open to everyone: the
 * accounts that turn up to paste a scam link are minutes old and move on
 * immediately, so ten minutes of waiting costs them more than it costs a real
 * person. It is not a spam filter and it does not pretend to be; it raises the
 * cost of the drive-by, which is the cheap attack.
 */
export const VERIFICATION_LEVELS = { none: 0, low: 1, medium: 2, high: 3, veryhigh: 4 };

/** @returns {number|null} null for anything unrecognised, so a typo changes nothing. */
export function verificationLevelFrom(name) {
  const key = String(name ?? '').trim().toLowerCase().replace(/[\s_-]/g, '');
  return Object.hasOwn(VERIFICATION_LEVELS, key) ? VERIFICATION_LEVELS[key] : null;
}

/** Set it if it is not already there. Returns a report line, or null. */
export async function applyVerificationLevel(guild, { guildVerificationLevel = 'high' } = {}) {
  const want = verificationLevelFrom(guildVerificationLevel);
  if (want === null) return `! GUILD_VERIFICATION_LEVEL "${guildVerificationLevel}" is not a level I know, so I left it alone`;
  if (guild.verificationLevel === want) return null;
  await guild.setVerificationLevel(want, 'SIXDOGS: brand-new accounts wait before they can post');
  return `verification level set to ${guildVerificationLevel}`;
}

const allow = (...p) => ({ allow: p, deny: [] });
const deny = (...p) => ({ allow: [], deny: p });
const both = (a, d) => ({ allow: a, deny: d });

/**
 * Channel plan. `ow` maps role name ('@everyone' for everyone, '@bot' for the bot itself)
 * -> {allow, deny}. A channel's overwrites are its category's plus its own (own wins per role).
 *
 * Who can do what:
 *   not verified   read INFO and COMMUNITY, type /verify in #get-verified, nothing else
 *   Verified       chat in COMMUNITY, talk in Command Lobby
 *   Blue/Red/Green hear their own team's (listen) channel only; can't see the others
 *   X Commander    talk in their own team's channel only
 *   Moderator      manage messages in COMMUNITY, STAFF channels
 *   Admin          Discord's Administrator: sees and joins everything (can't be limited)
 */
export function channelPlan({ verifiedRoleName = 'Verified', logChannelName = 'admin-log', rolesChannelName = 'roles', operationsEnabled = false } = {}) {
  const V = P.ViewChannel, S = P.SendMessages, C = P.Connect, SP = P.Speak, H = P.ReadMessageHistory;
  const THREADS = [P.SendMessagesInThreads, P.CreatePublicThreads, P.CreatePrivateThreads];
  const VER = verifiedRoleName;
  const bot = (...extra) => allow(V, H, S, P.EmbedLinks, P.AttachFiles, P.AddReactions, P.ManageMessages, ...extra);
  // INFO: everyone can read, nobody can post or start threads. Only the bot posts there
  // (Admins have Administrator, which Discord never lets a channel block). Adding *new*
  // reactions is off too; people can still click the emojis already on a message, which
  // is how #roles works.
  const readOnlyEveryone = {
    '@everyone': both([V, H], [S, ...THREADS, P.AddReactions]),
    '@bot': bot(),
  };
  return [
    {
      category: 'INFO',
      ow: readOnlyEveryone,
      channels: [
        { name: 'rules' },
        // The one place unverified people can type: slash commands need a channel you can
        // write in. The bot deletes anything else posted here; slowmode keeps it calm.
        {
          name: 'get-verified', slowmode: 10,
          ow: { '@everyone': both([V, H, S, P.UseApplicationCommands], [...THREADS, P.AddReactions, P.EmbedLinks, P.AttachFiles]) },
        },
        { name: 'how-to-play' },
        { name: rolesChannelName },
        { name: 'server-info' },   // live board: the bot edits one message every few minutes
        { name: 'leaderboard' },   // the bot edits one message every LEADERBOARD_MINUTES
        // Seeding: the bot's board with the "I'd play right now" buttons. Buttons work
        // in a read-only channel (a click is an interaction, not a message), so this
        // needs no extra permission for anyone.
        { name: 'start-a-match' },
        { name: 'support-the-community' },  // running costs + donate button
        // Admins post announcements (and can ping everyone there).
        { name: 'announcements', ow: { Admin: allow(V, H, S, P.EmbedLinks, P.AttachFiles, P.MentionEveryone) } },
      ],
    },
    {
      category: 'COMMUNITY',
      // Everyone can TALK here, verified or not: making people verify before
      // they can say hello loses the ones who were only half sure.
      //
      // What they cannot do is post links, files or embeds. That is the scam
      // vector, near enough all of it: the drive-by accounts are here to paste
      // a URL, and a wall of text is not worth their time. It also leaves
      // verifying with a point, since pictures and links are the reward.
      ow: {
        '@everyone': both([V, H, S, P.AddReactions], [...THREADS, P.EmbedLinks, P.AttachFiles, P.UseExternalEmojis]),
        [VER]: allow(V, H, S, P.SendMessagesInThreads, P.CreatePublicThreads, P.AddReactions, P.EmbedLinks, P.AttachFiles, P.UseExternalEmojis),
        Moderator: allow(V, H, S, P.ManageMessages, P.ManageThreads),
        '@bot': bot(),
      },
      channels: [
        { name: 'general' },
        // Whole point of the channel is pictures, so it stays verified-only.
        { name: 'clips-screenshots', ow: { '@everyone': both([V, H], [S, ...THREADS, P.AddReactions]) } },
      ],
    },
    // Scheduled ops: only when OPERATIONS_ENABLED=true (weekend events later).
    ...(operationsEnabled ? [
      {
        category: 'OPERATIONS',
        ow: {
          '@everyone': deny(V),
          [VER]: both([V, H], [S]),
          Operator: allow(V, S, H),
          Moderator: allow(V, S, H),
          '@bot': bot(),
        },
        channels: [{ name: 'op-signup' }, { name: 'op-briefing' }, { name: 'after-action' }],
      },
    ] : []),
    {
      category: 'COMMAND',
      // Everyone can see the lobby (and who's in it); only verified people can join and talk.
      ow: {
        '@everyone': both([V], [C]),
        [VER]: allow(V, C, SP, P.Stream),
        '@bot': allow(V, C, P.MoveMembers),
      },
      channels: [
        { name: 'Command Lobby', type: 'voice' },
        ...FACTIONS.map((f) => ({
          name: f.voiceChannelName, type: 'voice',
          ow: {
            // Hidden from everyone who isn't on this team right now.
            '@everyone': deny(V, C),
            [VER]: deny(V, C),
            // The team hears, and can watch Activities (the Wardogs Tech map)...
            [f.roleName]: both([V, C, P.UseEmbeddedActivities], [SP, P.Stream, P.UseSoundboard]),
            // ...only its commander talks (and starts the map).
            [f.commanderRoleName]: allow(V, C, SP, P.Stream, P.UseEmbeddedActivities),
            '@bot': allow(V, C, P.MoveMembers),
          },
        })),
      ],
    },
    {
      category: 'STAFF',
      ow: {
        '@everyone': deny(V),
        Moderator: allow(V, S, H),
        '@bot': bot(),
      },
      channels: [{ name: 'staff-chat' }, { name: logChannelName }],
    },
  ];
}

function toOverwrites(guild, ow, roleIds) {
  return Object.entries(ow).map(([roleName, { allow: a, deny: d }]) => {
    if (roleName === '@bot') return { id: guild.members.me?.id, type: OverwriteType.Member, allow: a, deny: d };
    const id = roleName === '@everyone' ? guild.roles.everyone.id : roleIds.get(roleName);
    return { id, type: OverwriteType.Role, allow: a, deny: d };
  }).filter((o) => o.id);
}

/** Does the channel already have exactly these overwrites? (Avoids needless edits.) */
function sameOverwrites(channel, wanted) {
  const cache = channel.permissionOverwrites.cache;
  if (cache.size !== wanted.length) return false;
  return wanted.every((w) => {
    const o = cache.get(w.id);
    return o && o.allow.bitfield === PermissionsBitField.resolve(w.allow)
      && o.deny.bitfield === PermissionsBitField.resolve(w.deny);
  });
}

/**
 * Runs on every start (and in /setup-server): puts every category and channel in the
 * plan into shape, whatever state the server is in.
 *  - @everyone has no server-wide View Channels (channels grant access themselves)
 *  - missing categories and channels are created; permissions are set to the plan
 *  - INFO in order; #get-verified slowmode
 *  - #clips renamed to #clips-screenshots (history kept), #looking-for-squad removed
 * Only what the plan names is touched. Channels you add yourself are left alone.
 */
export async function enforceLayout(guild, { verifiedRoleName = 'Verified', logChannelName = 'admin-log', rolesChannelName = 'roles', operationsEnabled = false, guildVerificationLevel = 'high' } = {}) {
  const report = [];
  const text = (name) => guild.channels.cache.find((c) => c.type === ChannelType.GuildText && c.name === name);

  // Server-wide: nobody sees channels unless a channel says so, and only Admins ping @everyone.
  const everyone = guild.roles.everyone;
  if (everyone.permissions && (everyone.permissions.has(P.ViewChannel) || everyone.permissions.has(P.MentionEveryone))) {
    await everyone.setPermissions(everyone.permissions.remove(P.ViewChannel, P.MentionEveryone), 'SIXDOGS: channels grant access themselves');
    report.push('@everyone: server-wide View Channels and @everyone pings turned off');
  }

  const clips = text('clips');
  if (clips && !text('clips-screenshots')) {
    await clips.setName('clips-screenshots', 'SIXDOGS: clips and screenshots');
    report.push('renamed #clips to #clips-screenshots');
  }
  const lfs = text('looking-for-squad');
  if (lfs) {
    await lfs.delete('SIXDOGS: not needed on a 24/7 server');
    report.push('removed #looking-for-squad');
  }

  const roleIds = new Map(guild.roles.cache.map((r) => [r.name, r.id]));
  const plan = channelPlan({ verifiedRoleName, logChannelName, rolesChannelName, operationsEnabled });
  for (const cat of plan) {
    const catOw = toOverwrites(guild, cat.ow, roleIds);
    let category = guild.channels.cache.find((c) => c.type === ChannelType.GuildCategory && c.name.toUpperCase() === cat.category);
    if (!category) {
      category = await guild.channels.create({ name: cat.category, type: ChannelType.GuildCategory, permissionOverwrites: catOw, reason: 'SIXDOGS: server layout' });
      report.push(`created category ${cat.category}`);
    } else if (!sameOverwrites(category, catOw)) {
      await category.permissionOverwrites.set(catOw, 'SIXDOGS: server layout');
      report.push(`permissions set on category ${cat.category}`);
    }
    for (const ch of cat.channels) {
      const type = ch.type === 'voice' ? ChannelType.GuildVoice : ChannelType.GuildText;
      const label = type === ChannelType.GuildVoice ? `🔊${ch.name}` : `#${ch.name}`;
      const wanted = toOverwrites(guild, { ...cat.ow, ...(ch.ow ?? {}) }, roleIds);
      let channel = guild.channels.cache.find((c) => c.type === type && c.name.toLowerCase() === ch.name.toLowerCase());
      if (!channel) {
        channel = await guild.channels.create({
          name: ch.name, type, parent: category.id, permissionOverwrites: wanted,
          ...(ch.slowmode ? { rateLimitPerUser: ch.slowmode } : {}), reason: 'SIXDOGS: server layout',
        });
        report.push(`created ${label}`);
        continue;
      }
      if (!sameOverwrites(channel, wanted)) {
        await channel.permissionOverwrites.set(wanted, 'SIXDOGS: server layout');
        report.push(`permissions set on ${label}`);
      }
      if (ch.slowmode && channel.rateLimitPerUser !== ch.slowmode && channel.setRateLimitPerUser) {
        await channel.setRateLimitPerUser(ch.slowmode, 'SIXDOGS: keep #get-verified calm');
        report.push(`slowmode ${ch.slowmode}s on ${label}`);
      }
    }
  }

  // Server-wide gate on brand-new accounts. Only matters now that #general is
  // open to everyone, so it lives here rather than in /setup-server alone.
  try {
    const line = await applyVerificationLevel(guild, { guildVerificationLevel });
    if (line) report.push(line);
  } catch (err) {
    report.push(`! couldn't set the verification level: ${err.message}`);
  }

  // Keep INFO in the planned order (as listed in channelPlan).
  const info = plan.find((c) => c.category === 'INFO');
  const infoCat = guild.channels.cache.find((c) => c.type === ChannelType.GuildCategory && c.name.toUpperCase() === 'INFO');
  if (infoCat) {
    await guild.channels.fetch();
    const ordered = info.channels.map((ch) => text(ch.name)).filter((c) => c && c.parentId === infoCat.id);
    const current = [...ordered].sort((a, b) => a.rawPosition - b.rawPosition).map((c) => c.id);
    if (ordered.length && current.join() !== ordered.map((c) => c.id).join()) {
      const base = Math.min(...ordered.map((c) => c.rawPosition));
      await guild.channels.setPositions(ordered.map((c, i) => ({ channel: c.id, position: base + i })));
      report.push('put the INFO channels in order');
    }
  }
  return report;
}

export async function runSetup(guild, { poolRoleName, logChannelName, rolesChannelName, operationsEnabled = false, reapply = false, verifiedRoleName = 'Verified' }) {
  const report = [];
  await guild.roles.fetch();
  await guild.channels.fetch();

  // 0. Servers set up with the old faction names (Lonestar / Valkyra / Manticore):
  //    rename those roles and voice channels to the colour names in place, so
  //    permissions and members carry over.
  for (const [oldName, f] of LEGACY_NAMES) {
    const renames = [
      [guild.roles.cache, oldName, f.roleName, true],
      [guild.roles.cache, `${oldName} Commander`, f.commanderRoleName, true],
      [guild.channels.cache, `${oldName} Command (listen)`, f.voiceChannelName, false],
    ];
    for (const [cache, from, to, isRole] of renames) {
      const old = cache.find((x) => x.name === from);
      if (!old || cache.find((x) => x.name === to)) continue;
      await old.edit(isRole ? { name: to, colors: { primaryColor: f.color }, reason: 'SIXDOGS: factions renamed to colours' }
        : { name: to, reason: 'SIXDOGS: factions renamed to colours' });
      report.push(`~ renamed ${isRole ? 'role' : 'channel'} ${from} → **${to}**`);
    }
  }

  // 1. Roles
  const roleIds = new Map();
  for (const r of rolePlan(poolRoleName, { operationsEnabled, verifiedRoleName })) {
    let role = guild.roles.cache.find((x) => x.name === r.name);
    if (!role) {
      role = await guild.roles.create({
        name: r.name, ...(r.color ? { colors: { primaryColor: r.color } } : {}), hoist: !!r.hoist, permissions: r.permissions, mentionable: !!r.mentionable,
        reason: 'SIXDOGS server setup',
      });
      report.push(`+ role **${r.name}**`);
    } else {
      report.push(`= role ${r.name} (exists)`);
    }
    roleIds.set(r.name, role.id);
  }

  // 2. @everyone can't see anything by default; channels grant access per role.
  const everyone = guild.roles.everyone;
  if (everyone.permissions.has(P.ViewChannel)) {
    await everyone.setPermissions(everyone.permissions.remove(P.ViewChannel), 'SIXDOGS: hide channels by default');
    report.push('+ @everyone: View Channels turned **off** server-wide');
  }

  // Rename #clips first, so a fresh #clips-screenshots isn't created next to it.
  const oldClips = guild.channels.cache.find((c) => c.type === ChannelType.GuildText && c.name === 'clips');
  if (oldClips && !guild.channels.cache.some((c) => c.name === 'clips-screenshots')) {
    await oldClips.setName('clips-screenshots', 'SIXDOGS: clips and screenshots');
    report.push('~ renamed #clips to #clips-screenshots');
  }

  // 3. Categories and channels
  for (const cat of channelPlan({ verifiedRoleName, logChannelName, rolesChannelName, operationsEnabled })) {
    let category = guild.channels.cache.find((c) => c.type === ChannelType.GuildCategory && c.name.toUpperCase() === cat.category);
    const catOw = toOverwrites(guild, cat.ow, roleIds);
    if (!category) {
      category = await guild.channels.create({ name: cat.category, type: ChannelType.GuildCategory, permissionOverwrites: catOw, reason: 'SIXDOGS server setup' });
      report.push(`+ category **${cat.category}**`);
    } else if (reapply) {
      await category.permissionOverwrites.set(catOw, 'SIXDOGS: re-apply permissions');
      report.push(`~ category ${cat.category}: permissions re-applied`);
    }

    for (const ch of cat.channels) {
      const type = ch.type === 'voice' ? ChannelType.GuildVoice : ChannelType.GuildText;
      // Channel overwrites = category overwrites + channel-specific ones.
      const ow = toOverwrites(guild, { ...cat.ow, ...(ch.ow ?? {}) }, roleIds);
      let channel = guild.channels.cache.find((c) => c.parentId === category.id && c.name.toLowerCase() === ch.name.toLowerCase() && c.type === type);
      if (!channel) {
        channel = await guild.channels.create({ name: ch.name, type, parent: category.id, permissionOverwrites: ow, reason: 'SIXDOGS server setup' });
        report.push(`+ ${type === ChannelType.GuildVoice ? '🔊' : '#'}${ch.name}`);
      } else if (reapply) {
        await channel.permissionOverwrites.set(ow, 'SIXDOGS: re-apply permissions');
        report.push(`~ ${ch.name}: permissions re-applied`);
      }
    }
  }
  // 4. The #roles reaction menu (classes + Commander). Replaces the old
  //    "Join / leave the Commander Pool" button, which is removed if present.
  await guild.channels.fetch();
  report.push(...await ensureRoleMenu(guild, { rolesChannelName, poolRoleName }));
  const signup = guild.channels.cache.find((c) => c.type === ChannelType.GuildText && c.name === 'op-signup');
  const recent = signup ? await signup.messages.fetch({ limit: 50 }).catch(() => null) : null;
  for (const m of recent?.values() ?? []) {
    const oldButton = m.author.id === guild.client.user.id
      && m.components.some((row) => row.components.some((c) => c.customId === 'pool:toggle'));
    if (oldButton) {
      await m.delete().catch(() => {});
      report.push('- removed the old Commander Pool button from #op-signup');
    }
  }
  report.push(...(await enforceLayout(guild, { verifiedRoleName, logChannelName, rolesChannelName, operationsEnabled })).map((l) => `~ ${l}`));
  const ops = await applyOperationsVisibility(guild, { operationsEnabled });
  if (ops) report.push(`~ ${ops}`);
  return report;
}

/**
 * While operations are off, an existing OPERATIONS category (and its channels) is
 * hidden from everyone but admins. Nothing is deleted: set OPERATIONS_ENABLED=true
 * and run /setup-server with reapply-permissions to bring it back.
 */
export async function applyOperationsVisibility(guild, { operationsEnabled = false } = {}) {
  if (operationsEnabled) return null;
  const category = guild.channels.cache.find((c) => c.type === ChannelType.GuildCategory && c.name.toUpperCase() === 'OPERATIONS');
  if (!category) return null;
  const hidden = [{ id: guild.roles.everyone.id, allow: [], deny: [P.ViewChannel] }];
  const children = guild.channels.cache.filter((c) => c.parentId === category.id);
  const already = !category.permissionsFor(guild.roles.everyone).has(P.ViewChannel)
    && category.permissionOverwrites.cache.size === 1
    && children.every((c) => c.permissionsLocked);
  if (already) return null;
  await category.permissionOverwrites.set(hidden, 'SIXDOGS: operations off for now');
  for (const ch of children.values()) await ch.lockPermissions().catch(() => {});
  return 'OPERATIONS hidden (turn back on with OPERATIONS_ENABLED=true in .env)';
}

// Old in-game names -> the colour faction they became.
const LEGACY_NAMES = [['Lonestar', 'blue'], ['Valkyra', 'red'], ['Manticore', 'green']]
  .map(([oldName, key]) => [oldName, FACTIONS.find((f) => f.key === key)]);
