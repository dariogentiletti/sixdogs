// The live board in #server-info: one bot message, edited in place every few
// minutes (and right away when a match ends), showing what's happening on the
// game server right now. Relative times use Discord timestamps (<t:...:R>), so
// "ends in 12 minutes" keeps counting down between edits on everyone's screen.

import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType } from 'discord.js';
import { FACTIONS, colorKeyFromHex, factionKeyFor } from './factions.js';

export const BOARD_FOOTER = 'Live board';
export const STEAM_STORE_URL = 'https://store.steampowered.com/app/1867240/WARDOGS/';
const DOT = { blue: '🔵', red: '🔴', green: '🟢' };
const GOLD = 0xc9a227, GREY = 0x4f545c, RED = 0xa3261f;

const unix = (ms) => Math.floor(ms / 1000);
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The first number-looking score field on a factionScores row (the schema doesn't name it). */
export function pickScore(row) {
  for (const k of ['score', 'points', 'tickets', 'value', 'current']) {
    const v = row?.[k];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
  }
  return null;
}

/** Everything the board shows, worked out from core's /internal/state. Pure. */
export function summarize(state, { now = Date.now(), commanderOf = () => null, aliases = {} } = {}) {
  const status = state?.status ?? {};
  const scores = Array.isArray(status.factionScores) ? status.factionScores : [];
  const teams = FACTIONS.map((f) => ({ key: f.key, label: f.label, players: 0, linked: 0, score: null, commanderId: commanderOf(f.key) }));
  const byKey = new Map(teams.map((t) => [t.key, t]));

  for (const row of scores) {
    const key = colorKeyFromHex(row?.colorHex) ?? factionKeyFor(row?.name, aliases);
    if (key && byKey.has(key)) byKey.get(key).score = pickScore(row);
  }
  const players = Array.isArray(state?.players) ? state.players : [];
  for (const p of players) {
    const key = factionKeyFor(p.faction, aliases, scores);
    if (!key) continue;
    byKey.get(key).players++;
    if (p.discordId) byKey.get(key).linked++;
  }

  const secs = typeof status.matchSeconds === 'number' ? status.matchSeconds : null;
  let endsAt = null, startedAt = null;
  if (secs !== null && state?.clockDirection === 'down') endsAt = now + secs * 1000;
  else if (secs !== null && state?.clockDirection === 'up') startedAt = now - secs * 1000;
  if (!startedAt && state?.matchStartedAt) startedAt = new Date(state.matchStartedAt).getTime();

  const top = players
    .filter((p) => typeof p.kills === 'number' && p.kills > 0)
    .sort((a, b) => b.kills - a.kills)
    .slice(0, 5);

  const scored = teams.filter((t) => t.score !== null).sort((a, b) => b.score - a.score);
  const lead = scored.length >= 2 && scored[0].score > scored[1].score
    ? { team: scored[0], by: scored[0].score - scored[1].score } : null;

  return {
    online: !!state?.ok,
    serverName: status.serverName ?? null,
    map: status.map ?? null,
    matchId: state?.matchId ?? null,
    endsAt, startedAt,
    scoreCap: typeof status.scoreCap === 'number' ? status.scoreCap : null,
    current: status.players?.current ?? players.length,
    max: status.players?.max ?? null,
    serverId: state?.serverId ?? null,
    lastSeenAt: state?.lastSuccessAt ? new Date(state.lastSuccessAt).getTime() : null,
    teams, top, lead,
  };
}

function teamField(t, cap) {
  const lines = [];
  if (t.score !== null) lines.push(`**${t.score}**${cap ? ` / ${cap}` : ''} points`);
  lines.push(plural(t.players, 'player'));
  lines.push(t.commanderId ? `🎖️ <@${t.commanderId}>` : '🎖️ *No commander*');
  return { name: `${DOT[t.key]} ${t.label}`, value: lines.join('\n'), inline: true };
}

/** The message payload. `links` holds URLs for the buttons; `serverIdOverride` wins over core's. */
export function buildBoard(s, { now = Date.now(), links = {}, serverIdOverride = null, updateMinutes = 5, notConnected = false } = {}) {
  const buttons = [];
  if (links.play) buttons.push(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Open WARDOGS on Steam').setURL(links.play));
  if (links.howToPlay) buttons.push(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('How we play').setURL(links.howToPlay));
  if (links.getVerified) buttons.push(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Get verified').setURL(links.getVerified));
  const components = buttons.length ? [new ActionRowBuilder().addComponents(buttons)] : [];
  const footer = { text: `${BOARD_FOOTER} · updates every ${plural(updateMinutes, 'minute')}` };
  const serverId = serverIdOverride || s?.serverId;
  const joinField = {
    name: 'How to join',
    value: serverId
      ? `In WARDOGS: **Community servers → Join by ID** and enter\n\`\`\`${serverId}\`\`\``
      : `In WARDOGS: **Community servers**, search for **${s?.serverName ?? 'SIXDOGS'}**.`,
  };

  if (notConnected) {
    return {
      content: '', components, allowedMentions: { parse: [] },
      embeds: [{
        color: GREY, title: 'SIXDOGS game server',
        description: "The server isn't connected to the bot yet. Live match info shows up here once it is.",
        footer, timestamp: new Date(now).toISOString(),
      }],
    };
  }

  if (!s.online) {
    return {
      content: '', components, allowedMentions: { parse: [] },
      embeds: [{
        color: RED, title: `🔴 Offline${s.serverName ? ` · ${s.serverName}` : ''}`,
        description: s.lastSeenAt
          ? `The bot can't reach the game server right now. Last seen <t:${unix(s.lastSeenAt)}:R>.`
          : "The bot can't reach the game server right now.",
        footer, timestamp: new Date(now).toISOString(),
      }],
    };
  }

  const head = [];
  const where = [s.map && `**${s.map}**`, s.matchId && `Match #${s.matchId}`].filter(Boolean).join(' · ');
  if (where) head.push(where);
  if (s.endsAt) head.push(`⏱️ Ends <t:${unix(s.endsAt)}:R>`);
  else if (s.startedAt) head.push(`⏱️ Started <t:${unix(s.startedAt)}:R>`);
  if (s.scoreCap) head.push(`🏁 First to **${s.scoreCap}** points wins`);
  if (s.lead) head.push(`📈 ${DOT[s.lead.team.key]} **${s.lead.team.label}** leads by ${s.lead.by}`);

  const full = s.max !== null && s.current >= s.max;
  const slots = s.max !== null
    ? `**${s.current} / ${s.max}** players · ${full ? '**Server full**' : `${plural(s.max - s.current, 'slot')} open`}`
    : `**${s.current}** players on`;
  head.push(`👥 ${slots}`);

  const fields = s.teams.map((t) => teamField(t, s.scoreCap));
  if (s.top.length) {
    fields.push({ name: 'Top this match', value: s.top.map((p, i) => `${i + 1}. ${p.name} · ${plural(p.kills, 'kill')}`).join('\n'), inline: false });
  }
  fields.push(joinField);

  return {
    content: '', components, allowedMentions: { parse: [] },
    embeds: [{
      color: GOLD,
      title: `🟢 Live${s.serverName ? ` · ${s.serverName}` : ''}`,
      description: head.join('\n'),
      fields, footer, timestamp: new Date(now).toISOString(),
    }],
  };
}

export const isBoardMessage = (m, botId) =>
  m.author?.id === botId && (m.embeds?.[0]?.footer?.text ?? '').startsWith(BOARD_FOOTER);

export class LiveBoard {
  constructor({ core, commanders, config }) {
    this.core = core;
    this.commanders = commanders;
    this.config = config;
    this.guild = null;
    this.message = null;
    this.busy = false;
    this.lastError = null;
  }

  attach(guild) { this.guild = guild; }

  channel() {
    return this.guild?.channels.cache.find((c) => c.type === ChannelType.GuildText && c.name === this.config.liveBoardChannel) ?? null;
  }

  channelUrl(name) {
    const ch = this.guild?.channels.cache.find((c) => c.type === ChannelType.GuildText && c.name === name);
    return ch ? `https://discord.com/channels/${this.guild.id}/${ch.id}` : null;
  }

  /** Find our board message; the first time, clear out older bot posts in the channel (the old static cards). */
  async findOrClean(channel) {
    if (this.message && !this.message.deleted) return this.message;
    const botId = this.guild.client.user.id;
    const recent = await channel.messages.fetch({ limit: 50 }).catch(() => null);
    const mine = [...(recent?.values() ?? [])].filter((m) => m.author.id === botId);
    const board = mine.find((m) => isBoardMessage(m, botId)) ?? null;
    for (const m of mine) {
      if (m !== board) await m.delete().catch(() => {});
    }
    this.message = board;
    return board;
  }

  async update() {
    if (this.busy || !this.guild) return;
    this.busy = true;
    try {
      const channel = this.channel();
      if (!channel) return;
      const links = {
        play: this.config.joinUrl || STEAM_STORE_URL,
        howToPlay: this.channelUrl('how-to-play'),
        getVerified: this.channelUrl('get-verified'),
      };
      const opts = { links, serverIdOverride: this.config.gameServerId, updateMinutes: this.config.liveBoardMinutes };
      let payload;
      if (this.config.coreDisabled) {
        payload = buildBoard(null, { ...opts, notConnected: true });
      } else {
        let state;
        try { state = await this.core.state(); } catch { state = { ok: false }; }
        const s = summarize(state, {
          commanderOf: (key) => this.commanders.state?.[key]?.commanderId ?? null,
          aliases: this.config.factionAliases,
        });
        payload = buildBoard(s, opts);
      }
      const existing = await this.findOrClean(channel);
      this.message = existing ? await existing.edit(payload) : await channel.send(payload);
      this.lastError = null;
    } catch (err) {
      if (this.lastError !== err.message) console.warn(`[board] couldn't update #${this.config.liveBoardChannel}: ${err.message}`);
      this.lastError = err.message;
      this.message = null;
    } finally {
      this.busy = false;
    }
  }
}
