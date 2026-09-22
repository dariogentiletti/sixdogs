import test from 'node:test';
import assert from 'node:assert/strict';
import { boards, commanderStats, playerStats, starterStats } from '../src/leaderboard.js';

// polls are 5s, so 240 polls = 20 minutes, the minimum a rate board accepts.
const row = (over = {}) => ({
  steam_id: '765', name: 'Rook', matches: 3, kills: 30, deaths: 10, polls: 240,
  cash_earned: 0, on_gain: 100, on_polls: 240, off_gain: 0, off_polls: 0, ...over,
});
const stat = (over) => playerStats([row(over)])[0];

test('minutes come from the poll count and the poll interval', () => {
  assert.equal(stat({ polls: 240 }).minutes, 20);
  assert.equal(playerStats([row({ polls: 120 })], { pollSeconds: 10 })[0].minutes, 20);
});

test('K:D of someone who has never died is their kills, not infinity', () => {
  assert.equal(stat({ kills: 7, deaths: 0 }).kd, 7);
  assert.equal(Number.isFinite(stat({ kills: 7, deaths: 0 }).kd), true);
});

// Ground is a team measure and the whole team shares it. That is the honest
// reading of the data: you cannot hold a zone on your own.
test('ground is the objective score per minute while on the field', () => {
  assert.equal(stat({ on_gain: 100, on_polls: 240 }).ground, 5);
});

// The individual measure. Everyone present for the same polls shares the same
// raw gain, so the only thing that separates them is how their side did while
// they were off.
test('swing is the score rate with you on, minus the rate without you', () => {
  // On: 100 over 20 min = 5/min. Off: 20 over 10 min = 2/min. Swing +3.
  const s = stat({ on_gain: 100, on_polls: 240, off_gain: 20, off_polls: 120 });
  assert.equal(s.swing, 3);
  assert.equal(s.offMinutes, 10);
});

test('swing is negative when the side did better without them', () => {
  assert.equal(stat({ on_gain: 20, on_polls: 240, off_gain: 100, off_polls: 240 }).swing, -4);
});

// The important refusal: with no off-field time there is nothing to compare
// against, so there is no number. Calling it zero would flatter or punish
// people at random depending on how their team happened to do.
test('somebody who never left has NO swing number, not a zero', () => {
  assert.equal(stat({ off_polls: 0, off_gain: 0 }).swing, null);
});

test('deaths per 10 minutes measures position discipline, lower being better', () => {
  assert.equal(stat({ deaths: 10, polls: 240 }).deathsPer10, 5);
});

// ---- the boards ----

const p = (name, over = {}) => playerStats([row({ name, steam_id: name, ...over })])[0];

test('rate boards ignore anyone without enough minutes behind them', () => {
  const brief = p('Flash', { polls: 12, kills: 9, deaths: 0, on_gain: 90 }); // 1 minute
  const solid = p('Rook', { polls: 240, kills: 30, deaths: 10, on_gain: 100 });
  const b = boards([brief, solid], [], [], { minMinutes: 20 });
  assert.deepEqual(b.kd.map((x) => x.name), ['Rook'], 'one lucky minute does not top a rate board');
  assert.equal(b.counted, 1);
  assert.equal(b.players, 2);
  // Totals are different: turning up more IS the point of that board.
  assert.deepEqual(b.kills.map((x) => x.name), ['Rook', 'Flash']);
});

test('the swing board stays empty until people come and go', () => {
  const never = [p('A'), p('B')]; // both on the whole time, no off-field data
  assert.deepEqual(boards(never, [], [], { minMinutes: 20 }).swing, []);
});

test('swing needs real off-field time, not a few seconds of it', () => {
  const barely = p('Barely', { off_polls: 12, off_gain: 0 }); // 1 minute off
  const proper = p('Proper', { off_polls: 240, off_gain: 20 }); // 20 minutes off
  const b = boards([barely, proper], [], [], { minMinutes: 20 });
  assert.deepEqual(b.swing.map((x) => x.name), ['Proper']);
});

test('discipline ranks the fewest deaths first', () => {
  const careful = p('Careful', { deaths: 2 });
  const recklss = p('Reckless', { deaths: 40 });
  assert.deepEqual(boards([recklss, careful], [], [], { minMinutes: 20 }).discipline.map((x) => x.name),
    ['Careful', 'Reckless']);
});

test('boards are capped, and ties break on time played', () => {
  const many = Array.from({ length: 9 }, (_, n) => p(`P${n}`, { kills: 10, deaths: 5, polls: 240 + n }));
  const b = boards(many, [], [], { minMinutes: 20, top: 3 });
  assert.equal(b.kills.length, 3);
  assert.deepEqual(b.kd.map((x) => x.name), ['P8', 'P7', 'P6'], 'more time played wins a tie');
});

test('commanders rank on what their own side voted, capped at -3..+3 a round', () => {
  const rows = [
    { commander_id: '1', rounds: 2, served_sec: 1200, good: 8, poor: 0, toxic: 0 },
    { commander_id: '2', rounds: 5, served_sec: 3000, good: 1, poor: 0, toxic: 2 },
  ];
  const cs = commanderStats(rows);
  assert.equal(cs[0].score, 3, 'capped at +3');
  assert.equal(cs[1].score, -3, 'and at -3');
  assert.equal(cs[0].minutes, 20);
  assert.deepEqual(boards([], cs).commanders.map((c) => c.discordId), ['1', '2']);
});

test('a commander with no rounds is not on the board at all', () => {
  const cs = commanderStats([{ commander_id: '9', rounds: 0, served_sec: 0, good: 0, poor: 0, toxic: 0 }]);
  assert.deepEqual(boards([], cs).commanders, []);
});

test('no players at all is empty boards, not a crash', () => {
  const b = boards([], []);
  for (const k of ['kills', 'kd', 'ground', 'swing', 'discipline', 'hours', 'commanders', 'starters']) {
    assert.deepEqual(b[k], [], k);
  }
});

// ---- who got matches going ----
// The one board that isn't read off the game. It counts seeding call-ins, and
// the point of it is that it rewards something the game cannot see.

test('starters rank on how many matches their name got going', () => {
  const ss = starterStats([
    { discord_id: '1', calls: 2, last_at: '2026-09-01T00:00:00Z' },
    { discord_id: '2', calls: 5, last_at: '2026-09-02T00:00:00Z' },
  ]);
  assert.deepEqual(boards([], [], ss).starters.map((s) => s.discordId), ['2', '1']);
  assert.equal(boards([], [], ss).starters[0].calls, 5);
});

// It counts what somebody did while they were NOT in the server, so gating it
// on time played would rule out exactly the people it is meant to credit.
test('the starters board does not need any minutes played', () => {
  const ss = starterStats([{ discord_id: '1', calls: 3, last_at: null }]);
  const b = boards([], [], ss, { minMinutes: 20 });
  assert.equal(b.counted, 0, 'nobody has played at all');
  assert.deepEqual(b.starters.map((s) => s.calls), [3]);
});
