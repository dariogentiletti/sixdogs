// Post-match commander ratings (Discord side).
//
// When a match ends: every commander who led at least RATING_MIN_SERVE_MIN gets
// a rating round (at most RATING_MAX_PER_FACTION per faction, longest first).
// A player may rate a commander only if they were on that faction for at least
// RATING_MIN_PLAY_MIN *while that commander was leading*. Each player gets ONE
// DM per match, with a row of buttons per commander they played under. Votes
// are anonymous and can be changed until the round closes; then each commander
// gets a DM with their totals. Scores (kept by core) feed commander selection.

import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { byKey, factionKeyFor } from './factions.js';

export const VOTES = {
  good: { emoji: '👍', label: 'Good calls', short: 'Good', style: ButtonStyle.Success },
  poor: { emoji: '👎', label: 'Not great', short: 'Poor', style: ButtonStyle.Secondary },
  toxic: { emoji: '🚫', label: 'Toxic', short: 'Toxic', style: ButtonStyle.Danger },
};

const minutes = (sec) => Math.max(1, Math.round(sec / 60));
const signed = (n) => (n > 0 ? `+${n}` : String(n));

/**
 * The ballot: one DM per player per match, one row of buttons per commander
 * they played under. Row = [name + minutes (label)] [👍] [👎] [🚫].
 * entries: [{ roundId, name, minutes }]   chosen: { [roundId]: 'good' | 'poor' | 'toxic' }
 */
export function ballot({ faction, matchId, entries, chosen = {}, voteMinutes }) {
  const f = byKey(faction);
  const many = entries.length > 1;
  const votes = entries.filter((e) => chosen[e.roundId]);
  const embed = {
    title: many ? 'How were your commanders?' : 'How was your commander?',
    color: f?.color,
    description: `Match #${matchId} is over. You played on **${f?.label ?? faction}**`
      + (many ? `, which had ${entries.length} commanders. You can rate each one you played under.` : '.')
      + '\n\nVotes are anonymous. Commanders only ever see the totals.',
    footer: { text: `Voting closes ${voteMinutes} minutes after the match. You can change your votes until then.` },
  };
  if (votes.length) {
    embed.fields = [{
      name: many ? 'Your votes' : 'Your vote',
      value: votes.map((e) => `${VOTES[chosen[e.roundId]].emoji} ${many ? `**${e.name}**: ` : ''}${VOTES[chosen[e.roundId]].label}`).join('\n'),
    }];
  }
  const components = entries.map((e) => new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`rlabel:${e.roundId}:${e.minutes}`).setLabel(`${e.name.slice(0, 60)} · ${e.minutes} min`)
      .setStyle(ButtonStyle.Secondary).setDisabled(true),
    ...Object.entries(VOTES).map(([value, v]) => new ButtonBuilder()
      .setCustomId(`rate:${e.roundId}:${value}`)
      .setLabel(many ? v.short : v.label)
      .setEmoji(v.emoji)
      .setStyle(chosen[e.roundId] === value ? ButtonStyle.Primary : v.style)),
  ));
  return { embeds: [embed], components, allowedMentions: { parse: [] } };
}

/** Rebuild the ballot's state from the message itself (so it survives bot restarts). */
export function readBallot(message) {
  const entries = [];
  const chosen = {};
  for (const row of message.components ?? []) {
    const parts = (row.components ?? []).map((c) => (typeof c.toJSON === 'function' ? c.toJSON() : c));
    const label = parts.find((c) => (c.custom_id ?? c.customId ?? '').startsWith('rlabel:'));
    if (!label) continue;
    const [, roundId, minutes] = (label.custom_id ?? label.customId).split(':');
    const name = String(label.label).replace(/ · \d+ min$/, '');
    entries.push({ roundId: Number(roundId), name, minutes: Number(minutes) });
    for (const c of parts) {
      const id = c.custom_id ?? c.customId ?? '';
      if (id.startsWith('rate:') && c.style === ButtonStyle.Primary) chosen[Number(roundId)] = id.split(':')[2];
    }
  }
  const matchId = Number(/Match #(\d+)/.exec(message.embeds?.[0]?.description ?? '')?.[1]);
  return { entries, chosen, matchId };
}

export function summaryEmbed({ faction, matchId, tallies, total, windowDays }) {
  const f = byKey(faction);
  const t = tallies;
  const votes = t.good + t.poor + t.toxic;
  const pts = Math.max(-3, Math.min(3, t.good - t.poor - 3 * t.toxic));
  return {
    title: `Your ratings: ${f?.label ?? faction}, match #${matchId}`,
    color: f?.color,
    description: votes
      ? `👍 **${t.good}**   👎 **${t.poor}**   🚫 **${t.toxic}**\n\n`
        + `That match counts **${signed(pts)}** toward your commander score. `
        + `Your score is now **${signed(total ?? pts)}** (last ${windowDays} days).`
      : 'Nobody rated this one, so it doesn\'t change your score.',
    footer: { text: 'Higher scores get asked to command first. Thanks for taking the call.' },
  };
}

export class Ratings {
  constructor({ core, config, log }) {
    this.core = core;
    this.config = config;
    this.log = log;
    this.guild = null;
    this.cache = { at: 0, scores: {} };
  }

  attach(guild) { this.guild = guild; }

  /** Scores by Discord id, cached for a minute. */
  async scores() {
    if (Date.now() - this.cache.at > 60_000) {
      try {
        const r = await this.core.ratingScores();
        this.cache = { at: Date.now(), scores: r.scores ?? {} };
      } catch { /* keep the old cache */ }
    }
    return this.cache.scores;
  }

  /** Called when the bot sees a match end. */
  async openForMatch(matchId, factionScores) {
    // Map the in-game faction names seen in this match to blue/red/green.
    const { participants } = await this.core.matchParticipants(matchId);
    const factionMap = {};
    for (const p of participants) {
      const key = factionKeyFor(p.faction, this.config.factionAliases, factionScores);
      if (key) factionMap[p.faction] = key;
    }
    const { factions } = await this.core.ratingPlan(matchId, {
      factionMap,
      minServeSec: this.config.ratingMinServeMin * 60,
      minPlaySec: this.config.ratingMinPlayMin * 60,
      maxPerFaction: this.config.ratingMaxPerFaction,
    });

    for (const { faction, commanders } of factions) {
      const perVoter = new Map(); // voterId -> ballot entries
      const opened = [];
      for (const c of commanders) {
        const round = await this.core.openRatingRound({
          matchId, faction, commanderId: c.discordId, servedSec: c.servedSec, voterIds: c.voterIds,
        });
        if (!round.created) continue; // already opened (bot restarted mid-way)
        const member = await this.guild.members.fetch(c.discordId).catch(() => null);
        const entry = { roundId: round.roundId, name: member?.displayName ?? 'Commander', minutes: minutes(c.servedSec) };
        opened.push(`<@${c.discordId}> (${entry.minutes} min, ${round.voters.length} voters)`);
        for (const v of round.voters) (perVoter.get(v) ?? perVoter.set(v, []).get(v)).push(entry);
      }
      if (!opened.length) continue;
      let sent = 0;
      for (const [voterId, entries] of perVoter) {
        const member = await this.guild.members.fetch(voterId).catch(() => null);
        const ok = await member?.send(ballot({ faction, matchId, entries, voteMinutes: this.config.ratingVoteMinutes }))
          .then(() => true, () => false);
        if (ok) sent++;
      }
      await this.log(`🗳️ ${byKey(faction)?.label} match #${matchId}: rating ${opened.join(', ')}. `
        + `Sent ${sent} of ${perVoter.size} ballots${sent < perVoter.size ? ' (the rest have DMs closed)' : ''}.`);
    }
  }

  /** A vote button was pressed. */
  async onButton(i) {
    const [, roundId, value] = i.customId.split(':');
    try {
      const r = await this.core.rateVote(Number(roundId), i.user.id, value);
      const state = readBallot(i.message);
      state.chosen[Number(roundId)] = value;
      await i.update(ballot({
        faction: r.faction, matchId: state.matchId || r.matchId, entries: state.entries,
        chosen: state.chosen, voteMinutes: this.config.ratingVoteMinutes,
      }));
      if (r.toxicAlert) {
        await this.log(`⚠️ <@${r.commanderId}> got ${r.tallies.toxic} 🚫 toxic votes commanding ${byKey(r.faction)?.label} in match #${r.matchId}. Worth a listen.`);
      }
      this.cache.at = 0;
    } catch (err) {
      await i.reply({ content: err.message }).catch(() => {});
    }
  }

  /** Every minute: tell commanders how their closed rounds went. */
  async notifyDue() {
    let due;
    try { due = (await this.core.ratingsDue()).rounds; } catch { return; }
    if (!due.length) return;
    this.cache.at = 0;
    const scores = await this.scores();
    for (const r of due) {
      const member = await this.guild.members.fetch(r.commanderId).catch(() => null);
      await member?.send({ embeds: [summaryEmbed({
        faction: r.faction, matchId: r.matchId, tallies: r.tallies,
        total: scores[r.commanderId]?.score, windowDays: this.config.ratingWindowDays,
      })] }).catch(() => {});
      await this.core.ratingNotified(r.roundId).catch(() => {});
    }
  }

  async describe(discordId) {
    this.cache.at = 0;
    const s = (await this.scores())[discordId];
    if (!s) return `No ratings yet. Command a match for ${this.config.ratingMinServeMin}+ minutes and your faction gets to vote.`;
    return `Commander score **${signed(s.score)}** over ${s.matches} rated match${s.matches === 1 ? '' : 'es'} (last ${this.config.ratingWindowDays} days).\n`
      + `👍 ${s.good}   👎 ${s.poor}   🚫 ${s.toxic}`;
  }
}
