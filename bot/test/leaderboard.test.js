import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  leaderboardPost, publicLeaderboard, chart, monoName, componentText, BOARDS, TITLE,
} from '../src/leaderboard.js';
import { publicStatus } from '../src/webstatus.js';
import { ActionRowBuilder, ContainerBuilder } from 'discord.js';

const row = (name, over = {}) => ({
  name, steamId: name, matches: 4, minutes: 120, kills: 40, deaths: 20,
  kd: 2, ground: 5, swing: 1.5, deathsPer10: 1.7, offMinutes: 30, ...over,
});
const lb = (over = {}) => ({
  days: 30, players: 12, counted: 8, minMinutes: 20, updateMinutes: 15,
  kills: [row('Rook'), row('Vex')],
  kd: [row('Rook')],
  ground: [row('Rook')],
  swing: [row('Rook')],
  discipline: [row('Rook')],
  hours: [row('Rook')],
  commanders: [{ discordId: '42', rounds: 3, minutes: 75, good: 6, poor: 1, toxic: 0, score: 3 }],
  starters: [{ discordId: '77', calls: 4, lastAt: '2026-09-20T00:00:00Z' }],
  ...over,
});
/** Everything the message says, whatever component it is buried in. */
const said = (p) => componentText(p.components);
/** The block under one board's heading. */
const blockFor = (p, title) => {
  const part = p.components[0].components.find((c) => c.content?.includes(title.toUpperCase()));
  return part?.content ?? '';
};
const codeLines = (text) => (text.match(/```\n([\s\S]*?)\n```/)?.[1] ?? '').split('\n').filter(Boolean);

// --- it has to read as a SCOREBOARD -----------------------------------------
// The first version was an embed with a list of names in it, which is what
// every other post the bot makes looks like, and the owner said so. The
// monospace block and the bars are the whole point of this rewrite.

test('the numbers are in a monospace block, so they line up as a table', () => {
  const block = blockFor(leaderboardPost(lb()), 'Kills');
  assert.ok(block.includes('```'), block);
});

test('every row of a board is exactly the same width', () => {
  const p = leaderboardPost(lb({
    kills: [row('Rook'), row('A'), row('SomebodyWithAVeryLongName')],
  }));
  for (const part of p.components[0].components) {
    const lines = codeLines(part.content ?? '');
    if (!lines.length) continue;
    const widths = new Set(lines.map((l) => l.length));
    assert.equal(widths.size, 1, `ragged: ${[...widths].join(', ')}\n${lines.join('\n')}`);
  }
});

// The bar is last and boards without one simply stop early, so total width
// varies. What has to hold is that the NUMBER sits in the same column on every
// board, because that column running straight down is what makes eight blocks
// read as one scoreboard.
test('the number lands in the same column on every board', () => {
  const ends = new Set();
  for (const part of leaderboardPost(lb()).components[0].components) {
    for (const line of codeLines(part.content ?? '')) {
      ends.add(line.replace(/[█·\s]+$/, '').length);
    }
  }
  assert.equal(ends.size, 1, `value column wanders: ${[...ends].join(', ')}`);
});

test('a bar is drawn against the leader, so first place is full', () => {
  const lines = codeLines(blockFor(leaderboardPost(lb({
    kills: [row('Rook', { kills: 100 }), row('Vex', { kills: 50 })],
  })), 'Kills'));
  const blocks = (l) => (l.match(/█/g) ?? []).length;
  const track = (l) => blocks(l) + (l.match(/·/g) ?? []).length;
  assert.equal(blocks(lines[0]), track(lines[0]), 'the leader fills the bar');
  assert.equal(blocks(lines[1]), Math.round(track(lines[1]) / 2), 'half the kills, half the bar');
});

// A bar that is always full says nothing. Ground is a shared team number, so
// everybody on a side clusters and every bar came out maxed on the first try.
test('the shared team board has no bar to be misleading with', () => {
  assert.ok(!blockFor(leaderboardPost(lb()), 'Ground held').includes('█'));
  assert.ok(!blockFor(leaderboardPost(lb()), 'Swing').includes('█'), 'nor the signed one');
  assert.ok(!blockFor(leaderboardPost(lb()), 'Stayed alive').includes('█'), 'nor where less is better');
});

// One odd name must not shear every row under it.
test('a name full of emoji cannot break the table', () => {
  const w = monoName('Rook').length;
  for (const odd of ['Ro🎮ok', '', '   ', 'WayPastTheColumnWidth', 'ｗｉｄｅ', 'a\nb']) {
    assert.equal(monoName(odd).length, w, JSON.stringify(odd));
  }
  assert.ok(monoName('Ro🎮ok').startsWith('Rook'), 'and what is left is still readable');
});

test('an empty board has no block at all, just the reason', () => {
  assert.equal(chart([]), null);
  const swing = blockFor(leaderboardPost(lb({ swing: [] })), 'Swing');
  assert.ok(!swing.includes('```'));
});

// --- the message itself -----------------------------------------------------

test('it is a Components V2 container, with no embed to be refused for', () => {
  const p = leaderboardPost(lb());
  assert.equal(p.flags & (1 << 15), 1 << 15, 'IS_COMPONENTS_V2');
  assert.equal(p.embeds, undefined, 'embeds are refused alongside the flag');
  assert.equal(p.content, undefined, 'and so is content');
  assert.equal(p.components[0].type, 17, 'a container');
});

test('the board is findable again after a restart, by its title', () => {
  const p = leaderboardPost(lb());
  assert.ok(said(p).includes(TITLE));
  assert.ok(componentText(p.components).includes(TITLE), 'and through the same walk the bot uses');
});

test('every board is on it, and the fighting one is first', () => {
  const p = leaderboardPost(lb());
  const titles = p.components[0].components
    .map((c) => c.content?.match(/\*\*.+?\s\s(.+?)\*\*/)?.[1]).filter(Boolean);
  assert.equal(titles[0], 'KILLS');
  for (const b of BOARDS) assert.ok(titles.includes(b.title.toUpperCase()), b.title);
});

test('a button sends people to the full version on the website', () => {
  const p = leaderboardPost(lb(), { siteUrl: 'https://sixdogs.gg/#leaderboard' });
  const button = p.components.at(-1).components[0];
  assert.equal(button.style, 5, 'a link button');
  assert.equal(button.url, 'https://sixdogs.gg/#leaderboard');
  assert.equal(leaderboardPost(lb()).components.length, 1, 'and no dead button without a URL');
});

// The 4000 character limit is across every text component at once, and Discord
// refuses the whole message rather than trimming it.
test('a full board stays inside the 4000 characters Discord allows', () => {
  const many = Array.from({ length: 25 }, (_, n) => row(`PlayerWithAVeryLongName${n}`));
  const p = leaderboardPost(lb({
    kills: many, kd: many, ground: many, swing: many, discipline: many, hours: many,
  }));
  assert.ok(said(p).length <= 4000, `${said(p).length} characters`);
  assert.ok(p.components[0].components.length <= 40, 'and inside the component limit');
});

// Hand-written component JSON, so let discord.js validate it the same way it
// will just before sending. A shape it refuses at send time would mean a board
// that silently never appears.
test('discord.js accepts the components as built', () => {
  const p = leaderboardPost(lb(), { siteUrl: 'https://sixdogs.gg/#leaderboard' });
  const container = new ContainerBuilder(p.components[0]).toJSON();
  assert.equal(container.type, 17);
  assert.ok(container.components.length > 8, 'a heading and a block per board');
  assert.ok(new ActionRowBuilder(p.components[1]).toJSON().components[0].url);
});

// --- what the boards say ----------------------------------------------------

test('getting a quiet server going is on the board, and says the server was quiet', () => {
  const f = blockFor(leaderboardPost(lb(), { nameOf: (id) => (id === '77' ? 'Bram' : 'someone') }), 'Got matches going');
  assert.match(f, /put their names down/);
  assert.match(f, /while the server was quiet/);
  assert.match(f, /Bram/);
  assert.ok(!f.includes('77'));
});

test('an empty starters board asks people to use the list', () => {
  assert.match(blockFor(leaderboardPost(lb({ starters: [] })), 'Got matches going'), /start-a-match/);
});

// A number nobody understands motivates nobody, and the two derived boards are
// the ones that need explaining most.
test('each board says what it measures', () => {
  const p = leaderboardPost(lb());
  const ground = blockFor(p, 'Ground held');
  assert.match(ground, /objective score climbed while you were on/);
  assert.match(ground, /team number/, 'and admits it is shared');
  const swing = blockFor(p, 'Swing');
  assert.match(swing, /with you on than without you/);
  assert.match(swing, /yours alone/, 'and that this one is individual');
});

// The swing board is empty until people come and go. Left unexplained that
// looks broken, so it says why and that it fixes itself.
test('an empty swing board explains itself instead of looking broken', () => {
  const swing = blockFor(leaderboardPost(lb({ swing: [] })), 'Swing');
  assert.match(swing, /come and go/);
  assert.match(swing, /Fills in on its own/);
});

test('the commander board shows readable names, not raw ids', () => {
  const cmd = blockFor(leaderboardPost(lb(), { nameOf: (id) => (id === '42' ? 'Rook' : 'nobody') }), 'Commanders');
  assert.match(cmd, /Rook/);
  assert.match(cmd, /\+3/);
  assert.doesNotMatch(cmd, /<@42>/);
});

test('an empty commander board says nobody has been rated, not "nobody yet"', () => {
  assert.match(blockFor(leaderboardPost(lb({ commanders: [] })), 'Commanders'), /commanded and been rated/);
});

test('nothing played yet reads as an invitation, not an error', () => {
  const p = leaderboardPost(lb({
    players: 0, counted: 0, kills: [], kd: [], ground: [], swing: [],
    discipline: [], hours: [], commanders: [], starters: [],
  }));
  assert.match(said(p), /Nobody has played yet/);
  assert.match(said(p), /fills in/);
});

test('it never pings anyone', () => {
  assert.deepEqual(leaderboardPost(lb()).allowedMentions, { parse: [] });
});

test('long times read as hours, short ones as minutes', () => {
  const t = said(leaderboardPost(lb({ hours: [row('Rook', { minutes: 120 }), row('Vex', { minutes: 30 })] })));
  assert.match(t, /2h/);
  assert.match(t, /30m/);
});

// --- the website half -------------------------------------------------------
// Same numbers, same wording, one definition. Discord and sixdogs.gg
// describing the same board two different ways is the failure to avoid.

test('the website gets every board Discord does, with the same words', () => {
  const web = publicLeaderboard(lb());
  assert.deepEqual(web.boards.map((b) => b.key), BOARDS.map((b) => b.key));
  const discord = said(leaderboardPost(lb()));
  for (const b of web.boards) {
    assert.ok(discord.includes(b.title.toUpperCase()), `${b.title} is missing from the Discord board`);
    assert.ok(discord.includes(b.note), `${b.title} is explained differently on the website`);
  }
});

test('the website board carries the numbers, already formatted', () => {
  const kills = publicLeaderboard(lb()).boards.find((b) => b.key === 'kills');
  assert.deepEqual(kills.rows[0], { name: 'Rook', value: '40', sub: '2 K:D' });
  const swing = publicLeaderboard(lb()).boards.find((b) => b.key === 'swing');
  assert.equal(swing.rows[0].value, '+1.5/min', 'a positive swing reads as a gain');
});

// The rule for everything on this payload: no Discord id ever leaves.
test('the public commander board shows names, never Discord ids', () => {
  const web = publicLeaderboard(lb(), { nameOf: (id) => (id === '42' ? 'Rook' : null) });
  const cmd = web.boards.find((b) => b.key === 'commanders');
  assert.equal(cmd.rows[0].name, 'Rook');
  assert.ok(!JSON.stringify(web).includes('42'), JSON.stringify(cmd));
});

// Somebody who has left the Discord has no name left to look up. Their id is
// never a substitute for one, and each board has to say what to call them:
// "A commander" on the seeding board would just be wrong.
test('someone the guild can no longer name is described, not identified', () => {
  const web = publicLeaderboard(lb(), { nameOf: () => null });
  assert.equal(web.boards.find((b) => b.key === 'commanders').rows[0].name, 'A commander');
  assert.equal(web.boards.find((b) => b.key === 'starters').rows[0].name, 'Someone in our Discord');
  assert.ok(!JSON.stringify(web).includes('42'));
  assert.ok(!JSON.stringify(web).includes('77'));
});

test('an empty board carries its own explanation to the website too', () => {
  const swing = publicLeaderboard(lb({ swing: [] })).boards.find((b) => b.key === 'swing');
  assert.deepEqual(swing.rows, []);
  assert.match(swing.empty, /Fills in on its own/);
});

// It is history, not a live reading, so it is worth showing while the game
// server is down — which is when somebody on the site has time to read it.
test('the leaderboard still goes out while the game server is offline', () => {
  const out = publicStatus({ ok: false }, { leaderboard: lb() });
  assert.equal(out.state, 'offline');
  assert.equal(out.leaderboard.boards.length, BOARDS.length);
});

test('no leaderboard yet is null, not a half-built one', () => {
  assert.equal(publicLeaderboard(null), null);
  assert.equal(publicStatus({ ok: false }).leaderboard, null);
});

// The Worker refuses a push over 20000 characters, and a refused push means the
// live board silently goes stale. A realistic board has to be nowhere near it.
test('a full board leaves the push well inside the size the Worker accepts', () => {
  const many = Array.from({ length: 5 }, (_, n) => row(`SomebodyWithALongName${n}`));
  const out = publicStatus({ ok: false }, {
    leaderboard: lb({ kills: many, kd: many, ground: many, swing: many, discipline: many, hours: many }),
  });
  assert.ok(JSON.stringify(out).length < 10_000, `${JSON.stringify(out).length} characters`);
});
