// Does a match night actually work, end to end?
//
//   node tools/check-events.mjs
//
// An event's whole life takes days: it goes up, people answer, a day out they
// get reminded, an hour out it is declared on or off, and at the time everyone
// is called in. Nobody can sit and watch that happen, and getting it wrong is
// expensive in a way you only find out about on the night.
//
// So this runs the real core service over real HTTP against a real database and
// moves the clock instead of waiting: it creates an event, RSVPs to it, drags
// its start time backwards in the database, and checks that each stage fires
// exactly once and in the right order.
//
// Only Discord is faked, because there is no offline Discord.
//
// Exits non-zero on the first thing that is wrong.

import { spawn } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { createPool, migrate } from '../core/src/db.js';
import { createApi } from '../core/src/api.js';
import { RconClient } from '../core/src/rcon.js';
import { Poller } from '../core/src/poller.js';
import { Verifier } from '../core/src/verify.js';
import { CoreClient } from '../bot/src/core-client.js';
import { eventBoard, eventMessage } from '../bot/src/events.js';

const quiet = { log() {}, warn() {}, error() {} };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
const step = (label) => console.log(`\n\u001b[1m${label}\u001b[0m`);
const ok = (label, cond, extra = '') => {
  if (!cond) failures++;
  console.log(`  ${cond ? '\u001b[32mPASS\u001b[0m' : '\u001b[31mFAIL\u001b[0m'}  ${label}${extra ? ` — ${extra}` : ''}`);
  return cond;
};

const PORT = 20000 + Math.floor(Math.random() * 20000);
const MOCK = `http://127.0.0.1:${PORT}`;
const DATA = `/tmp/claude-0/events-${process.pid}`;
const ID = (n) => `10000000000000${String(n).padStart(4, '0')}`;

const mock = spawn(process.execPath, [new URL('../mock/mock-wardogs.mjs', import.meta.url).pathname], {
  env: { ...process.env, MOCK_PORT: String(PORT) }, stdio: 'ignore',
});

let pool; let server;
try {
  for (let n = 0; n < 60; n++) {
    await wait(100);
    const up = await fetch(`${MOCK}/v1/health`, { headers: { Authorization: 'Bearer test' } })
      .then((r) => r.ok, () => false);
    if (up) break;
  }

  await rm(DATA, { recursive: true, force: true });
  pool = await createPool(null, DATA, { log: quiet, env: {} });
  await migrate(pool);

  const config = {
    internalToken: 't', pollIntervalMs: 5000, slowPollIntervalMs: 5000, healthCheckEveryMs: 60000,
    backpressureDepth: 5, sampleRetentionDays: 14, ratingWindowDays: 60, ratingVoteMinutes: 30,
    seedTarget: 45, seedNudgeAt: 10, seedPledgeMinutes: 180, seedCooldownMinutes: 45, seedMinPledges: 5,
    leaderboardWindowDays: 30, leaderboardMinMinutes: 20,
    eventGoMinutes: 60, eventRemindMinutes: 1440, eventCloseMinutes: 180,
    matchStartSection: 'MatchState.PreMatch.WaitingForPlayers.PlayerCount', matchStartKey: 'MinimumRequiredPlayers',
    reservedSection: '/Script/WDGame.WDGameSession', reservedKey: 'DefaultReservedPlayerIds',
    reservedCapKey: 'MaxReservedSlots', databaseUrl: null, dataDir: DATA, rconUrl: MOCK,
  };
  const rcon = new RconClient({ baseUrl: MOCK, password: 'test', timeoutMs: 4000 });
  await rcon.loadCapabilities();
  const poller = new Poller({ rcon, pool, config, log: quiet });
  await poller.init();
  const verifier = new Verifier({ pool, rcon, poller, ttlSec: 600, codeDigits: 3 });
  server = createApi({ pool, poller, verifier, rcon, config, log: quiet });
  await new Promise((r) => server.listen(0, r));
  const core = new CoreClient({ baseUrl: `http://127.0.0.1:${server.address().port}`, token: 't' });

  /** Move an event's start time, which is how days pass in a few milliseconds. */
  const setStart = (id, fromNowMs) => pool.query(
    'UPDATE events SET starts_at = $2 WHERE id = $1',
    [id, new Date(Date.now() + fromNowMs).toISOString()]);
  const get = async (id) => (await core.request('GET', `/internal/events/${id}`)).event;
  /** What the bot's tick does: read, and if something is due, claim and post it. */
  const beat = async () => {
    const { events } = await core.events();
    const due = events.find((e) => e.action);
    if (!due) return { action: null };
    const r = await core.eventNotice(due.id, due.action);
    return { action: due.action, fired: r.fired, reason: due.reason, event: r.event };
  };

  // -------------------------------------------------------------------------
  step('1. An admin puts a match night up');
  const made = await core.eventCreate({
    date: '2030-10-03', time: '20:00', timezone: 'Europe/London',
    title: 'Thursday match night', target: 10, createdBy: ID(1),
  });
  const id = made.event.id;
  ok('core stored it', !!id, `#${id}`);
  ok('20:00 London in October is 19:00 UTC', made.event.startsAt === '2030-10-03T19:00:00.000Z',
    made.event.startsAt);
  ok('and it needs the number the admin asked for', made.event.target === 10, String(made.event.target));

  step('2. A typo is refused, not stored');
  for (const [what, body] of [
    ['a date written in words', { date: '3 October', time: '20:00' }],
    ['a time on a 12 hour clock', { date: '2030-10-03', time: '8pm' }],
    ['a made-up timezone', { date: '2030-10-03', time: '20:00', timezone: 'Mars/Olympus' }],
    ['a date that has gone by', { date: '2020-01-01', time: '20:00' }],
  ]) {
    const refused = await core.eventCreate({ ...body, createdBy: ID(1) })
      .then(() => null, (e) => e.message);
    ok(`${what} is refused with a readable reason`, !!refused, refused ?? 'it was ACCEPTED');
  }
  ok('and nothing extra was stored', (await core.events()).events.length === 1);

  // -------------------------------------------------------------------------
  step('3. It announces itself, once');
  const first = await beat();
  ok('the first beat announces it', first.action === 'announce' && first.fired, JSON.stringify(first));
  ok('a second beat does not announce it again',
    (await beat()).action !== 'announce', 'the INSERT is the lock');

  step('4. People answer');
  for (const n of [1, 2, 3]) await core.eventRsvp(id, ID(n), 'yes');
  await core.eventRsvp(id, ID(4), 'maybe');
  await core.eventRsvp(id, ID(5), 'no');
  let e = await get(id);
  ok('three are coming', e.yes.length === 3, e.yes.join(', '));
  ok('a maybe is NOT counted towards the target', e.yes.length === 3 && e.maybe.length === 1,
    `yes=${e.yes.length} maybe=${e.maybe.length}`);
  await core.eventRsvp(id, ID(3), 'no');
  e = await get(id);
  ok('changing your mind moves you, it does not add a second row',
    e.yes.length === 2 && e.no.length === 2, `yes=${e.yes.length} no=${e.no.length}`);

  step('5. A day out, the people who have not answered are reminded');
  await setStart(id, 23 * 3_600_000);
  const rem = await beat();
  ok('the reminder goes out', rem.action === 'remind' && rem.fired, JSON.stringify(rem.action));
  ok('and only once', (await beat()).action !== 'remind');

  // -------------------------------------------------------------------------
  step('6. An hour out with too few, it is called OFF');
  await setStart(id, 30 * 60_000);
  const no = await beat();
  ok('the no-go fires', no.action === 'nogo' && no.fired, no.reason ?? '');
  const nogoMsg = eventMessage('nogo', no.event, { roleId: 'R', channelId: 'C' });
  ok('and it pings nobody', !nogoMsg.content.includes('<@&R>'), nogoMsg.content.slice(0, 80));
  ok('but it says why, so it does not read as giving up', /empty map/.test(nogoMsg.content));
  ok('nothing starts at the time', (await (async () => {
    await setStart(id, -60_000);
    return beat();
  })()).action !== 'start', 'a called-off night stays off');

  // -------------------------------------------------------------------------
  step('7. The numbers arrive late, so it is back ON');
  await setStart(id, 30 * 60_000);
  for (const n of [3, 4, 5, 6, 7, 8, 9, 10] ) await core.eventRsvp(id, ID(n), 'yes');
  const go = await beat();
  ok('the go fires once ten are coming', go.action === 'go' && go.fired, go.reason ?? '');
  const board = eventBoard(await get(id), { nameOf: (x) => `P${x.slice(-2)}` });
  ok('the board now says it is on', /It's on/.test(JSON.stringify(board.embeds[0])));
  ok('and shows the Server ID only now',
    /ABC/.test(JSON.stringify(eventBoard(await get(id), { serverId: 'ABC' }).embeds[0])));

  step('8. At the time, everyone is called in');
  await setStart(id, -60_000);
  const start = await beat();
  ok('the start fires', start.action === 'start' && start.fired, start.reason ?? '');
  ok('and only once', (await beat()).action !== 'start');
  const startMsg = eventMessage('start', start.event, { roleId: 'R', serverId: 'ABC-123' });
  ok('the call-in pings the opt-in role and says how to join',
    startMsg.content.includes('<@&R>') && startMsg.content.includes('ABC-123'));

  step('9. Afterwards it stops being current');
  await setStart(id, -4 * 3_600_000);
  ok('it goes quiet', (await beat()).action === null);
  ok('and drops off the upcoming list', (await core.events()).events.length === 0,
    JSON.stringify((await core.events()).events.map((x) => x.id)));
  ok('and its record is still there to look at', (await get(id)).reason === 'finished');

  step('10. An admin can call one off by hand');
  const second = await core.eventCreate({ date: '2030-11-07', time: '20:00', createdBy: ID(1), target: 10 });
  await core.eventCancel(second.event.id, 'Clashes with a tournament.');
  const off = await get(second.event.id);
  ok('it is marked called off', !!off.cancelledAt);
  ok('with the reason people were given', off.cancelReason === 'Clashes with a tournament.', off.cancelReason ?? '');
  ok('nothing more happens to it', off.action === null && off.reason === 'called off', off.reason);
  const offBoard = eventBoard(off);
  ok('and the board has nothing left to click', offBoard.components.length === 0);
  const late = await core.eventRsvp(second.event.id, ID(9), 'yes').then(() => null, (x) => x.message);
  ok('and you cannot sign up for it any more', !!late, late ?? 'the RSVP was ACCEPTED');
} finally {
  server?.close();
  mock.kill();
  await pool?.end?.().catch(() => {});
  await rm(DATA, { recursive: true, force: true });
}

console.log(failures
  ? `\n\u001b[31m${failures} FAILED\u001b[0m`
  : '\n\u001b[32mMatch nights work end to end.\u001b[0m');
process.exit(failures ? 1 : 0);
