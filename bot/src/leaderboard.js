// The leaderboard: one bot message in #leaderboard, edited in place, and the
// same boards on the website.
//
// Seven boards, not one blended "SIXDOGS score". A single weighted number is
// impossible to argue with and impossible to chase: nobody can work out what to
// do differently. Separate lists each say "do this and you climb".
//
// The numbers and what they mean are in core/src/leaderboard.js. The short
// version: the game gives us kills, deaths, cash and which side you are on, and
// nothing else. No supply deliveries, no captures, no revives. So the strategic
// boards are derived from how the objective score moves while somebody is on
// the field, and each one says on the board itself what it measures. A number
// nobody understands does not motivate anyone.
//
// BOARDS below is the ONE definition of the titles, the explanations and the
// number format. Discord and sixdogs.gg both render from it, so the two cannot
// drift into describing the same number two different ways.

const GOLD = 0xc9a227;
/** How the board message is found again after a restart. */
export const BOARD_FOOTER = 'Leaderboard';
/** Discord's own limits. Blowing either one throws on send, not on render. */
const FIELD_MAX = 1024;
const EMBED_MAX = 6000;

const medal = (n) => ['🥇', '🥈', '🥉'][n] ?? `${n + 1}.`;
const hours = (min) => (min >= 60 ? `${Math.round(min / 60)}h` : `${Math.round(min)}m`);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 'es'}`;
const signed = (n) => `${n > 0 ? '+' : ''}${n}`;

/**
 * The boards, in the order they are shown.
 *
 *   key    which list on the core response it reads
 *   note   what the number means, on the board itself
 *   empty  what to say when there is nothing to show yet, which for the derived
 *          boards has to explain that it is not broken
 *   value  the headline number for one row
 *   sub    the smaller number beside it, if any
 *   people true for the one board keyed on Discord rather than on the game
 */
export const BOARDS = [
  {
    key: 'kills',
    icon: '⚔️',
    title: 'Kills',
    note: 'Most kills. Turning up counts.',
    value: (r) => `${r.kills}`,
    sub: (r) => `${r.kd} K:D`,
  },
  {
    key: 'kd',
    icon: '🎯',
    title: 'Kill / death',
    note: (lb) => `Best ratio, ${lb.minMinutes ?? 20}+ minutes played.`,
    value: (r) => `${r.kd}`,
    sub: (r) => `${r.kills}/${r.deaths}`,
  },
  {
    key: 'discipline',
    icon: '🛡️',
    title: 'Stayed alive',
    // The unit belongs in the explanation, not repeated under every row.
    note: 'Deaths per 10 minutes, fewest first. Holding a position, not pushing alone.',
    value: (r) => `${r.deathsPer10}`,
  },
  {
    // The first one that isn't about fragging.
    key: 'ground',
    icon: '🚩',
    title: 'Ground held',
    note: 'How fast your side\'s objective score climbed while you were on the field. '
      + 'A team number: everyone out there shares it.',
    value: (r) => `${r.ground}/min`,
  },
  {
    key: 'swing',
    icon: '📈',
    title: 'Swing',
    note: 'How much faster your side scored with you on than without you. '
      + 'This one is yours alone.',
    empty: 'Needs matches where people come and go, so there is something to compare against. '
      + 'Fills in on its own.',
    value: (r) => `${signed(r.swing)}/min`,
  },
  {
    key: 'commanders',
    icon: '🎖️',
    title: 'Commanders',
    note: 'Rated by their own side after each match, not by us.',
    empty: 'Nobody has commanded and been rated yet.',
    people: true,
    anon: 'A commander',
    value: (c) => signed(c.score),
    sub: (c) => `${plural(c.rounds, 'match')}, ${hours(c.minutes)}`,
  },
  {
    key: 'hours',
    icon: '⏱️',
    title: 'Time on the server',
    note: 'The people who actually keep it alive.',
    value: (r) => hours(r.minutes),
    sub: (r) => plural(r.matches, 'match'),
  },
  {
    // The only board the game cannot see, and the one that matters most to a
    // server this size: a quiet server stays quiet unless somebody says they
    // want a game.
    key: 'starters',
    icon: '🔔',
    title: 'Got matches going',
    note: 'Matches that started because these people put their names down in '
      + '#start-a-match while the server was quiet.',
    empty: 'Nobody has got a match going yet. Put your name down in #start-a-match.',
    people: true,
    anon: 'Someone in our Discord',
    value: (s) => plural(s.calls, 'match'),
  },
];

const noteOf = (board, lb) => (typeof board.note === 'function' ? board.note(lb) : board.note);
const emptyOf = (board) => board.empty ?? 'Nobody yet.';

/**
 * One board's rows, already named and formatted. Shared by both renderers so
 * Discord and the website can't disagree about a number.
 *
 * `nameOf` is given the whole row: the commander board carries a Discord id
 * where the others carry an in-game name.
 */
export function boardRows(board, lb, nameOf, { top = 10 } = {}) {
  return (lb[board.key] ?? []).slice(0, top).map((r) => ({
    name: String(nameOf(r) ?? '—'),
    value: board.value(r),
    sub: board.sub ? board.sub(r) : null,
  }));
}

/**
 * The board message. Pure, so the wording and ordering are testable.
 *
 * `nameOf` turns a Discord id into something readable for the commander board,
 * which is the one board keyed on Discord rather than on the game.
 */
export function leaderboardPost(lb, { nameOf = (id) => `<@${id}>`, days = 30 } = {}) {
  const who = (board) => (r) => (board.people ? nameOf(r.discordId) : r.name);
  const fields = BOARDS.map((board) => {
    const rows = boardRows(board, lb, who(board));
    const body = rows.length
      ? rows.map((r, n) => `${medal(n)} **${r.name}** ${r.value}${r.sub ? ` · ${r.sub}` : ''}`).join('\n')
      : `_${emptyOf(board)}_`;
    return {
      name: `${board.icon} ${board.title}`,
      value: `${noteOf(board, lb)}\n${body}`.slice(0, FIELD_MAX),
      inline: false,
    };
  });

  const embed = {
    title: `Leaderboard · last ${days} days`,
    color: GOLD,
    description: lb.players
      ? `${lb.players} player${lb.players === 1 ? '' : 's'} seen, ${lb.counted} with enough time played to rank on the rate boards.`
      : 'Nobody has played yet. Get a match going and this fills in.',
    fields,
    footer: { text: `${BOARD_FOOTER} · updated every ${lb.updateMinutes ?? 15} minutes` },
  };
  // An embed over 6000 characters in total is refused by Discord even when
  // every field is legal on its own, so trim the longest fields until it fits.
  const size = () => JSON.stringify(embed).length;
  while (size() > EMBED_MAX) {
    const worst = fields.reduce((a, b) => (b.value.length > a.value.length ? b : a));
    if (worst.value.length < 80) break;
    worst.value = `${worst.value.slice(0, Math.floor(worst.value.length * 0.7)).trimEnd()}\n…`;
  }

  return { content: '', embeds: [embed], allowedMentions: { parse: [] } };
}

/**
 * The same boards for sixdogs.gg, rendered to text here rather than in the
 * page's script: the explanations are written once, above, and the website
 * cannot describe a number differently from Discord.
 *
 * NOTHING private goes out. The commander board is keyed on Discord ids, so
 * they are resolved to display names here and the ids are dropped — the same
 * rule the rest of publicStatus follows.
 */
export function publicLeaderboard(lb, { nameOf = () => null, top = 5 } = {}) {
  if (!lb) return null;
  // Somebody who has left the Discord server has no display name left to look
  // up, and their id is never a substitute for one out here. Each board says
  // what to call them instead, because "A commander" on the seeding board would
  // be plain wrong.
  const who = (board) => (r) => (board.people
    ? (nameOf(r.discordId) || board.anon || 'Someone in our Discord')
    : r.name);
  return {
    days: lb.days ?? 30,
    minMinutes: lb.minMinutes ?? 20,
    players: lb.players ?? 0,
    counted: lb.counted ?? 0,
    boards: BOARDS.map((board) => ({
      key: board.key,
      title: board.title,
      note: noteOf(board, lb),
      empty: emptyOf(board),
      rows: boardRows(board, lb, who(board), { top }),
    })),
  };
}

/** Enough of the board to tell whether it needs editing at all. */
const signature = (payload) => JSON.stringify(payload.embeds);

export class Leaderboard {
  // No admin-log here, unlike the role failures: a board that couldn't be drawn
  // this quarter hour is not something to ping admins about, and it retries in
  // fifteen minutes anyway. The warnings are latched so a long outage is one
  // line rather than one every tick.
  constructor({ core, config }) {
    this.core = core;
    this.config = config;
    this.guild = null;
    this.message = null;
    this.lastSig = null;
    this.warned = null;
  }

  attach(guild) { this.guild = guild; }

  channel() {
    return this.guild?.channels.cache.find(
      (c) => c.isTextBased?.() && c.name === this.config.leaderboardChannel) ?? null;
  }

  warn(key, text) {
    if (this.warned === key) return;
    this.warned = key;
    console.warn(`[leaderboard] ${text}`);
  }

  /** Found again by its footer, so a restart doesn't post a second one. */
  async findBoard(channel) {
    if (this.message) return this.message;
    const recent = await channel.messages.fetch({ limit: 50 }).catch(() => null);
    this.message = [...(recent?.values() ?? [])]
      .filter((m) => m.author.id === this.guild.client.user.id
        && (m.embeds?.[0]?.footer?.text ?? '').startsWith(BOARD_FOOTER))
      .sort((a, b) => b.createdTimestamp - a.createdTimestamp)[0] ?? null;
    return this.message;
  }

  async update() {
    if (this.config.coreDisabled || !this.guild) return;
    const channel = this.channel();
    if (!channel) return this.warn('channel', `no #${this.config.leaderboardChannel} channel yet — run /setup-server`);
    let lb;
    try {
      lb = await this.core.leaderboard({ days: this.config.leaderboardDays });
    } catch (err) {
      return this.warn('core', `couldn't read the leaderboard: ${err.message}`);
    }
    this.warned = null;
    const payload = leaderboardPost(
      { ...lb, updateMinutes: this.config.leaderboardMinutes },
      {
        days: lb.days,
        nameOf: (id) => this.guild.members.cache.get(id)?.displayName ?? `<@${id}>`,
      },
    );
    const sig = signature(payload);
    const existing = await this.findBoard(channel);
    if (!existing) {
      this.message = await channel.send(payload);
      this.lastSig = sig;
      console.log(`[leaderboard] posted the board in #${channel.name}`);
      return;
    }
    if (sig === this.lastSig) return;
    await existing.edit(payload).catch((err) => {
      this.message = null;
      this.lastSig = null;
      console.warn(`[leaderboard] couldn't edit the board: ${err.message}`);
    });
    this.lastSig = sig;
  }
}
