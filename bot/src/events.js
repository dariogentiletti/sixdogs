// Scheduled matches ("operations"), Discord side: a board in #operations with
// RSVP buttons, and the notices that actually ping people.
//
// Why a fixed time exists at all is in core/src/events.js, and it comes down to
// one fact about this game: under the target, WARDOGS does not start a match.
// You spawn in your team's lobby, walk around an empty map, and nothing
// happens. So nobody can trickle in and build it up, and the only thing that
// works is everybody arriving at once. An event is how you arrange that days
// ahead instead of hoping.
//
// The rules (when the go/no-go happens, who has answered, what has already been
// announced) live in core so they survive a bot restart and so two ticks can't
// announce the same thing twice. This file shows them and presses the buttons.

import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType } from 'discord.js';

/** How the board is found again after a restart. */
export const EVENT_FOOTER = 'Operations board';
const GOLD = 0xc9a227;
const GREEN = 0x3aa655;
const RED = 0xa3261f;
/** The board is not urgent; the notices are what people actually see. */
const CHECK_MS = 60_000;

/** Discord renders this in each person's own timezone, which is the whole point. */
const when = (iso, style = 'F') => `<t:${Math.floor(Date.parse(iso) / 1000)}:${style}>`;

const namesOf = (ids, nameOf) => ids.map((id) => nameOf(id)).filter(Boolean);

/**
 * A channel as a clickable link when we know its id, plain text when not.
 *
 * Messages built here are sent as they are. The `{#channel}` shorthand is only
 * expanded for the content/*.md posts, so writing it in code puts literal
 * braces in front of people.
 */
const channelRef = (id, name) => (id ? `<#${id}>` : `#${name}`);

/**
 * The board. Pure, so the wording can be checked without Discord.
 *
 * It shows ONE event — the next one. A list of five dates is a thing to scroll
 * past; one date with a button is a decision.
 */
export function eventBoard(event, {
  nameOf = (id) => `<@${id}>`, upcoming = [], serverId = null, seedChannelId = null,
} = {}) {
  if (!event) {
    return {
      content: '',
      embeds: [{
        title: 'No match night on the calendar',
        color: GOLD,
        description: 'When an admin puts one up it appears here, with a button to say you are coming.'
          + `\n\nIn the meantime, ${channelRef(seedChannelId, 'start-a-match')} is the way to get a game going today.`,
        footer: { text: EVENT_FOOTER },
      }],
      components: [],
      allowedMentions: { parse: [] },
    };
  }

  const yes = event.yes ?? [];
  const maybe = event.maybe ?? [];
  const target = event.target ?? 45;
  const going = event.cancelledAt ? 'off' : (event.sent ?? []).includes('go') ? 'on' : 'open';
  const lines = [];

  if (event.cancelledAt) {
    lines.push(`**Called off.**${event.cancelReason ? ` ${event.cancelReason}` : ''}`);
  } else if (going === 'on') {
    lines.push(`**It's on.** ${yes.length} of us are coming. Be in by ${when(event.startsAt, 't')}.`);
  } else {
    lines.push(`${when(event.startsAt)} · ${when(event.startsAt, 'R')}`);
    // The honest bit. People need to know that turning up early achieves
    // nothing, or the ones who care most waste their evening on an empty map.
    lines.push(`\nWe need **${target}** for the match to start at all. Below that the game `
      + "doesn't begin: you spawn in your team's lobby and walk around an empty map. "
      + 'So say whether you are coming, and we will only run it if enough of us are.');
    lines.push(`\nAn hour before, everyone gets told whether it is on or off. `
      + 'Nobody has to sit in an empty server to find out.');
  }

  lines.push('', `**${yes.length} of ${target} coming**`);
  const yesNames = namesOf(yes, nameOf);
  if (yesNames.length) lines.push(yesNames.join(', ').slice(0, 1500));
  else if (!event.cancelledAt) lines.push('Nobody yet. Be the first and the rest follow.');
  const maybeNames = namesOf(maybe, nameOf);
  if (maybeNames.length) lines.push(`\n_Maybe:_ ${maybeNames.join(', ').slice(0, 500)}`);

  if (upcoming.length > 1) {
    const rest = upcoming.filter((e) => e.id !== event.id).slice(0, 3)
      .map((e) => `${when(e.startsAt, 'd')} · ${e.title}`);
    if (rest.length) lines.push('', `**Also coming up**\n${rest.join('\n')}`);
  }

  const embed = {
    title: `${event.title} · ${when(event.startsAt, 'D')}`,
    color: event.cancelledAt ? RED : going === 'on' ? GREEN : GOLD,
    description: lines.join('\n'),
    footer: { text: `${EVENT_FOOTER} · event #${event.id}` },
  };
  if (going === 'on' && serverId) {
    embed.fields = [{
      name: 'How to join',
      value: `In WARDOGS: **Community servers → Join by ID** and enter\n\`\`\`${serverId}\`\`\``,
    }];
  }

  // No buttons once it is off: the honest answer is that there is nothing to
  // answer. (An event that is simply over has already dropped off the list.)
  const components = event.cancelledAt ? [] : [new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`event:yes:${event.id}`).setLabel("I'm coming").setEmoji('✅').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`event:maybe:${event.id}`).setLabel('Maybe').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`event:no:${event.id}`).setLabel("Can't make it").setStyle(ButtonStyle.Secondary),
  )];
  return { content: '', embeds: [embed], components, allowedMentions: { parse: [] } };
}

/**
 * Mentions for the people who said they are coming, inside a budget.
 *
 * Clicking "I'm coming" IS asking to be told, so these people are pinged by
 * name. The Match Alerts role alone is not enough: plenty of people will say
 * yes without ever picking that role in #roles, and the button promised them a
 * ping. Discord allows 100 user mentions per message and 2000 characters in
 * it, so the list stops short of both.
 */
export function yesMentions(ids, { budget = 1200 } = {}) {
  const out = [];
  let size = 0;
  for (const id of ids ?? []) {
    const tag = `<@${id}>`;
    if (out.length >= 90 || size + tag.length + 1 > budget) break;
    out.push(tag);
    size += tag.length + 1;
  }
  return { text: out.join(' '), ids: out.map((t) => t.slice(2, -1)) };
}

/**
 * The messages that ping people. Separate from the board, because editing a
 * board notifies nobody, and the whole value of an event is that it reaches
 * people while they still have time to change their evening.
 *
 * Who hears what:
 *   announce, remind  the Match Alerts role: news for people who opted in
 *   go, start         the role AND everyone who said yes, by name
 *   nogo              ONLY the people who said yes. Pinging the whole role to
 *                     say "nothing is happening" is how a role gets muted, but
 *                     the people who planned their evening around it have to
 *                     hear, or they turn up at eight to an empty map — the one
 *                     thing all of this exists to prevent.
 */
export function eventMessage(kind, event, {
  roleId = null, channelId = null, serverId = null, seedChannelId = null,
} = {}) {
  const role = roleId ? `<@&${roleId}> ` : '';
  const here = channelRef(channelId, 'operations');
  const seed = channelRef(seedChannelId, 'start-a-match');
  const target = event.target ?? 45;
  const yes = (event.yes ?? []).length;
  const join = serverId ? `\nJoin by ID: \`${serverId}\`` : '';
  const named = ['go', 'start', 'nogo'].includes(kind) ? yesMentions(event.yes) : { text: '', ids: [] };
  const lines = {
    announce: [
      `${role}**${event.title}** — ${when(event.startsAt)}`,
      `We need ${target} to get a match going. Say whether you're coming in ${here}.`,
    ],
    remind: [
      `${role}**${event.title}** is tomorrow, ${when(event.startsAt, 'R')}.`,
      `${yes} of ${target} so far. If you haven't said either way, do it in ${here}. `
        + 'We decide an hour before whether it runs.',
    ],
    go: [
      `${role}**${event.title} is ON.** ${yes} of us are coming.`,
      `${when(event.startsAt)}. Put it in your evening. You'll get one more ping when it starts.`,
    ],
    nogo: [
      `**${event.title} is off.** Only ${yes} of ${target} said they were coming, and below ${target} `
        + "the match doesn't start, so you'd be walking around an empty map.",
      `Don't go in tonight for this one. The next one goes up soon, and ${seed} still works if enough of you want a game.`,
    ],
    start: [
      `${role}**${event.title} starts now.** ${yes} of us said we'd be here. Get in.${join}`,
    ],
  }[kind] ?? [];

  if (!lines.length) return null;
  if (named.text) lines.push(named.text);
  const roles = roleId && kind !== 'nogo' ? [roleId] : [];
  return {
    content: lines.join('\n'),
    allowedMentions: { parse: [], roles, users: named.ids },
  };
}

/**
 * What to post when an admin calls an event off by hand. Same rule as a no-go:
 * the people who said yes are told by name, nobody else is pinged.
 */
export function cancelMessage(event, { reason = null, seedChannelId = null } = {}) {
  const named = yesMentions(event.yes);
  const lines = [
    `**${event.title} is called off.**${reason ? ` ${reason}` : ''}`,
    `Don't go in for this one. ${channelRef(seedChannelId, 'start-a-match')} still works if enough of you want a game.`,
  ];
  if (named.text) lines.push(named.text);
  return { content: lines.join('\n'), allowedMentions: { parse: [], users: named.ids } };
}

/** Enough of the board to tell whether it needs editing at all. */
const signature = (payload) => JSON.stringify(payload.embeds);

/**
 * The #operations board and the notices, on a beat.
 *
 * NOT called `Events`: discord.js exports its own `Events` (the gateway event
 * names, `Events.ClientReady` and so on) and index.js imports it. Two of them
 * in one file is a SyntaxError that takes the whole bot down at startup, which
 * is exactly what it did.
 */
export class MatchNights {
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
      (c) => c.type === ChannelType.GuildText && c.name === this.config.eventChannel) ?? null;
  }

  pingRole() {
    return this.guild?.roles.cache.find((r) => r.name === this.config.seedPingRoleName) ?? null;
  }

  seedChannelId() {
    return this.guild?.channels.cache.find(
      (c) => c.type === ChannelType.GuildText && c.name === this.config.seedChannel)?.id ?? null;
  }

  nameOf(id) {
    return this.guild?.members.cache.get(id)?.displayName ?? null;
  }

  warn(key, text) {
    if (this.warned === key) return;
    this.warned = key;
    console.warn(`[events] ${text}`);
  }

  /** Found again by its footer, so a restart doesn't post a second one. */
  async findBoard(channel) {
    if (this.message) return this.message;
    const recent = await channel.messages.fetch({ limit: 50 }).catch(() => null);
    this.message = [...(recent?.values() ?? [])]
      .filter((m) => m.author.id === this.guild.client.user.id
        && (m.embeds?.[0]?.footer?.text ?? '').startsWith(EVENT_FOOTER))
      .sort((a, b) => b.createdTimestamp - a.createdTimestamp)[0] ?? null;
    return this.message;
  }

  board(events) {
    const next = events.find((e) => !e.cancelledAt) ?? events[0] ?? null;
    return eventBoard(next, {
      nameOf: (id) => this.nameOf(id),
      upcoming: events,
      serverId: this.serverId,
      seedChannelId: this.seedChannelId(),
    });
  }

  async render(events) {
    const channel = this.channel();
    if (!channel) return this.warn('channel', `no #${this.config.eventChannel} channel yet — run /setup-server`);
    const payload = this.board(events);
    const sig = signature(payload);
    const existing = await this.findBoard(channel);
    if (!existing) {
      this.message = await channel.send(payload);
      this.lastSig = sig;
      console.log(`[events] posted the board in #${channel.name}`);
      return;
    }
    if (sig === this.lastSig) return;
    await existing.edit(payload).catch((err) => {
      this.message = null;
      this.lastSig = null;
      console.warn(`[events] couldn't edit the board: ${err.message}`);
    });
    this.lastSig = sig;
  }

  /**
   * Redraw now rather than at the next beat. Called straight after an admin
   * command, because a board that catches up in a minute makes the admin think
   * the command did not work and run it again.
   */
  async refresh() {
    this.nextCheck = 0;
    await this.core.events().then(({ events }) => this.render(events ?? []))
      .catch((err) => this.warn('core', `couldn't redraw the board: ${err.message}`));
  }

  /** Called from the sync tick. */
  async tick(state) {
    if (this.config.coreDisabled || !this.guild || this.busy) return;
    const now = Date.now();
    if (now < this.nextCheck) return;
    this.nextCheck = now + CHECK_MS;
    this.serverId = this.config.gameServerId || state?.serverId || this.serverId;
    this.busy = true;
    try {
      const { events = [] } = await this.core.events();
      this.warned = null;
      // One notice per tick at most. They are minutes apart in practice, and
      // posting four messages in a row reads as a bot having a fit.
      const due = events.find((e) => e.action);
      if (due) await this.fire(due);
      else await this.render(events);
    } catch (err) {
      this.warn('core', `couldn't read the events: ${err.message}`);
    } finally {
      this.busy = false;
    }
  }

  /**
   * Post a notice. Core decides whether it really happens, so two ticks landing
   * together can't announce the same thing twice.
   */
  async fire(event) {
    const r = await this.core.eventNotice(event.id, event.action);
    if (!r.fired) {
      await this.core.events().then(({ events }) => this.render(events ?? [])).catch(() => {});
      return r;
    }
    const channel = this.channel();
    const payload = eventMessage(event.action, r.event ?? event, {
      roleId: this.pingRole()?.id ?? null,
      channelId: channel?.id ?? null,
      serverId: this.serverId,
      seedChannelId: this.seedChannelId(),
    });
    if (channel && payload) {
      await channel.send(payload)
        .catch((err) => console.warn(`[events] couldn't post the ${event.action}: ${err.message}`));
      // The notice now sits below the board, so put a fresh board under it.
      await this.findBoard(channel).then((m) => m?.delete()).catch(() => {});
      this.message = null;
      this.lastSig = null;
    }
    await this.log(`📅 ${event.title}: ${event.action} (${event.reason}).`);
    await this.core.events().then(({ events }) => this.render(events ?? [])).catch(() => {});
    return r;
  }

  /**
   * An admin called one off. The people who said yes are told by name, because
   * a board they are not looking at will not stop them turning up at eight.
   */
  async announceCancel(event, reason) {
    const channel = this.channel();
    if (!channel) return;
    await channel.send(cancelMessage(event, { reason, seedChannelId: this.seedChannelId() }))
      .catch((err) => console.warn(`[events] couldn't post the cancellation: ${err.message}`));
    await this.findBoard(channel).then((m) => m?.delete()).catch(() => {});
    this.message = null;
    this.lastSig = null;
    await this.refresh();
  }

  /** A board button was pressed. */
  async onButton(i) {
    const [, answer, id] = i.customId.split(':');
    const r = await this.core.eventRsvp(id, i.user.id, answer);
    const { events = [] } = await this.core.events();
    const payload = this.board(events);
    this.message = i.message;
    this.lastSig = signature(payload);
    await i.update(payload);
    const said = {
      yes: `You're down for **${r.event.title}**. You'll be pinged by name when it's confirmed and again when it starts, `
        + "or told if it's called off, so you never turn up to an empty server.",
      maybe: `Noted as a maybe for **${r.event.title}**. Maybes don't count towards the ${r.event.target} we need, so switch to **I'm coming** when you know.`,
      no: `Taken off **${r.event.title}**.`,
    }[answer] ?? 'Noted.';
    await i.followUp({ content: said, flags: 64 }).catch(() => {});
  }
}
