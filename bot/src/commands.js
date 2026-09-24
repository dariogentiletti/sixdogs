import { SlashCommandBuilder, PermissionFlagsBits as P, MessageFlags } from 'discord.js';
import { FACTIONS, byKey, gameFactionFor } from './factions.js';
import { runSetup } from './setup.js';
import { parseConfigText, findSection, summarise, renderSection, shown } from './serverconfig.js';
import { syncPosts } from './posts.js';
import { isMenuMessage } from './rolemenu.js';
import { assignedRoles, healthReport, playerHealth, roleHealth } from './health.js';

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

  // Admins AND moderators: gated on ManageMessages, which the Moderator role
  // has and Verified does not. Running match nights is exactly a moderator job.
  new SlashCommandBuilder().setName('event').setDescription('ADMIN/MOD: put a match night on the calendar')
    .setDefaultMemberPermissions(P.ManageMessages)
    .addSubcommand((c) => c.setName('create').setDescription('Put a match night up for people to sign up to')
      .addStringOption((o) => o.setName('date').setDescription('YYYY-MM-DD, e.g. 2026-10-02').setRequired(true))
      .addStringOption((o) => o.setName('time').setDescription('HH:MM on a 24 hour clock, e.g. 20:00').setRequired(true))
      .addStringOption((o) => o.setName('title').setDescription('What to call it. Default: Match night'))
      .addIntegerOption((o) => o.setName('target').setDescription("How many are needed. Default: the game server's own minimum").setMinValue(2).setMaxValue(200))
      .addStringOption((o) => o.setName('timezone').setDescription('Whose clock the time is in. Default: the server timezone')))
    .addSubcommand((c) => c.setName('list').setDescription("What's on the calendar, and who has answered"))
    .addSubcommand((c) => c.setName('cancel').setDescription('Call one off')
      .addStringOption((o) => o.setName('id').setDescription('The event number, from /event list').setRequired(true))
      .addStringOption((o) => o.setName('reason').setDescription('What to tell people'))),

  new SlashCommandBuilder().setName('set-commander').setDescription('ADMIN: put someone in command, or pick someone new at random')
    .addStringOption(factionChoice)
    .addUserOption((o) => o.setName('member').setDescription('Who. Leave it empty and the bot picks someone at random instead'))
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
  new SlashCommandBuilder().setName('healthcheck').setDescription('ADMIN: can a new player verify and be given their roles?')
    .setDefaultMemberPermissions(P.ManageRoles),
  new SlashCommandBuilder().setName('reserved').setDescription('ADMIN: who holds a reserved slot, and give or take one')
    .addUserOption((o) => o.setName('grant').setDescription('Give this member a reserved slot (they must be verified)'))
    .addUserOption((o) => o.setName('revoke').setDescription('Take this member\'s reserved slot back'))
    .addBooleanOption((o) => o.setName('confirm').setDescription('Yes, save it to the live server'))
    .setDefaultMemberPermissions(P.ManageRoles),
  new SlashCommandBuilder().setName('settings').setDescription("ADMIN: read, and change, the game server's settings")
    .addStringOption((o) => o.setName('section').setDescription('Show one section in full').setMaxLength(200).setAutocomplete(true))
    .addStringOption((o) => o.setName('key').setDescription('With value: the setting to change, inside that section').setMaxLength(200).setAutocomplete(true))
    .addStringOption((o) => o.setName('value').setDescription('What to change it to. Shows you the change first; nothing is saved without confirm').setMaxLength(200))
    .addStringOption((o) => o.setName('find').setDescription('Search every section for a setting, e.g. afk, kick, timeout, player').setMaxLength(60))
    .addBooleanOption((o) => o.setName('confirm').setDescription('Yes, save it to the live server'))
    .setDefaultMemberPermissions(P.Administrator),

  // ---- match and world control ----
  new SlashCommandBuilder().setName('map').setDescription('ADMIN: change the map now')
    .addStringOption((o) => o.setName('map').setDescription('Which map').setRequired(true).setMaxLength(100).setAutocomplete(true))
    .addStringOption((o) => o.setName('lighting').setDescription('Time of day').setMaxLength(60).setAutocomplete(true))
    .setDefaultMemberPermissions(P.Administrator),
  new SlashCommandBuilder().setName('lighting').setDescription('ADMIN: change the time of day')
    .addStringOption((o) => o.setName('lighting').setDescription('Time of day').setRequired(true).setMaxLength(60).setAutocomplete(true))
    .setDefaultMemberPermissions(P.Administrator),
  new SlashCommandBuilder().setName('restart').setDescription('ADMIN: restart the current match')
    .addBooleanOption((o) => o.setName('confirm').setDescription('Yes, restart it for everyone playing').setRequired(true))
    .setDefaultMemberPermissions(P.Administrator),
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

/**
 * Autocomplete for /settings. The section and key names have to match the game
 * server's document exactly, and they are things like
 * "MatchState.PreMatch.WaitingForPlayers.PlayerCount". Nobody should be typing
 * that, and getting it subtly wrong is the whole class of mistake this removes.
 *
 * Discord fires this on every keystroke, so the document is cached: hammering
 * the game server for a dropdown would be a poor trade.
 */
/**
 * Every setting whose key or section mentions `term`, across the whole
 * document. For finding a setting when nobody knows which section it lives in,
 * which is most of the time: the document has six sections and no index.
 */
export function searchConfig(sections, term) {
  const t = String(term ?? '').trim().toLowerCase();
  if (!t) return [];
  const hits = [];
  for (const sec of sections) {
    const sectionMatches = sec.name.toLowerCase().includes(t);
    for (const e of sec.entries) {
      if (sectionMatches || e.key.toLowerCase().includes(t)) {
        hits.push({ section: sec.name, key: e.key, value: e.value, kind: e.kind });
      }
    }
  }
  return hits;
}

/** One search hit as a line, saying what kind it is so a list isn't mistaken for a value. */
export function hitLine(h) {
  const value = h.kind === 'set' ? shown(h)
    : h.kind === 'clear' ? '(a list, built up below)'
      : `(list entry) ${h.value}`;
  return `[${h.section}]\n  ${h.key} = ${value}`;
}

export function makeAutocomplete({ core, ttlMs = 30_000 }) {
  let cache = { at: 0, sections: [] };
  const sections = async () => {
    if (Date.now() - cache.at < ttlMs) return cache.sections;
    const c = await core.serverConfig();
    cache = { at: Date.now(), sections: parseConfigText(c.text) };
    return cache.sections;
  };
  // Discord takes at most 25 choices, and caps BOTH the label and the value at
  // 100 characters. A value cannot be shortened to fit: a truncated section
  // name matches nothing. So anything that long is left out of the dropdown
  // rather than offered broken; it can still be typed by hand, which is why
  // the option itself allows more. Real names are around 50, so this is a
  // guard rail, not a limitation anyone will meet.
  const choices = (names, typed) => names
    .filter((n) => n && n.length <= 100 && n.toLowerCase().includes(String(typed ?? '').toLowerCase()))
    .slice(0, 25)
    .map((n) => ({ name: n, value: n }));

  // The game server's own lists, cached: autocomplete fires on every keystroke.
  let catalogs = { at: 0, maps: [], lightings: [] };
  const catalog = async (kind) => {
    if (Date.now() - catalogs.at > ttlMs) {
      const [maps, lightings] = await Promise.all([
        core.catalog('maps').catch(() => []),
        core.catalog('lightings').catch(() => []),
      ]);
      const name = (x) => (typeof x === 'string' ? x : x?.name ?? x?.id ?? '');
      catalogs = { at: Date.now(), maps: maps.map(name).filter(Boolean), lightings: lightings.map(name).filter(Boolean) };
    }
    return catalogs[kind];
  };

  return {
    async map(i) {
      const focused = i.options.getFocused(true);
      return i.respond(choices(await catalog(focused.name === 'lighting' ? 'lightings' : 'maps'), focused.value));
    },

    async lighting(i) {
      return i.respond(choices(await catalog('lightings'), i.options.getFocused()));
    },

    async settings(i) {
      const focused = i.options.getFocused(true);
      const all = await sections();
      if (focused.name === 'section') {
        return i.respond(choices(all.map((x) => x.name), focused.value));
      }
      if (focused.name === 'key') {
        const sec = findSection(all, i.options.getString('section') ?? '');
        if (!sec) return i.respond([]);
        // Only ordinary settings: a !Key/.Key list line has no single value to set.
        const keys = [...new Set(sec.entries.filter((e) => e.kind === 'set').map((e) => e.key))];
        return i.respond(choices(keys, focused.value));
      }
      return i.respond([]);
    },
  };
}

export function makeHandlers({ core, commanders, ratings, seeding, events, config, log, verified }) {
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
    /**
     * Match nights. The one thing that actually fills a server where the game
     * will not start below the target: everybody agreeing a time days ahead,
     * with the count known before anybody has to be in there.
     */
    async event(i) {
      await i.deferReply({ flags: MessageFlags.Ephemeral });
      const sub = i.options.getSubcommand();

      if (sub === 'create') {
        const zone = i.options.getString('timezone') || config.eventTimezone;
        // The date, the time and the zone go to core as typed. Turning a wall
        // clock into an instant is daylight-saving-shaped and belongs in one
        // tested place, not in two.
        let r;
        try {
          r = await core.eventCreate({
            date: i.options.getString('date'),
            time: i.options.getString('time'),
            timezone: zone,
            title: i.options.getString('title') ?? undefined,
            target: i.options.getInteger('target') ?? undefined,
            createdBy: i.user.id,
          });
        } catch (err) {
          // A bad date is a typo, not a crash. Say which bit is wrong.
          if (err.code === 'bad_time' || err.code === 'in_the_past') {
            await i.editReply(`⚠️ ${err.message}`);
            return;
          }
          throw err;
        }
        const e = r.event;
        await events?.refresh();
        await log(`📅 ${i.user} put up **${e.title}** for <t:${Math.floor(Date.parse(e.startsAt) / 1000)}:F> (needs ${e.target}).`);
        await i.editReply(`📅 **${e.title}** is up for <t:${Math.floor(Date.parse(e.startsAt) / 1000)}:F>`
          + ` (that's ${i.options.getString('time')} ${zone}), event #${e.id}.`
          + `\nIt needs **${e.target}** people. Everyone gets told an hour before whether it's on.`);
        return;
      }

      if (sub === 'cancel') {
        const reason = i.options.getString('reason') ?? undefined;
        const r = await core.eventCancel(i.options.getString('id'), reason);
        // Told by name, not just on the board: the people who said yes are the
        // ones who would otherwise turn up at eight to an empty map.
        await events?.announceCancel(r.event, reason);
        await log(`📅 ${i.user} called off **${r.event.title}**.`);
        const told = r.event.yes?.length ?? 0;
        await i.editReply(`Called off **${r.event.title}**. `
          + (told ? `The ${told} who said yes have been told by name.` : 'Nobody had said yes yet, so nobody was pinged.'));
        return;
      }

      const { events: list = [] } = await core.events();
      if (!list.length) {
        await i.editReply('Nothing on the calendar. `/event create` puts one up.');
        return;
      }
      await i.editReply(list.map((e) => {
        const at = `<t:${Math.floor(Date.parse(e.startsAt) / 1000)}:F>`;
        const state = e.cancelledAt ? 'called off' : (e.sent ?? []).includes('go') ? 'ON' : `${e.yes.length}/${e.target}`;
        return `**#${e.id}** ${e.title} — ${at} — ${state}\n-# ${e.reason}`;
      }).join('\n').slice(0, 1900));
    },

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

    // Walks the whole new-player chain and says which link is broken. Written
    // because a friend of the owner's joined, got no code, no team role and no
    // commander offer, and nothing anywhere said why: each step had failed
    // safely into the console.
    async healthcheck(i) {
      await i.deferReply({ flags: MessageFlags.Ephemeral });
      const guild = i.guild;
      await guild.roles.fetch();

      let state = null;
      let coreError = null;
      try {
        state = await core.state();
      } catch (err) {
        coreError = err.message;
      }
      let actions = { message: false };
      try {
        const diag = await core.diagnostics();
        actions = { ...(diag.actions ?? actions), known: diag.capabilitiesLoaded !== false };
      } catch { /* covered by the core line */ }

      const me = guild.members.me ?? await guild.members.fetchMe().catch(() => null);
      const roles = roleHealth({
        required: assignedRoles(config),
        roles: new Map(guild.roles.cache.map((r) => [r.name, r])),
        botTop: me?.roles?.highest?.position ?? 0,
        canManageRoles: me?.permissions?.has(P.ManageRoles) ?? false,
      });

      await i.editReply(healthReport({
        core: {
          ok: !coreError, error: coreError, serverOk: Boolean(state?.ok),
          serverError: state?.lastError ?? null,
          serverCode: state?.lastErrorCode ?? null,
          lastSuccessAt: state?.lastSuccessAt ?? null,
        },
        actions,
        roles,
        players: playerHealth({
          players: state?.players ?? [],
          members: new Set(guild.members.cache.keys()),
        }),
        verifiedRoleName: config.verifiedRoleName,
      }).slice(0, 1990));
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



    // Donors at $10 or more are promised a reserved slot, so an admin needs to
    // see who currently has one. Read only: the build offers no route to grant
    // a slot, so that lives in the settings document.
    // Reserved slots are an array in the settings document, not a writable
    // route, so giving one out is a careful edit to that document. Granting is
    // by @member, never by SteamID: the link already knows which is which, and
    // a mistyped SteamID would hand a paid slot to a stranger.
    async reserved(i) {
      await i.deferReply({ flags: MessageFlags.Ephemeral });
      const grant = i.options.getUser('grant');
      const revoke = i.options.getUser('revoke');
      if (grant && revoke) return i.editReply('One at a time: either `grant` or `revoke`, not both.');

      if (grant || revoke) {
        const member = grant ?? revoke;
        let link;
        try {
          link = await core.getLink(member.id);
        } catch {
          return i.editReply(`<@${member.id}> hasn't linked a WARDOGS account yet, so there's no one to reserve a slot for. `
            + 'They need to run `/verify` first.');
        }
        const steamId = link.link?.steam_id ?? link.link?.steamId;
        const who = link.link?.last_name ? `**${link.link.last_name}**` : `\`${steamId}\``;
        const apply = i.options.getBoolean('confirm') === true;
        const r = grant
          ? await core.grantReserved(steamId, apply)
          : await core.revokeReserved(steamId, apply);
        const used = `${r.members.length}${r.max ? ` of ${r.max}` : ''} slot${r.members.length === 1 ? '' : 's'} in use`;
        if (!r.changed) return i.editReply(`${r.message} (${used})`);
        if (!r.applied) {
          return i.editReply(`${grant ? 'Would give' : 'Would take back'} a reserved slot for <@${member.id}> (${who}).\n`
            + `That would leave **${used}**. The game server says it would accept it. **Nothing has been saved yet.**\n`
            + 'Run the same command again with `confirm:True` to save it.');
        }
        await log(`🎟️ <@${i.user.id}> ${grant ? 'gave' : 'took back'} a reserved slot: <@${member.id}> (${used}).`);
        return i.editReply(`✅ ${grant ? 'Reserved slot given to' : 'Reserved slot taken back from'} <@${member.id}> (${who}). ${used}.`);
      }

      const [live, cfg] = await Promise.all([
        core.reservedSlots().catch(() => null),
        core.reserved(),
      ]);
      const linked = await core.linkedIds().catch(() => []);
      const byId = new Map();
      for (const id of linked) {
        const l = await core.getLink(id).catch(() => null);
        const sid = l?.link?.steam_id ?? l?.link?.steamId;
        if (sid) byId.set(String(sid), { discordId: id, name: l.link.last_name });
      }
      const name = (sid) => {
        const m = byId.get(String(sid));
        return m ? `<@${m.discordId}>${m.name ? ` (${m.name})` : ''}` : `\`${sid}\``;
      };
      const lines = [
        `**Reserved slots**: ${cfg.granted.length}${cfg.max ? ` of ${cfg.max}` : ''} given out`
          + (cfg.free !== null ? `, ${cfg.free} free` : ''),
        '',
        cfg.granted.length ? cfg.granted.map((sid) => `• ${name(sid)}`).join('\n') : '_Nobody holds one right now._',
      ];
      if (cfg.placeholders.length) {
        lines.push('', `_${cfg.placeholders.length} empty placeholder row${cfg.placeholders.length === 1 ? '' : 's'} `
          + 'in the settings. They take up room in the list but belong to nobody._');
      }
      if (!cfg.writable) lines.push('', '⚠️ This server build will not let its settings be changed, so slots can only be given out by hand.');
      else lines.push('', 'Give one with `/reserved grant:@member`, take one back with `/reserved revoke:@member`.');
      // The game server's own view, in case it disagrees with the settings document.
      const slots = live?.slots ?? [];
      if (slots.length !== cfg.members.length) {
        lines.push('', `_The game server itself reports ${slots.length}. If that disagrees with the list above, it may not have reloaded its settings yet._`);
      }
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

      // Hunting for a setting across a document nobody has read in full is the
      // common case, and reading six sections one command at a time to find one
      // key is a poor way to spend an afternoon.
      const showHits = (term, hits, note = '') => i.editReply(
        `**${hits.length} setting${hits.length === 1 ? '' : 's'} matching \`${term}\`**${note}\n`
        + `\`\`\`ini\n${hits.map(hitLine).join('\n').slice(0, 1700)}\n\`\`\``);
      const noHits = (term) => i.editReply(`Nothing matching **${term}** in any section, and no section by that name. `
        + `There are ${sections.length} sections; \`/settings\` on its own lists them.`);

      const find = i.options.getString('find');
      if (find) {
        const hits = searchConfig(sections, find);
        return hits.length ? showHits(find, hits) : noHits(find);
      }

      if (wanted) {
        const sec = findSection(sections, wanted);
        if (!sec) {
          // Two commands pasted into one box. Easy to do from a chat message,
          // and the "no such section" answer on its own doesn't explain it.
          if (/[\r\n]|\/settings\s/i.test(wanted)) {
            return i.editReply('That looks like two commands pasted into one box. '
              + 'Run them one at a time, and use the dropdown that appears when you start typing a section name.');
          }
          // Not a section, so take it as something to look for. Typing "afk"
          // into the section box plainly means "find me the afk setting", and
          // answering "no such section" would be technically right and useless.
          const hits = searchConfig(sections, wanted);
          return hits.length
            ? showHits(wanted, hits, ' _(no section by that name, so I searched for it instead)_')
            : noHits(wanted);
        }
        return i.editReply(`**[${sec.name}]** — ${summarise(sec)}\n\`\`\`ini\n${renderSection(sec)}\n\`\`\`\n`
          + (/rcon/i.test(sec.name)
            ? 'These are how the bot reaches the game server, so they can only be changed in the xREALM panel.'
            : `Change one with \`/settings section:${sec.name} key:<key> value:<value>\`.`));
      }

      const lines = [
        `**Server settings** (revision \`${c.revision ?? '?'}\`, ${c.writable ? 'writable' : 'read-only'})`,
        '',
        ...sections.map((sec) => `\`${sec.name || '(top)'}\` — ${summarise(sec)}`),
        '',
        'Use `/settings section:<name>` to see one in full, or `/settings find:<text>` to search them all.',
      ];
      if (c.warnings?.length) {
        lines.push('', `⚠️ The server reports ${c.warnings.length} warning(s):`, '```', c.warnings.map((w) => (typeof w === 'string' ? w : JSON.stringify(w))).join('\n').slice(0, 500), '```');
      }
      await i.editReply(lines.join('\n').slice(0, 1990));
    },

    // With a member: that person commands, whoever the rules would have picked.
    // Without: the bot picks someone new at random, which is the old /reroll.
    // One command, because "replace this commander" and "make THIS person
    // commander" are the same job with and without a name attached.
    async 'set-commander'(i) {
      const faction = i.options.getString('faction', true);
      const member = i.options.getUser('member');
      await i.deferReply({ flags: MessageFlags.Ephemeral });

      if (!member) {
        await log(`🎲 <@${i.user.id}> asked for a new ${byKey(faction).label} commander.`);
        await commanders.adminReroll(faction);
        return i.editReply(`Picked again for ${byKey(faction).label}.\n${commanders.summary()}`);
      }

      const r = await commanders.assign(faction, member.id);
      if (!r.ok) return i.editReply(r.message);
      await log(`🎖️ <@${i.user.id}> made <@${member.id}> ${byKey(faction).label} commander.`);
      // Say so if they aren't actually there: the role works either way, but an
      // admin who mistyped a name should find out now rather than mid-match.
      const on = (await core.state().catch(() => null))?.players
        ?.find((p) => p.discordId === member.id);
      const note = on
        ? ''
        : "\n⚠️ They aren't on the game server right now, so they'll lose it again shortly unless they join.";
      return i.editReply(`${r.message}${note}\n${commanders.summary()}`);
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
      report.push(...await syncPosts(i.guild, { isMenu, skip: [config.liveBoardChannel, config.seedChannel, config.leaderboardChannel, config.eventChannel] }));
      const text = report.join('\n');
      await i.editReply((`Done.\n${text}`).slice(0, 1900) +
        '\n\nNext: drag my own role (**SIXDOGS** or whatever the bot is called) above the faction and commander roles in Server Settings → Roles, or I can\'t hand them out.');
    },
  };
}
