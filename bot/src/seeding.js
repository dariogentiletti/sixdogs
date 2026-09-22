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

import { fileURLToPath } from 'node:url';
import { stat } from 'node:fs/promises';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, MessageFlags } from 'discord.js';

/** How the board message is recognised again after a restart. */
export const SEED_FOOTER = 'Seeding board';
/** The explainer picture that sits above the board (content/, built in design/verify-guide). */
export const SEED_GUIDE = 'start-a-match.jpg';
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
export function seedBoard(s, { names = [], serverId = null, lobbyId = null } = {}) {
  const ready = s?.ready ?? 0;
  const target = s?.target ?? 45;
  const onServer = s?.playersOn ?? 0;
  const waiting = s?.waiting ?? 0;
  const heading = s?.heading ?? ready;
  const playing = onServer >= target;
  const down = !s?.serverOk;
  const lines = [];

  if (down) {
    lines.push("The game server isn't answering at the moment, so nobody is being called in. "
      + 'You can still put your name down: it counts as soon as the server is back.');
  } else if (playing) {
    lines.push(`**${onServer} playing right now.** The match is on, just join.`);
  } else {
    // Say what this is FOR before saying what it does. Somebody arriving in the
    // channel for the first time needs to recognise their own situation ("I
    // want to play but there's nobody on") before a button means anything.
    lines.push("**Not enough people on to play?** This is how you fix that without "
      + 'sitting in an empty server waiting for company.'
      + '\n\nClick **I want to play** and your name goes on the list below. '
      // The complaint that produced this line: people click, then go and warm up
      // in the server, and an earlier version took their name straight back off.
      + 'It stays there, so go and do something else. Play another game, make dinner, '
      + "whatever. You are not holding a seat and you are not stuck here."
      + `\n\nWhen **${target}** of us want a game, everyone gets pinged at once and we all `
      + 'drop in together. That way the first person in walks into a full match instead of an empty map.');
  }

  if (!playing) {
    lines.push('', `**${ready} of ${target} want to play**`);
    if (names.length) lines.push(nameList(names));
    else if (!down) lines.push('Nobody yet. Say so and the rest will follow.');
    // Anybody already standing in the server counts towards the same match, so
    // the board has to say so or the numbers look like they do not add up.
    if (waiting > 0) {
      lines.push(`Plus **${waiting}** already waiting in the server, so **${heading} of ${target}**.`);
    }
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
  if (playing) {
    const join = joinLine(serverId);
    if (join) embed.fields = [{ name: 'How to join', value: join }];
  } else if (!down) {
    // This field used to be "Going in early?" with the Server ID under it, which
    // pointed people straight at a lobby where nothing happens. Below the target
    // WARDOGS does not start a match at all: you spawn in your team's lobby, you
    // can walk around, and the game mode does nothing. Somebody who goes in to
    // "help" has a dead ten minutes and leaves, and they do not come back. So
    // the board now says that plainly instead of inviting them in.
    embed.fields = [{
      name: 'Why not just go and wait in the server?',
      value: `Because below **${target}** the match does not start. You spawn in your team's lobby, `
        + 'you can walk around an empty map, and that is all that happens. Put your name down here '
        + 'instead and get on with your evening.'
        + (lobbyId ? `\n\nIf you would rather wait with company, <#${lobbyId}> is open.` : ''),
    }];
  }

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

  /**
   * The voice channel to wait in. Waiting alone on a dead map is what makes
   * people give up; waiting with company is just hanging about with friends.
   */
  lobbyId() {
    return this.guild?.channels.cache.find(
      (c) => c.type === ChannelType.GuildVoice && c.name === 'Command Lobby')?.id ?? null;
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

  /**
   * The explainer picture, above the board, kept in step with the file.
   *
   * Not a channel post from content/: #start-a-match is skipped by syncPosts
   * because the board lives here and syncPosts would delete it. So this puts the
   * picture up itself.
   *
   * Matching on the file NAME alone is not enough, and getting that wrong was
   * the whole bug: the picture was redrawn, the name did not change, so the old
   * one stayed up and the redraw never reached anybody. The byte size is
   * compared as well, the same way syncPosts tells its own pictures apart, and
   * a picture that no longer matches the file is replaced.
   *
   * @returns true if it was just posted, which means the board is now ABOVE it
   *   and has to be moved.
   */
  /** Where the picture lives. Its own method so a test can point it elsewhere. */
  guidePath() {
    return fileURLToPath(new URL(`../../content/${SEED_GUIDE}`, import.meta.url));
  }

  async ensureGuide(channel) {
    const path = this.guidePath();
    const file = await stat(path).catch(() => null);
    if (!file) {
      this.warn('guide', `content/${SEED_GUIDE} is missing, so the board goes up without its picture`);
      return false;
    }
    const recent = await channel.messages.fetch({ limit: 50 }).catch(() => null);
    const mine = [...(recent?.values() ?? [])].filter((m) => m.author.id === this.guild.client.user.id);
    const posted = mine.filter((m) => [...m.attachments.values()].some((a) => a.name === SEED_GUIDE));
    const current = posted.find((m) => [...m.attachments.values()]
      .some((a) => a.name === SEED_GUIDE && a.size === file.size));
    if (current && posted.length === 1) return false;
    // Either it has changed, or there is more than one copy up. Clear them all
    // and post once, so the channel never ends up with two versions of it.
    for (const m of posted) await m.delete().catch(() => {});
    await channel.send({ files: [{ attachment: path, name: SEED_GUIDE }], allowedMentions: { parse: [] } });
    console.log(`[seed] ${posted.length ? 'replaced' : 'posted'} the guide picture in #${channel.name}`);
    return true;
  }

  async render(summary) {
    const channel = this.channel();
    if (!channel) return this.warn('channel', `no #${this.config.seedChannel} channel yet — run /setup-server`);
    // The picture belongs above the board, so if it has only just gone up, the
    // board has to be posted again underneath it.
    if (await this.ensureGuide(channel).catch(() => false)) {
      await this.findBoard(channel).then((m) => m?.delete()).catch(() => {});
      this.message = null;
      this.lastSig = null;
    }
    const payload = seedBoard(summary, { names: this.names(summary.pledges), serverId: this.serverId, lobbyId: this.lobbyId() });
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
    const payload = seedBoard(summary, { names: this.names(summary.pledges), serverId: this.serverId, lobbyId: this.lobbyId() });
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
      s.targetFromServer
        ? `The ${s.target} comes from the game server's own match-start setting, so the two always agree.`
        : `Using SEED_TARGET (${s.target}): the game server's own setting couldn't be read, so check they agree.`,
      doing[s.action] ?? `Nothing being sent: ${s.reason}.`,
      `Last call-in ${when(s.lastCallAt)}, last heads-up ${when(s.lastNudgeAt)}. `
        + `A name lasts ${Math.round(s.pledgeMinutes / 60)} h; each message at most once every ${s.cooldownMinutes} min.`,
      s.pledges.length ? `On the list: ${this.names(s.pledges).join(', ') || `${s.pledges.length} member(s)`}` : '',
    ].filter(Boolean).join('\n');
  }
}
