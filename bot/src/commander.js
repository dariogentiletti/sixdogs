// Commander selection — a continuous rule, not a one-off pick at match start.
//
// Every sync tick (~5s), for each faction: if it has no commander and nobody is
// being offered the job, offer it to someone currently on that faction:
//   1. a Commander Pool member: the best rated ones, at random among ties, else
//   2. anyone verified on it, at random.
//
// So it doesn't matter who's there at match start: a faction that's empty gets a
// commander when someone joins. A commander keeps the job until they /standdown,
// leave the server for more than COMMANDER_AWAY_SEC (5 min), switch sides, or the
// match ends. Someone who missed an offer is asked again after a cooldown. A sitting
// commander is never bumped for someone "better".

import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { FACTIONS, byKey } from './factions.js';

/**
 * What the commander offer says IN GAME.
 *
 * They are looking at the game, not at Discord, so this is the message that
 * actually gets read. It has to name the right way to accept: "press Accept in
 * your DMs" is useless advice to somebody whose DMs are closed, and an offer
 * that times out because the person never saw a button is indistinguishable
 * from one they ignored.
 */
export function offerWhisper({ label, secs, dmSent, inVoice, voiceChannelName }) {
  return `You've been picked as ${label} COMMANDER. `
    + (dmSent
      ? `Alt-tab to Discord and press Accept in your DMs within ${secs}s.`
      : `Alt-tab to Discord and type /accept within ${secs}s. (I couldn't send you a DM.)`)
    + (inVoice ? '' : ` Then join "${voiceChannelName}".`);
}

/**
 * Pure: who could be offered command of `faction` right now, best group first.
 * @returns {{ tier: 'pool'|'random'|null, candidates: object[] }}
 */
export function pickCandidates({ players, faction, poolIds, exclude = new Set(), scoreOf = () => 0 }) {
  const onFaction = players.filter((p) => p.discordId && p.factionKey === faction && !exclude.has(p.discordId));
  const pool = onFaction.filter((p) => poolIds.has(p.discordId));
  if (pool.length) {
    // Best-rated pool members (post-match votes); ties are picked at random.
    const best = Math.max(...pool.map((p) => scoreOf(p.discordId)));
    return { tier: 'pool', candidates: pool.filter((p) => scoreOf(p.discordId) === best) };
  }
  // Nobody from the pool available: anyone on the faction, at random.
  if (onFaction.length) return { tier: 'random', candidates: onFaction };
  return { tier: null, candidates: [] };
}

// How long someone is skipped after not taking the job (ms). Infinity = rest of match.
export const COOLDOWN_MS = {
  timeout: 5 * 60_000,    // didn't answer — probably alt-tabbed; ask again later
  declined: 15 * 60_000,  // said no
  standdown: 15 * 60_000, // stepped down themselves
  removed: 5 * 60_000,    // left the server / switched sides
  reroll: Infinity,       // an admin replaced them
};

const blank = () => ({
  commanderId: null,
  offer: null,
  passed: new Map(),      // discordId -> skip-until timestamp
  vacantLogged: false,    // so "nobody available" is logged once per vacancy, not every tick
  awaySince: null,        // when the commander was last seen leaving the server
});

export class CommanderManager {
  constructor({ core, config, log }) {
    this.core = core;
    this.config = config;
    this.log = log; // async (text) => void — posts to #admin-log
    this.guild = null;
    this.matchId = null;
    this.settleUntil = 0;   // no offers until factions settle after a match change
    this.state = Object.fromEntries(FACTIONS.map((f) => [f.key, blank()]));
    this.latest = { players: [] }; // latest linked players [{discordId, steamId, name, factionKey}]
    this.scoreOf = () => 0;        // commander rating by Discord id (set from the ratings cache)
  }

  attach(guild) { this.guild = guild; }

  role(faction) {
    return this.guild.roles.cache.find((r) => r.name === byKey(faction).commanderRoleName) ?? null;
  }
  voiceChannel(faction) {
    return this.guild.channels.cache.find((c) => c.isVoiceBased() && c.name === byKey(faction).voiceChannelName) ?? null;
  }
  poolIds() {
    const role = this.guild.roles.cache.find((r) => r.name === this.config.commanderPoolRoleName);
    return new Set(role ? role.members.keys() : []);
  }
  voiceOf(discordId) {
    return this.guild.voiceStates.cache.get(discordId)?.channelId ?? null;
  }

  /**
   * A bot restart is not a new match. The people holding commander roles are
   * still commanding, so take them back over instead of clearing and re-picking:
   * that would strip a sitting commander mid-match and hand the job to someone
   * else. The normal rules still apply from the next tick, so an adopted
   * commander who has left or switched sides is removed the usual way.
   * @returns {string[]} labels of the factions whose commander was kept
   */
  async adoptExisting() {
    const kept = [];
    for (const f of FACTIONS) {
      const role = this.role(f.key);
      if (!role) continue;
      const holders = [...role.members.keys()];
      if (!holders.length) continue;
      this.state[f.key].commanderId = holders[0];
      kept.push(f.label);
      // Two people holding one faction's role means something went wrong
      // earlier. Keep one, take it off the rest.
      for (const extra of holders.slice(1)) {
        await role.members.get(extra)?.roles.remove(role, 'SIXDOGS: one commander per faction').catch(() => {});
      }
    }
    return kept;
  }

  /** Remove every commander role from everyone (match end / outage). */
  async clearAllRoles() {
    for (const f of FACTIONS) {
      const role = this.role(f.key);
      if (!role) continue;
      for (const member of role.members.values()) {
        await member.roles.remove(role, 'SIXDOGS: match over, commander cleared').catch(() => {});
      }
    }
  }

  async onMatchChange(matchId, { firstSeen = false, now = Date.now() } = {}) {
    const prev = this.matchId;
    this.matchId = matchId;
    for (const f of FACTIONS) {
      clearTimeout(this.state[f.key].offer?.timer);
      this.state[f.key] = blank();
    }
    let kept = [];
    if (firstSeen) {
      // The bot just started. Whatever match is running was already running,
      // and its commanders are still in the chair.
      kept = await this.adoptExisting();
    } else {
      await this.clearAllRoles();
    }
    // Give people a moment to load in and get sorted onto factions before offering.
    const delaySec = firstSeen ? 15 : this.config.commanderDelaySec;
    this.settleUntil = now + delaySec * 1000;
    if (!firstSeen) await this.log(`🔁 New match #${matchId} (was #${prev}). Commander roles cleared; offering command from ${delaySec}s in.`);
    else if (kept.length) await this.log(`↩️ Restarted mid-match. Kept the commander on ${kept.join(', ')}.`);
  }

  skipSet(faction, now = Date.now()) {
    const skip = new Set();
    for (const [id, until] of this.state[faction].passed) {
      if (until > now) skip.add(id);
      else this.state[faction].passed.delete(id);
    }
    return skip;
  }

  pass(faction, discordId, reason, now = Date.now()) {
    this.state[faction].passed.set(discordId, now + (COOLDOWN_MS[reason] ?? COOLDOWN_MS.timeout));
  }

  /** Fill the faction's commander slot if it's empty and someone can take it. */
  async select(faction, now = Date.now()) {
    const st = this.state[faction];
    if (st.commanderId || st.offer || now < this.settleUntil) return;
    const f = byKey(faction);
    const { tier, candidates } = pickCandidates({
      players: this.latest.players, faction, poolIds: this.poolIds(),
      exclude: this.skipSet(faction, now), scoreOf: this.scoreOf,
    });
    if (!candidates.length) {
      if (!st.vacantLogged) {
        st.vacantLogged = true;
        const anyone = this.latest.players.some((p) => p.factionKey === faction);
        await this.log(anyone
          ? `🎖️ ${f.label}: no commander, and everyone verified on ${f.label} has passed recently. Anyone on it can **/claim**; I'll ask again as cooldowns run out or people join.`
          : `🎖️ ${f.label}: no commander — nobody verified is on ${f.label}. I'll offer it as soon as someone joins.`);
      }
      return;
    }
    st.vacantLogged = false;
    const pick = candidates[Math.floor(Math.random() * candidates.length)];
    await this.offer(faction, pick, tier);
  }

  async offer(faction, pick, tier = 'pool') {
    const f = byKey(faction);
    const st = this.state[faction];
    const secs = this.config.commanderAcceptSec;
    const matchId = this.matchId;
    st.offer = {
      discordId: pick.discordId,
      timer: setTimeout(() => this.resolveOffer(faction, pick.discordId, 'timeout', matchId), secs * 1000),
    };
    this.core.commanderLog(matchId, faction, pick.discordId, 'offered');

    const vc = this.voiceChannel(faction);
    const inVoice = vc && this.voiceOf(pick.discordId) === vc.id;

    // The DM goes FIRST, even though they're looking at the game, because
    // whether it arrived changes what the in-game whisper should tell them to
    // do. Plenty of people have DMs from server members turned off, which is
    // Discord's default in some setups: telling those people to press a button
    // they cannot see is how an offer times out for no reason.
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`cmd:accept:${faction}:${matchId}`).setLabel(`Accept ${f.label} command`).setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`cmd:decline:${faction}:${matchId}`).setLabel('Not this time').setStyle(ButtonStyle.Secondary),
    );
    const member = await this.guild.members.fetch(pick.discordId).catch(() => null);
    const dmSent = await member?.send({
      content: `🎖️ You've been picked to command **${f.label}** this match. You have ${secs} seconds.\n`
        + (inVoice ? '' : `Join **${f.voiceChannelName}** after accepting.\n`)
        + `Once you accept you can speak in **${f.voiceChannelName}**; everyone else on ${f.label} hears you.`
        + (tier === 'random' ? `\n_Nobody in the Commander Pool was on ${f.label}, so you were drawn at random. "Not this time" is fine._` : ''),
      components: [row],
    }).then(() => true, () => false) ?? false;

    await this.core.message(pick.steamId, offerWhisper({
      label: f.label, secs, dmSent, inVoice, voiceChannelName: f.voiceChannelName,
    })).catch((err) => console.warn('[commander] in-game whisper failed:', err.message));

    await this.log(`🎖️ ${f.label}: offered command to <@${pick.discordId}> (${tier === 'pool' ? 'Commander Pool' : 'random — no pool members on this faction'}${inVoice ? '' : ', not in voice yet'}; ${secs}s to accept).`
      + (dmSent ? '' : "\n⚠️ I couldn't DM them, so they can't see the Accept button. They've been told in game to type `/accept` instead. Worth asking them to turn on direct messages from server members."));
  }

  /** outcome: accepted | declined | timeout */
  async resolveOffer(faction, discordId, outcome, matchId = this.matchId) {
    const st = this.state[faction];
    if (matchId !== this.matchId || st.offer?.discordId !== discordId) return false;
    clearTimeout(st.offer.timer);
    st.offer = null;
    this.core.commanderLog(this.matchId, faction, discordId, outcome);
    const f = byKey(faction);
    if (outcome === 'accepted') {
      await this.grant(faction, discordId, 'accepted');
      return true;
    }
    this.pass(faction, discordId, outcome === 'timeout' ? 'timeout' : 'declined');
    await this.log(`🎖️ ${f.label}: <@${discordId}> ${outcome === 'timeout' ? "didn't answer in time" : 'passed'}. Offering to someone else.`);
    await this.select(faction);
    return true;
  }

  async grant(faction, discordId, how) {
    const f = byKey(faction);
    const st = this.state[faction];
    const role = this.role(faction);
    const member = await this.guild.members.fetch(discordId).catch(() => null);
    if (!role || !member) {
      await this.log(`⚠️ ${f.label}: couldn't give the commander role (role "${f.commanderRoleName}" missing, or member left).`);
      return false;
    }
    try {
      await member.roles.add(role, `SIXDOGS: ${f.label} commander (${how})`);
    } catch (err) {
      // Almost always the role sitting at or above the bot's own in the role
      // list. Discord refuses that, and until now the throw went to the console
      // and the person was left thinking they were commander with none of the
      // access. Say it where an admin will see it.
      await this.log(`❌ ${f.label}: couldn't give <@${discordId}> the **${f.commanderRoleName}** role. `
        + `${err.message}\nMost likely my own role sits below it. Server Settings -> Roles, drag mine above it, then run \`/healthcheck\`.`);
      return false;
    }
    st.commanderId = discordId;
    st.vacantLogged = false;
    st.awaySince = null;
    await this.log(`✅ ${f.label} commander: <@${discordId}> (${how}).`);
    const player = this.latest.players.find((p) => p.discordId === discordId);
    if (player) {
      this.core.message(player.steamId, `You are ${f.label} commander. You're live in ${f.voiceChannelName}. Make sure you read team chat for comms.`).catch(() => {});
    }
    // Everyone in the game is told who is commanding, not just the commander.
    // The in-game name is what the rest of the server recognises; the Discord
    // name is only a fallback for someone who has just left the server.
    const shown = player?.name || member.displayName || member.user?.username;
    if (shown) this.announce(`A new ${f.label} commander has been chosen: ${shown}`);
    return true;
  }

  /**
   * Say something to everyone in the game. Never allowed to break whatever
   * asked for it: a build without broadcasts, or a server that hiccups, must
   * not stop someone becoming commander. Fire and forget on purpose.
   */
  announce(text) {
    try {
      const sent = this.core.broadcast?.(text);
      sent?.catch?.((err) => console.warn(`[commander] couldn't announce to the server: ${err.message}`));
    } catch (err) {
      console.warn(`[commander] couldn't announce to the server: ${err.message}`);
    }
  }

  async remove(faction, why, { cooldown = 'removed', reselect = true } = {}) {
    const st = this.state[faction];
    const id = st.commanderId;
    if (!id) return null;
    st.commanderId = null;
    st.awaySince = null;
    this.pass(faction, id, cooldown);
    const role = this.role(faction);
    const member = await this.guild.members.fetch(id).catch(() => null);
    if (role && member) await member.roles.remove(role, `SIXDOGS: ${why}`).catch(() => {});
    this.core.commanderLog(this.matchId, faction, id, 'removed');
    await this.log(`🎖️ ${byKey(faction).label}: <@${id}> is no longer commander (${why}).`);
    if (reselect) await this.select(faction);
    return id;
  }

  // ---- user actions ----

  pendingOfferFor(discordId) {
    return FACTIONS.map((f) => f.key).find((k) => this.state[k].offer?.discordId === discordId) ?? null;
  }
  commandingFaction(discordId) {
    return FACTIONS.map((f) => f.key).find((k) => this.state[k].commanderId === discordId) ?? null;
  }

  async accept(discordId) {
    const faction = this.pendingOfferFor(discordId);
    if (!faction) return { ok: false, message: "You don't have a pending commander offer." };
    await this.resolveOffer(faction, discordId, 'accepted');
    return { ok: true, message: `You're ${byKey(faction).label} commander. You can now speak in ${byKey(faction).voiceChannelName}.` };
  }

  async decline(discordId) {
    const faction = this.pendingOfferFor(discordId);
    if (!faction) return { ok: false, message: "You don't have a pending commander offer." };
    await this.resolveOffer(faction, discordId, 'declined');
    return { ok: true, message: 'No problem — passing it on.' };
  }

  async standdown(discordId) {
    const faction = this.commandingFaction(discordId);
    if (!faction) return { ok: false, message: "You're not commanding right now." };
    this.core.commanderLog(this.matchId, faction, discordId, 'standdown');
    await this.remove(faction, 'stood down', { cooldown: 'standdown' });
    return { ok: true, message: 'Stood down. Thanks for commanding.' };
  }

  async claim(discordId) {
    const player = this.latest.players.find((p) => p.discordId === discordId);
    if (!player?.factionKey) return { ok: false, message: "You need to be verified and in-game on a faction to claim command." };
    const faction = player.factionKey;
    const f = byKey(faction);
    const st = this.state[faction];
    if (st.commanderId) return { ok: false, message: `${f.label} already has a commander: <@${st.commanderId}>.` };
    if (st.offer) return { ok: false, message: `${f.label} command is currently being offered to someone. Try again in a minute.` };
    this.core.commanderLog(this.matchId, faction, discordId, 'claimed');
    await this.grant(faction, discordId, 'claimed');
    return { ok: true, message: `You're ${f.label} commander. You can now speak in ${f.voiceChannelName}.` };
  }

  async adminReroll(faction) {
    const st = this.state[faction];
    if (st.offer) {
      clearTimeout(st.offer.timer);
      this.pass(faction, st.offer.discordId, 'reroll');
      st.offer = null;
    }
    if (st.commanderId) await this.remove(faction, 'admin re-roll', { cooldown: 'reroll', reselect: false });
    st.vacantLogged = false;
    this.settleUntil = Math.min(this.settleUntil, Date.now()); // an admin asked: don't wait
    await this.select(faction);
  }

  // ---- called every sync tick ----

  /**
   * @param players linked players on the server [{discordId, steamId, name, factionKey}]
   * @param factionOf discordId -> faction the tracker currently assigns (respects leave grace)
   */
  async tick(players, factionOf, now = Date.now()) {
    this.latest.players = players;
    for (const f of FACTIONS) {
      const st = this.state[f.key];

      if (st.commanderId) {
        const id = st.commanderId;
        const me = players.find((p) => p.discordId === id);
        if (me?.factionKey && me.factionKey !== f.key) {
          // Moved to another side: they can't lead this one any more.
          await this.remove(f.key, 'switched sides', { reselect: false });
        } else if (!me) {
          // Off the server: keep the job for COMMANDER_AWAY_SEC in case they're back quickly.
          st.awaySince ??= now;
          const awaySec = this.config.commanderAwaySec ?? 300;
          if (now - st.awaySince > awaySec * 1000) {
            await this.remove(f.key, `left the server for over ${Math.round(awaySec / 60)} min`, { reselect: false });
          }
        } else {
          st.awaySince = null;
        }
      }

      // The person we're asking left the faction or the server: stop waiting on them.
      if (st.offer && factionOf(st.offer.discordId) !== f.key) {
        await this.resolveOffer(f.key, st.offer.discordId, 'timeout');
      }

      // The rule: an empty slot gets filled whenever someone can fill it.
      await this.select(f.key, now);
    }
  }

  summary() {
    return FACTIONS.map((f) => {
      const st = this.state[f.key];
      const who = st.commanderId ? `<@${st.commanderId}>`
        : st.offer ? `being offered to <@${st.offer.discordId}>`
        : Date.now() < this.settleUntil ? 'match just started — offering shortly'
        : 'vacant — anyone on it can /claim';
      return `**${f.label}**: ${who}`;
    }).join('\n');
  }
}
