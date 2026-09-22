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
/**
 * The heading, which doubles as how the board is found again after a restart.
 * A Components V2 message has no embed and so no footer to hide a marker in,
 * so the title itself is the marker and has to stay stable.
 */
export const TITLE = 'SIXDOGS Leaderboard';
/** Kept for the old embed board, which is deleted on sight. @deprecated */
export const BOARD_FOOTER = 'Leaderboard';

// Components V2. Raw JSON rather than discord.js builders, so the whole message
// stays a plain object a test can read.
const CONTAINER = 17;
const TEXT_DISPLAY = 10;
const SEPARATOR = 14;
const ACTION_ROW = 1;
const BUTTON = 2;
const LINK = 5;
/** MessageFlags.IsComponentsV2. With it set, content and embeds are refused. */
const COMPONENTS_V2 = 1 << 15;
/** Across every text component in one message. Discord refuses, not truncates. */
const TEXT_MAX = 4000;

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
 *   short  the same number for Discord's fixed-width column, where "5 matches"
 *          does not fit and the heading already says what is being counted
 *   sub    the smaller number beside it, if any
 *   mag    a non-negative size for the bar, on the boards where bigger is
 *          plainly better and the scale starts at zero. No mag, no bar.
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
    mag: (r) => r.kills,
  },
  {
    key: 'kd',
    icon: '🎯',
    title: 'Kill / death',
    note: (lb) => `Best ratio, ${lb.minMinutes ?? 20}+ minutes played.`,
    value: (r) => `${r.kd}`,
    sub: (r) => `${r.kills}/${r.deaths}`,
    mag: (r) => r.kd,
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
    short: (r) => `${r.ground}`,
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
    short: (r) => signed(r.swing),
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
    mag: (r) => r.minutes,
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
    short: (s) => `${s.calls}`,
    mag: (s) => s.calls,
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
    short: (board.short ?? board.value)(r),
    sub: board.sub ? board.sub(r) : null,
  }));
}

// --- drawing a scoreboard in a Discord message -----------------------------
//
// An embed with a list of names in it looks like every other post the bot
// makes, which is exactly what the owner said about the first version. A
// leaderboard has to read as a SCOREBOARD at a glance, and in Discord there are
// only three ways to get one:
//
//   1. A rendered picture. Best looking by a mile, and not available: the bot
//      runs on Railway with no browser and no font stack, and a leaderboard
//      redrawn every 15 minutes cannot be a picture committed to the repo the
//      way the guide panels are. Adding a native rasteriser to a service the
//      owner cannot debug is how you end up with blank boxes and no idea why.
//   2. An `ansi` code block, which Discord colours. Rejected: colour renders on
//      desktop and web only, and depending on the phone's app version mobile
//      shows either no colour or the raw escape codes scattered through the
//      text. Half this community reads Discord on a phone.
//   3. A PLAIN code block, which is monospace absolutely everywhere, plus the
//      Components V2 layout around it. That is what this does.
//
// Monospace is the whole trick. Fixed-width columns and a bar drawn out of
// block characters turn a list into a chart, and it cannot fail to render.
const BAR_FULL = '█';
const BAR_EMPTY = '·';
// Columns, measured against a mock of Discord's own dark theme rather than
// guessed. A code block does not wrap, it scrolls sideways, and on a narrow
// phone there is only room for about 25 characters. So two things:
//
//   - the widths are as tight as the numbers allow, and
//   - the BAR goes last, after the value. Something has to be the column that
//     scrolls off the edge of a small phone, and it must never be the number.
//     The bar is the decoration; the score is the point.
const NAME_W = 12;
const BAR_W = 7;
const VALUE_W = 6;

/**
 * In-game names are whatever somebody typed into Steam. Anything wider or
 * narrower than one cell breaks every row under it, so the scoreboard keeps
 * plain single-width characters and drops the rest. Better a name missing an
 * emoji than a table that has come apart.
 */
export function monoName(name, width = NAME_W) {
  const flat = [...String(name ?? '')]
    .filter((c) => c >= ' ' && c.codePointAt(0) < 0x2000)
    .join('')
    .trim() || '?';
  return flat.length > width ? `${flat.slice(0, width - 1)}…` : flat.padEnd(width);
}

/** `████····` sized against the best row. Blank when this board has no bar. */
function bar(mag, best) {
  if (mag === null || !Number.isFinite(mag) || best <= 0) return ' '.repeat(BAR_W);
  const n = Math.max(1, Math.round((Math.max(0, mag) / best) * BAR_W));
  return BAR_FULL.repeat(Math.min(BAR_W, n)).padEnd(BAR_W, BAR_EMPTY);
}

/**
 * One board as a monospace block. `rows` are already named and formatted.
 *
 * Bars are only drawn where bigger is plainly better and the scale starts at
 * zero. On "fewest deaths", on swing and on the commander score the longest bar
 * would belong to the wrong person or to a negative number, so those boards
 * show the number alone rather than inventing a scale to draw.
 */
export function chart(rows, { withBar = false } = {}) {
  if (!rows.length) return null;
  const best = withBar ? Math.max(...rows.map((r) => r.mag ?? 0)) : 0;
  // The bar columns are held open even on a board that has no bar, so every
  // block in the message is the same width and the numbers line up in one
  // column all the way down. Eight boards of different widths read as eight
  // separate things; one column reads as one scoreboard.
  const rank = String(rows.length).length;
  const lines = rows.map((r, n) => {
    const left = `${String(n + 1).padStart(rank)}  ${monoName(r.name)}`;
    const value = String(r.short ?? r.value).padStart(VALUE_W);
    return withBar ? `${left} ${value}  ${bar(r.mag, best)}` : `${left} ${value}`;
  });
  return ['```', ...lines, '```'].join('\n');
}

/**
 * The board message, as Components V2 (a container with its own accent stripe,
 * headings and dividers) rather than an embed. Pure, so the layout and the
 * wording are testable.
 *
 * `nameOf` turns a Discord id into something readable for the two boards keyed
 * on Discord rather than on the game.
 */
export function leaderboardPost(lb, { nameOf = (id) => `<@${id}>`, days = 30, siteUrl = null } = {}) {
  const who = (board) => (r) => (board.people ? nameOf(r.discordId) : r.name);
  const text = (content) => ({ type: TEXT_DISPLAY, content });
  const divider = () => ({ type: SEPARATOR, divider: true, spacing: 1 });

  const parts = [text(
    `## ${TITLE}\n`
    + (lb.players
      ? `Last ${days} days · ${lb.players} player${lb.players === 1 ? '' : 's'} seen`
        + ` · ${lb.counted} with the ${lb.minMinutes ?? 20}+ minutes needed to rank on a per-minute board`
      : 'Nobody has played yet. Get a match going and this fills in.'),
  )];

  for (const board of BOARDS) {
    const rows = boardRows(board, lb, who(board), { top: 5 }).map((r, i) => ({
      ...r, mag: board.mag ? board.mag((lb[board.key] ?? [])[i]) : null,
    }));
    const body = chart(rows, { withBar: !!board.mag }) ?? `_${emptyOf(board)}_`;
    parts.push(divider());
    // Heading and explanation in Discord's own type; only the numbers go in the
    // monospace block, where the alignment is doing the work.
    parts.push(text(`**${board.icon}  ${board.title.toUpperCase()}**\n-# ${noteOf(board, lb)}\n${body}`));
  }

  const container = { type: CONTAINER, accent_color: GOLD, components: parts };
  // 4000 characters across every text component in the message, and Discord
  // refuses the whole thing rather than trimming it. Drop explanations first:
  // the numbers are the point, and the website carries the full version.
  const size = () => parts.reduce((n, p) => n + (p.content?.length ?? 0), 0);
  for (let i = parts.length - 1; i > 0 && size() > TEXT_MAX; i--) {
    if (parts[i].content) parts[i].content = parts[i].content.replace(/\n-# [^\n]*/, '');
  }

  const payload = {
    flags: COMPONENTS_V2,
    components: [container],
    allowedMentions: { parse: [] },
  };
  if (siteUrl) {
    payload.components.push({
      type: ACTION_ROW,
      components: [{ type: BUTTON, style: LINK, label: 'See it on the website', url: siteUrl }],
    });
  }
  return payload;
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
      // `short` is Discord's fixed-width column and has no business out here:
      // the website has room for "5 matches" and every byte counts against the
      // size the Worker will accept.
      rows: boardRows(board, lb, who(board), { top }).map(({ name, value, sub }) => ({ name, value, sub })),
    })),
  };
}

/** Enough of the board to tell whether it needs editing at all. */
const signature = (payload) => JSON.stringify(payload.components);

/** Every bit of text in a Components V2 message, however deeply nested. */
export function componentText(components) {
  const out = [];
  const walk = (list) => {
    for (const c of list ?? []) {
      if (typeof c?.content === 'string') out.push(c.content);
      if (Array.isArray(c?.components)) walk(c.components);
    }
  };
  walk(components);
  return out.join('\n');
}

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

  /**
   * Found again by its title, so a restart doesn't post a second one. A
   * Components V2 message has no embed, so there is no footer to hide a marker
   * in and the heading is the marker.
   *
   * The old embed board is a different message shape that cannot be edited into
   * this one, so any of those still lying about are deleted rather than left as
   * a second, frozen leaderboard.
   */
  async findBoard(channel) {
    if (this.message) return this.message;
    const recent = await channel.messages.fetch({ limit: 50 }).catch(() => null);
    const mine = [...(recent?.values() ?? [])]
      .filter((m) => m.author.id === this.guild.client.user.id)
      .sort((a, b) => b.createdTimestamp - a.createdTimestamp);
    for (const m of mine.filter((m) => (m.embeds?.[0]?.footer?.text ?? '').startsWith(BOARD_FOOTER))) {
      await m.delete().catch(() => {});
      console.log('[leaderboard] removed the old embed board');
    }
    this.message = mine.find((m) => componentText(m.components).includes(TITLE)) ?? null;
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
        siteUrl: this.config.leaderboardUrl,
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
    try {
      await existing.edit(payload);
      this.lastSig = sig;
    } catch (err) {
      // A message keeps the shape it was sent with, so one posted before this
      // was a Components V2 board cannot be edited into one. Replace it rather
      // than warning every quarter hour about a board that will never update.
      console.warn(`[leaderboard] couldn't edit the board, replacing it: ${err.message}`);
      await existing.delete().catch(() => {});
      this.message = null;
      this.lastSig = null;
      this.message = await channel.send(payload).catch((e) => {
        console.warn(`[leaderboard] and couldn't post a new one: ${e.message}`);
        return null;
      });
      if (this.message) this.lastSig = sig;
    }
  }
}
