// Seeding (Discord side): a board in #start-a-match where people say "I'd play
// right now", and one ping when enough of them have.
//
// Why it exists: a 24/7 server at zero players stays at zero. Somebody has to
// go first, sit on an empty map and wait, and almost nobody will. This turns
// that wait into a list: click once, go and do something else, and when the
// list is long enough everyone gets called in together.
//
// The rules (how long a pledge lasts, how many are needed, how often a ping is
// allowed) live in core, so there is one copy of them and they survive a bot
// restart. This file only shows them and presses the button.

import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, MessageFlags } from 'discord.js';

/** How the board message is recognised again after a restart. */
export const SEED_FOOTER = 'Seeding board';
const GOLD = 0xc9a227;
const MAX_NAMES = 12;
/** The board is refreshed on a slower beat than the faction sync; nothing here is urgent. */
const CHECK_MS = 15_000;

const joinLine = (serverId) => (serverId
  ? `In WARDOGS: **Community servers → Join by ID** and enter\n\`\`\`${serverId}\`\`\``
  : '');

/**
 * The board. Pure, so what it says can be checked without Discord.
 *
 * `names` are display names of the people currently down, already resolved.
 * Names, not mentions: the board is edited every few minutes and a mention
 * that gets edited repeatedly is a good way to annoy people.
 */
export function seedBoard(s, { names = [], serverId = null } = {}) {
  const ready = s?.ready ?? 0;
  const target = s?.target ?? 10;
  const busy = (s?.playersOn ?? 0) > 0 && (s?.playersOn ?? 0) >= (s?.quietAbove ?? target);
  const lines = [];

  if (!s?.serverOk) {
    lines.push("The game server isn't answering at the moment, so nobody is being called in. "
      + 'You can still put your name down: it counts as soon as the server is back.');
  } else if (busy) {
    lines.push(`**${s.playersOn} playing right now.** No need to seed anything, just join.`);
  } else {
    lines.push("Nobody wants to be the first one on an empty server, so don't be alone in there. "
      + `Put your name down, go and do something else, and when **${target}** people are ready `
      + 'everyone gets called in at once.');
  }

  lines.push('', ready >= target ? `**${ready} ready.** Calling everyone in.` : `**${ready} of ${target} ready**`);
  if (names.length) {
    const shown = names.slice(0, MAX_NAMES).join(', ');
    lines.push(names.length > MAX_NAMES ? `${shown} and ${names.length - MAX_NAMES} more` : shown);
  } else if (s?.serverOk && !busy) {
    lines.push('Nobody yet. Be the first and the rest will follow.');
  }

  const embed = {
    title: 'Get a match going',
    color: GOLD,
    description: lines.join('\n'),
    footer: { text: `${SEED_FOOTER} · your name comes off after ${s?.pledgeMinutes ?? 45} minutes, or as soon as you join the server` },
  };
  const join = joinLine(serverId);
  if (join) embed.fields = [{ name: 'Already going in?', value: join }];

  const components = [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('seed:in').setLabel("I'd play right now").setEmoji('🟢').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('seed:out').setLabel('Take me off').setStyle(ButtonStyle.Secondary),
  )];
  return { content: '', embeds: [embed], components, allowedMentions: { parse: [] } };
}

/** What the ping itself says. Separate message: editing a board notifies nobody. */
export function callInMessage({ ready, roleId, serverId }) {
  const who = roleId ? `<@&${roleId}> ` : '';
  const lines = [
    `${who}**${ready} players are ready right now.** Get in and let's go.`,
    joinLine(serverId),
  ].filter(Boolean);
  return {
    content: lines.join('\n'),
    allowedMentions: roleId ? { roles: [roleId] } : { parse: [] },
  };
}

/** Enough of the board to tell whether it needs editing at all. */
const signature = (payload) => JSON.stringify(payload.embeds);

export class Seeding {
  constructor({ core, config, log }) {
    this.core = core;
    this.config = config;
    this.log = log;
    this.guild = null;
    this.message = null;
    this.lastSig = null;
    this.nextCheck = 0;
    this.busy = false;
    this.warned = null;
    this.serverId = null;
  }

  attach(guild) { this.guild = guild; }

  channel() {
    return this.guild?.channels.cache.find(
      (c) => c.type === ChannelType.GuildText && c.name === this.config.seedChannel) ?? null;
  }

  pingRole() {
    return this.guild?.roles.cache.find((r) => r.name === this.config.seedPingRoleName) ?? null;
  }

  names(pledges) {
    return (pledges ?? []).map((p) => this.guild?.members.cache.get(p.discordId)?.displayName)
      .filter(Boolean);
  }

  /** Warn about the same thing at most once, so a missing channel isn't a log flood. */
  warn(key, text) {
    if (this.warned === key) return;
    this.warned = key;
    console.warn(`[seed] ${text}`);
  }

  /** The existing board, found by its footer so it survives restarts and redeploys. */
  async findBoard(channel) {
    if (this.message) return this.message;
    const recent = await channel.messages.fetch({ limit: 50 }).catch(() => null);
    this.message = [...(recent?.values() ?? [])]
      .filter((m) => m.author.id === this.guild.client.user.id
        && (m.embeds?.[0]?.footer?.text ?? '').startsWith(SEED_FOOTER))
      .sort((a, b) => b.createdTimestamp - a.createdTimestamp)[0] ?? null;
    return this.message;
  }

  async render(summary) {
    const channel = this.channel();
    if (!channel) return this.warn('channel', `no #${this.config.seedChannel} channel yet — run /setup-server`);
    const payload = seedBoard(summary, { names: this.names(summary.pledges), serverId: this.serverId });
    const sig = signature(payload);
    const existing = await this.findBoard(channel);
    if (!existing) {
      this.message = await channel.send(payload);
      this.lastSig = sig;
      console.log(`[seed] posted the board in #${channel.name}`);
      return;
    }
    if (sig === this.lastSig) return;
    await existing.edit(payload).catch((err) => {
      // Somebody deleted it: forget it and post a fresh one next time round.
      this.message = null;
      this.lastSig = null;
      console.warn(`[seed] couldn't edit the board: ${err.message}`);
    });
    this.lastSig = sig;
  }

  /** Called from the sync tick, with whatever core last said about the server. */
  async tick(state) {
    if (this.config.coreDisabled || !this.guild || this.busy) return;
    const now = Date.now();
    if (now < this.nextCheck) return;
    this.nextCheck = now + CHECK_MS;
    this.serverId = this.config.gameServerId || state?.serverId || this.serverId;
    this.busy = true;
    try {
      const summary = await this.core.seedState();
      this.warned = null;
      if (summary.fire) await this.callEveryoneIn();
      else await this.render(summary);
    } catch (err) {
      this.warn('core', `couldn't read the seeding list: ${err.message}`);
    } finally {
      this.busy = false;
    }
  }

  /**
   * Fire the ping. Core decides whether it really happens, so two ticks landing
   * together can't ping twice; if this one lost the race it just redraws.
   */
  async callEveryoneIn({ force = false } = {}) {
    const r = await this.core.seedPing(force);
    if (!r.fired) {
      if (r.ok && r.ready !== undefined) await this.render(r);
      return r;
    }
    const channel = this.channel();
    const role = this.pingRole();
    if (!role) this.warn('role', `no "${this.config.seedPingRoleName}" role — run /setup-server. Calling in without a ping.`);
    if (channel) {
      await channel.send(callInMessage({ ready: r.ready, roleId: role?.id ?? null, serverId: this.serverId }))
        .catch((err) => console.warn(`[seed] couldn't send the call-in: ${err.message}`));
      // The ping now sits below the board, so put a fresh board underneath it.
      // Found first, in case this process never saw the old one.
      await this.findBoard(channel).then((m) => m?.delete()).catch(() => {});
      this.message = null;
      this.lastSig = null;
    }
    await this.log(`📣 Called everyone in: ${r.ready} players were ready${force ? ' (asked for by an admin)' : ''}.`);
    // Read the list back rather than guessing at it: core has just emptied it.
    await this.core.seedState().then((s) => this.render(s)).catch(() => {});
    return r;
  }

  /** A board button was pressed. */
  async onButton(i) {
    const on = i.customId === 'seed:in';
    const summary = await this.core.seedPledge(i.user.id, on);
    this.message = i.message;
    const payload = seedBoard(summary, { names: this.names(summary.pledges), serverId: this.serverId });
    this.lastSig = signature(payload);
    await i.update(payload);
    // The board shows the count; this says plainly what just happened to you.
    const left = Math.max(0, (summary.target ?? 0) - summary.ready);
    await i.followUp({
      content: on
        ? (left
          ? `You're down to play. ${left} more and everyone gets called in.`
          : "You're down to play. That's enough people: calling everyone in now.")
        : "Taken off the list. Put your name back any time.",
      flags: MessageFlags.Ephemeral,
    }).catch(() => {});
    // Their click may have been the one that tipped it over.
    if (summary.fire) {
      this.nextCheck = 0;
      await this.callEveryoneIn().catch((err) => console.warn(`[seed] call-in failed: ${err.message}`));
    }
  }

  /** For /seed: the plain-words version of what the rules are doing. */
  async describe() {
    const s = await this.core.seedState();
    const when = s.lastPingAt ? `<t:${Math.floor(Date.parse(s.lastPingAt) / 1000)}:R>` : 'never';
    return [
      `**${s.ready} of ${s.target}** ready to play${s.playersOn ? `, ${s.playersOn} already on the server` : ''}.`,
      s.fire ? '**Calling everyone in.**' : `Not calling anyone in: ${s.reason}.`,
      `Last call-in: ${when}. A name lasts ${s.pledgeMinutes} min; a ping at most once every ${s.cooldownMinutes} min.`,
      s.pledges.length ? `Down to play: ${this.names(s.pledges).join(', ') || `${s.pledges.length} member(s)`}` : '',
    ].filter(Boolean).join('\n');
  }
}
