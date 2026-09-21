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
/** Embed descriptions cap at 4096 characters; leave room for everything else. */
const NAMES_BUDGET = 2500;
/** The board is refreshed on a slower beat than the faction sync; nothing here is urgent. */
const CHECK_MS = 15_000;

const joinLine = (serverId) => (serverId
  ? `In WARDOGS: **Community servers → Join by ID** and enter\n\`\`\`${serverId}\`\`\``
  : '');

/**
 * The board. Pure, so what it says can be checked without Discord.
 *
 * `names` are display names of everyone on the list, already resolved. Everyone,
 * not a sample: seeing your own name on it is the confirmation that the click
 * worked, and a list that hides most of itself can't do that job. Names, not
 * mentions, because the board is edited often and a mention that gets edited
 * over and over is a good way to annoy people.
 */
export function seedBoard(s, { names = [], serverId = null } = {}) {
  const ready = s?.ready ?? 0;
  const target = s?.target ?? 45;
  const onServer = s?.playersOn ?? 0;
  const playing = onServer >= target;
  const down = !s?.serverOk;
  const lines = [];

  if (down) {
    lines.push("The game server isn't answering at the moment, so nobody is being called in. "
      + 'You can still put your name down: it counts as soon as the server is back.');
  } else if (playing) {
    lines.push(`**${onServer} playing right now.** The match is on, just join.`);
  } else {
    lines.push('Say you want to play and your name goes on the list below. When '
      + `**${target}** of us want in, everyone gets pinged and the match can start.`
      // The complaint that produced this line: people click, then go and warm up
      // in the server, and an earlier version took their name straight back off.
      + '\n\nYour name stays on whether you wait in the server or go and do something else.');
  }

  if (!playing) {
    lines.push('', `**${ready} of ${target} want to play**`);
    if (names.length) lines.push(nameList(names));
    else if (!down) lines.push('Nobody yet. Say so and the rest will follow.');
  }

  // The list is emptied by a call-in, so without this the board would drop back
  // to "0 of 45" and read as though nothing had ever happened.
  if (s?.lastCallAt) {
    lines.push('', `Everyone was last called in <t:${Math.floor(Date.parse(s.lastCallAt) / 1000)}:R>.`);
  }

  const embed = {
    title: playing ? 'The match is on' : 'Want to play?',
    color: GOLD,
    description: lines.join('\n'),
    footer: { text: `${SEED_FOOTER} · your name comes off by itself after ${Math.round((s?.pledgeMinutes ?? 180) / 60)} hours` },
  };
  const join = joinLine(serverId);
  if (join) embed.fields = [{ name: playing ? 'How to join' : 'Going in early?', value: join }];

  // No buttons once the match is running: the honest action is to join, not to
  // add your name to a list for something that is already happening.
  const components = playing ? [] : [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('seed:in').setLabel('I want to play').setEmoji('🟢').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('seed:out').setLabel('Take me off').setStyle(ButtonStyle.Secondary),
  )];
  return { content: '', embeds: [embed], components, allowedMentions: { parse: [] } };
}

/**
 * Everyone's name, unless that would blow the embed's 4096 character budget.
 * The cap is a safety net for a runaway list, not a display choice.
 */
function nameList(names) {
  const out = [];
  let size = 0;
  for (const n of names) {
    if (size + n.length + 2 > NAMES_BUDGET) {
      return `${out.join(', ')} and ${names.length - out.length} more`;
    }
    out.push(n);
    size += n.length + 2;
  }
  return out.join(', ');
}

/**
 * The messages that actually ping people. Separate from the board, because
 * editing a board notifies nobody.
 *
 *  nudge — early, to recruit the rest. The count is the point: "10/45" tells
 *          someone reading it whether clicking is worth their while.
 *  call  — the match can start. Everything else gets out of its way.
 */
export function callInMessage({ kind = 'call', ready, target, roleId, serverId, channelId = null }) {
  const who = roleId ? `<@&${roleId}> ` : '';
  const here = channelId ? `<#${channelId}>` : 'this channel';
  const lines = kind === 'nudge'
    ? [
      `${who}**${ready} ${ready === 1 ? 'person wants' : 'people want'} to play!** (${ready}/${target})`,
      `If you want in, click **I want to play** in ${here}. Everyone gets pinged again once ${target} of us want a match.`,
    ]
    : [
      `${who}**${ready} of us want to play!** That's a match. Get in.`,
      joinLine(serverId),
    ];
  return {
    content: lines.filter(Boolean).join('\n'),
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
      if (summary.action) await this.post(summary.action);
      else await this.render(summary);
    } catch (err) {
      this.warn('core', `couldn't read the seeding list: ${err.message}`);
    } finally {
      this.busy = false;
    }
  }

  /**
   * Post a ping. Core decides whether it really happens, so two ticks landing
   * together can't ping twice; if this one lost the race it just redraws.
   *
   * A nudge leaves the board where it is. A call empties the list, so the board
   * is reposted below the ping where people will actually see it.
   */
  async post(kind, { force = false } = {}) {
    const r = await this.core.seedPing(kind, force);
    if (!r.fired) {
      if (r.ok && r.ready !== undefined) await this.render(r);
      return r;
    }
    const channel = this.channel();
    const role = this.pingRole();
    if (!role) this.warn('role', `no "${this.config.seedPingRoleName}" role — run /setup-server. Posting without a ping.`);
    if (channel) {
      await channel.send(callInMessage({
        kind, ready: r.ready, target: r.target, roleId: role?.id ?? null,
        serverId: this.serverId, channelId: channel.id,
      })).catch((err) => console.warn(`[seed] couldn't post the ${kind}: ${err.message}`));
      if (kind === 'call') {
        // The ping now sits below the board, so put a fresh board underneath it.
        // Found first, in case this process never saw the old one.
        await this.findBoard(channel).then((m) => m?.delete()).catch(() => {});
        this.message = null;
        this.lastSig = null;
      }
    }
    await this.log(kind === 'call'
      ? `📣 Called everyone in: ${r.ready} wanted to play${force ? ' (asked for by an admin)' : ''}.`
      : `📣 Told ${this.config.seedPingRoleName} that ${r.ready} of ${r.target} want a match.`);
    // Read the list back rather than guessing at it.
    await this.core.seedState().then((x) => this.render(x)).catch(() => {});
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
    const left = summary.needed ?? 0;
    await i.followUp({
      content: on
        ? (left
          ? `You're on the list. ${left} more and everyone gets called in. Wait in the server if you like, your name stays on either way.`
          : "You're on the list, and that's enough people. Calling everyone in now.")
        : 'Taken off the list. Put your name back any time.',
      flags: MessageFlags.Ephemeral,
    }).catch(() => {});
    // Their click may have been the one that tipped it over.
    if (summary.action) {
      this.nextCheck = 0;
      await this.post(summary.action).catch((err) => console.warn(`[seed] ${summary.action} failed: ${err.message}`));
    }
  }

  /** For /seed: the plain-words version of what the rules are doing. */
  async describe() {
    const s = await this.core.seedState();
    const when = (at) => (at ? `<t:${Math.floor(Date.parse(at) / 1000)}:R>` : 'never');
    const doing = { call: '**Calling everyone in.**', nudge: `**Telling ${this.config.seedPingRoleName} about it.**` };
    return [
      `**${s.ready} of ${s.target} want to play**, and ${s.playersOn} ${s.playersOn === 1 ? 'is' : 'are'} on the server.`,
      doing[s.action] ?? `Nothing being sent: ${s.reason}.`,
      `Last call-in ${when(s.lastCallAt)}, last heads-up ${when(s.lastNudgeAt)}. `
        + `A name lasts ${Math.round(s.pledgeMinutes / 60)} h; each message at most once every ${s.cooldownMinutes} min.`,
      s.pledges.length ? `On the list: ${this.names(s.pledges).join(', ') || `${s.pledges.length} member(s)`}` : '',
    ].filter(Boolean).join('\n');
  }
}
