import { test } from 'node:test';
import assert from 'node:assert/strict';
import { leaderboardPost, publicLeaderboard, BOARDS, BOARD_FOOTER } from '../src/leaderboard.js';
import { publicStatus } from '../src/webstatus.js';

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
const text = (p) => JSON.stringify(p.embeds[0]);

test('the board is findable again after a restart', () => {
  assert.equal(leaderboardPost(lb()).embeds[0].footer.text.startsWith(BOARD_FOOTER), true);
});

test('every board is on it, and the fighting one is first', () => {
  const names = leaderboardPost(lb()).embeds[0].fields.map((f) => f.name);
  assert.match(names[0], /Kills/);
  for (const want of ['Kill / death', 'Ground held', 'Swing', 'Stayed alive', 'Commanders',
    'Time on the server', 'Got matches going']) {
    assert.ok(names.some((n) => n.includes(want)), want);
  }
});

// The user-visible half of the seeding work: the one contribution the game
// cannot see, credited on the same board as the shooting.
test('getting a quiet server going is on the board, and says the server was quiet', () => {
  const f = leaderboardPost(lb(), { nameOf: (id) => (id === '77' ? 'Bram' : 'someone') })
    .embeds[0].fields.find((x) => x.name.includes('Got matches going'));
  assert.match(f.value, /put their names down/);
  assert.match(f.value, /while the server was quiet/);
  assert.match(f.value, /\*\*Bram\*\* 4 matches/);
  assert.ok(!f.value.includes('77'));
});

test('an empty starters board asks people to use the list', () => {
  const f = leaderboardPost(lb({ starters: [] })).embeds[0].fields.find((x) => x.name.includes('Got matches'));
  assert.match(f.value, /start-a-match/);
});

// A number nobody understands motivates nobody, and the two derived boards are
// the ones that need explaining most.
test('each board says what it measures', () => {
  const fields = leaderboardPost(lb()).embeds[0].fields;
  const ground = fields.find((f) => f.name.includes('Ground'));
  assert.match(ground.value, /objective score climbed while you were on/);
  assert.match(ground.value, /team number/, 'and admits it is shared');
  const swing = fields.find((f) => f.name.includes('Swing'));
  assert.match(swing.value, /with you on than without you/);
  assert.match(swing.value, /yours alone/, 'and that this one is individual');
});

// The swing board is empty until people come and go. Left unexplained that
// looks broken, so it says why and that it fixes itself.
test('an empty swing board explains itself instead of looking broken', () => {
  const swing = leaderboardPost(lb({ swing: [] })).embeds[0].fields.find((f) => f.name.includes('Swing'));
  assert.match(swing.value, /come and go/);
  assert.match(swing.value, /Fills in on its own/);
});

test('the commander board shows readable names, not raw ids', () => {
  const p = leaderboardPost(lb(), { nameOf: (id) => (id === '42' ? 'Rook' : 'nobody') });
  const cmd = p.embeds[0].fields.find((f) => f.name.includes('Commanders'));
  assert.match(cmd.value, /\*\*Rook\*\*/);
  assert.match(cmd.value, /\+3/);
  assert.doesNotMatch(cmd.value, /<@42>/);
});

test('an empty commander board says nobody has been rated, not "nobody yet"', () => {
  const cmd = leaderboardPost(lb({ commanders: [] })).embeds[0].fields.find((f) => f.name.includes('Commanders'));
  assert.match(cmd.value, /commanded and been rated/);
});

test('nothing played yet reads as an invitation, not an error', () => {
  const p = leaderboardPost(lb({ players: 0, counted: 0, kills: [], kd: [], ground: [], swing: [], discipline: [], hours: [], commanders: [] }));
  assert.match(p.embeds[0].description, /Nobody has played yet/);
  assert.match(p.embeds[0].description, /fills in/);
});

test('it never pings anyone', () => {
  assert.deepEqual(leaderboardPost(lb()).allowedMentions, { parse: [] });
});

test('long times read as hours, short ones as minutes', () => {
  const t = text(leaderboardPost(lb({ hours: [row('Rook', { minutes: 120 }), row('Vex', { minutes: 30 })] })));
  assert.match(t, /2h/);
  assert.match(t, /30m/);
});

test('every field stays inside Discord\'s 1024 character limit', () => {
  const many = Array.from({ length: 25 }, (_, n) => row(`PlayerWithAVeryLongName${n}`));
  const p = leaderboardPost(lb({ kills: many, kd: many, ground: many, swing: many, discipline: many, hours: many }));
  for (const f of p.embeds[0].fields) assert.ok(f.value.length <= 1024, `${f.name} is ${f.value.length}`);
});

// Every field being legal is not enough: Discord refuses an embed whose parts
// add up to more than 6000 characters, and refuses it at send time.
test('the whole embed stays inside Discord\'s 6000 character limit', () => {
  const many = Array.from({ length: 25 }, (_, n) => row(`PlayerWithAVeryLongName${n}`));
  const p = leaderboardPost(lb({ kills: many, kd: many, ground: many, swing: many, discipline: many, hours: many }));
  assert.ok(JSON.stringify(p.embeds[0]).length <= 6000, `embed is ${JSON.stringify(p.embeds[0]).length}`);
});

// --- the website half -------------------------------------------------------
// Same numbers, same wording, one definition. Discord and sixdogs.gg
// describing the same board two different ways is the failure to avoid.

test('the website gets every board Discord does, with the same words', () => {
  const web = publicLeaderboard(lb());
  assert.deepEqual(web.boards.map((b) => b.key), BOARDS.map((b) => b.key));
  const discord = leaderboardPost(lb()).embeds[0].fields;
  for (const b of web.boards) {
    const field = discord.find((f) => f.name.includes(b.title));
    assert.ok(field, `${b.title} is missing from the Discord post`);
    assert.ok(field.value.startsWith(b.note), `${b.title} is explained differently on the website`);
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
