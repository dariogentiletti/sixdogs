// Does the core loop actually work, end to end?
//
//   node tools/check-core-loop.mjs
//
// Join the server -> /verify -> code whispered in game -> /confirm -> Verified
// role -> team role -> offered command -> commander role. That is the whole
// path a new player walks, and it is the one that failed for the owner's friend
// with nothing anywhere saying why.
//
// This is not a unit test with stand-ins. It starts the real mock game server
// and the real core service, over real HTTP, with a real database, and drives
// the bot's real CommanderManager, FactionTracker and VerifiedRole. The only
// fake is Discord itself, because there is no offline Discord to talk to.
//
// Exits non-zero on the first thing that is wrong.

import { spawn } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { createPool, migrate } from '../core/src/db.js';
import { createApi } from '../core/src/api.js';
import { RconClient } from '../core/src/rcon.js';
import { Poller } from '../core/src/poller.js';
import { Verifier } from '../core/src/verify.js';
import { CommanderManager } from '../bot/src/commander.js';
import { FactionTracker } from '../bot/src/tracker.js';
import { VerifiedRole } from '../bot/src/verified.js';
import { CoreClient } from '../bot/src/core-client.js';
import { FACTIONS, factionKeyFor } from '../bot/src/factions.js';
import { assignedRoles, roleHealth } from '../bot/src/health.js';

const quiet = { log() {}, warn() {}, error() {} };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
const step = (label) => console.log(`\n\u001b[1m${label}\u001b[0m`);
const ok = (label, cond, extra = '') => {
  if (!cond) failures++;
  console.log(`  ${cond ? '\u001b[32mPASS\u001b[0m' : '\u001b[31mFAIL\u001b[0m'}  ${label}${extra ? ` — ${extra}` : ''}`);
  return cond;
};

// ---------------------------------------------------------------------------
// A Discord that isn't Discord. Roles remember who holds them, members refuse
// a role they aren't allowed to have, and admin-log messages are collected so
// the failure paths can be checked too.
// ---------------------------------------------------------------------------

function fakeGuild({ botTop = 100, dmsClosed = false } = {}) {
  const log = [];
  const roles = new Map();
  let nextPosition = 1;
  const addRole = (name) => {
    const role = {
      id: `R-${name}`, name, position: nextPosition++,
      members: new Map(),
    };
    roles.set(name, role);
    return role;
  };
  for (const r of assignedRoles({ verifiedRoleName: 'Verified', commanderPoolRoleName: 'Commander Pool' })) {
    addRole(r.name);
  }

  const members = new Map();
  const member = (id, displayName) => {
    const held = new Map();
    const m = {
      id,
      displayName,
      user: { id, tag: displayName, username: displayName },
      roles: {
        cache: held,
        add: async (role) => {
          // What Discord really does: refuse anything at or above the bot's own.
          if (role.position >= botTop) {
            const err = new Error('Missing Permissions');
            err.code = 50013;
            throw err;
          }
          held.set(role.id, role);
          role.members.set(id, m);
        },
        remove: async (role) => { held.delete(role.id); role.members.delete(id); },
      },
      // Discord DMs from server members are off by default in some setups, so
      // a closed DM is a normal case worth rehearsing, not an edge one.
      send: async () => {
        if (dmsClosed) throw Object.assign(new Error('Cannot send messages to this user'), { code: 50007 });
      },
    };
    members.set(id, m);
    return m;
  };

  const channels = FACTIONS.map((f) => ({
    id: `V-${f.key}`, name: f.voiceChannelName, isVoiceBased: () => true,
  }));

  return {
    log,
    roles,
    addMember: member,
    guild: {
      client: { user: { id: 'BOT' } },
      roles: { cache: { find: (fn) => [...roles.values()].find(fn), map: (fn) => [...roles.values()].map(fn) }, fetch: async () => {} },
      members: {
        cache: members,
        me: { roles: { highest: { position: botTop } }, permissions: { has: () => true } },
        fetch: async (id) => members.get(id) ?? null,
      },
      channels: { cache: { find: (fn) => channels.find(fn) } },
      voiceStates: { cache: new Map() },
    },
    logger: async (text) => { log.push(text); },
  };
}

// ---------------------------------------------------------------------------

const PORT = 20000 + Math.floor(Math.random() * 20000);
const MOCK = `http://127.0.0.1:${PORT}`;
const DATA = `/tmp/claude-0/coreloop-${process.pid}`;

const mock = spawn(process.execPath, [new URL('../mock/mock-wardogs.mjs', import.meta.url).pathname], {
  env: { ...process.env, MOCK_PORT: String(PORT) }, stdio: 'ignore',
});
const mockCall = (path, body) => fetch(MOCK + path, {
  method: body ? 'POST' : 'GET',
  headers: { 'Content-Type': 'application/json' },
  body: body ? JSON.stringify(body) : undefined,
}).then((r) => r.json());

let pool; let poller; let server;
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
    internalToken: 't', pollIntervalMs: 3000, slowPollIntervalMs: 5000, healthCheckEveryMs: 60000,
    backpressureDepth: 5, sampleRetentionDays: 14, ratingWindowDays: 60, ratingVoteMinutes: 30,
    seedTarget: 45, seedNudgeAt: 10, seedPledgeMinutes: 180, seedCooldownMinutes: 45, seedMinPledges: 5,
    matchStartSection: 'MatchState.PreMatch.WaitingForPlayers.PlayerCount', matchStartKey: 'MinimumRequiredPlayers',
    reservedSection: '/Script/WDGame.WDGameSession', reservedKey: 'DefaultReservedPlayerIds',
    reservedCapKey: 'MaxReservedSlots', databaseUrl: null, dataDir: DATA, rconUrl: MOCK,
  };
  const rcon = new RconClient({ baseUrl: MOCK, password: 'test', timeoutMs: 4000 });
  await rcon.loadCapabilities();
  poller = new Poller({ rcon, pool, config, log: quiet });
  await poller.init();
  const verifier = new Verifier({ pool, rcon, poller, ttlSec: 600, codeDigits: 3 });
  server = createApi({ pool, poller, verifier, rcon, config, log: quiet });
  await new Promise((r) => server.listen(0, r));
  const core = new CoreClient({ baseUrl: `http://127.0.0.1:${server.address().port}`, token: 't' });

  const ME = '100000000000000001';
  const NAME = 'Rook';
  const STEAM = '76561198000000001';

  // -------------------------------------------------------------------------
  step('1. A player joins the game server');
  await mockCall('/mock/join', { name: NAME, steamId: STEAM, faction: 'Lonestar' });
  await poller.pollOnce();
  let state = await core.state();
  ok('core sees them on the server', state.players.some((p) => p.name === NAME),
    state.players.map((p) => p.name).join(', ') || 'nobody');
  ok('and they are NOT linked yet', !state.players.find((p) => p.name === NAME)?.discordId);

  // -------------------------------------------------------------------------
  step('2. /verify sends a code to them in game');
  let started;
  try {
    started = await core.verifyStart(ME, NAME);
  } catch (err) {
    ok('/verify start succeeded', false, err.message);
  }
  ok('/verify found them by in-game name', started?.ok === true, started ? '' : 'no reply');
  const whispers = await mockCall('/mock/messages');
  const mine = whispers.filter((m) => m.steamId === STEAM);
  ok('a whisper really arrived in game', mine.length === 1, `${mine.length} message(s)`);
  const code = /(\d{3,})/.exec(mine.at(-1)?.message ?? '')?.[1];
  ok('the whisper carries a numeric code', Boolean(code), mine.at(-1)?.message ?? '');

  // -------------------------------------------------------------------------
  step('3. /confirm links the account');
  let confirmed;
  try {
    confirmed = await core.verifyConfirm(ME, code);
  } catch (err) {
    ok('/confirm succeeded', false, err.message);
  }
  ok('/confirm linked them', confirmed?.ok === true);
  await poller.pollOnce();
  state = await core.state();
  const linkedPlayer = state.players.find((p) => p.name === NAME);
  ok('core now reports the Discord id with the player', linkedPlayer?.discordId === ME,
    `discordId=${linkedPlayer?.discordId}`);

  // -------------------------------------------------------------------------
  step('4. The bot gives the Verified role');
  const w = fakeGuild();
  const me = w.addMember(ME, NAME);
  const verified = new VerifiedRole({ roleName: 'Verified', onError: w.logger });
  verified.attach(w.guild);
  await verified.set(ME, true);
  ok('Verified role given', me.roles.cache.has('R-Verified'));

  // -------------------------------------------------------------------------
  step('5. The bot gives the team role');
  const tracker = new FactionTracker({ graceMs: 60_000 });
  const linked = state.players.filter((p) => p.discordId).map((p) => ({
    ...p, factionKey: factionKeyFor(p.faction, {}, state.status?.factionScores),
  }));
  ok('their in-game faction maps to a colour', linked[0]?.factionKey === 'blue',
    `${linked[0]?.faction} -> ${linked[0]?.factionKey}`);
  const desired = tracker.update(linked, Date.now());
  const want = desired.get(ME);
  const blue = w.roles.get(FACTIONS.find((f) => f.key === 'blue').roleName);
  if (want) await me.roles.add(blue);
  ok('team role given', me.roles.cache.has(blue.id), `wanted ${want}`);

  // -------------------------------------------------------------------------
  step('6. The bot offers command, and the role follows on accept');
  const commanders = new CommanderManager({
    core, config: { commanderAcceptSec: 60, commanderAwaySec: 300, commanderDelaySec: 0, commanderPoolRoleName: 'Commander Pool' },
    log: w.logger,
  });
  commanders.attach(w.guild);
  commanders.matchId = state.matchId;
  await commanders.tick(linked, (id) => tracker.factionOf(id));
  ok('an offer was made', commanders.state.blue.offer?.discordId === ME,
    `offered to ${commanders.state.blue.offer?.discordId ?? 'nobody'}`);
  const whispersAfter = (await mockCall('/mock/messages')).filter((m) => m.steamId === STEAM);
  ok('they were told in game too', whispersAfter.length === 2 && /COMMANDER/i.test(whispersAfter.at(-1).message),
    whispersAfter.at(-1)?.message ?? '');
  const accepted = await commanders.accept(ME);
  ok('accepting works', accepted.ok === true, accepted.message);
  const cmdRole = w.roles.get(FACTIONS.find((f) => f.key === 'blue').commanderRoleName);
  ok('commander role given', me.roles.cache.has(cmdRole.id));
  // Everyone in the game hears who is commanding, not just the commander.
  // The announcement is deliberately not awaited by grant(), so give it a beat.
  await wait(300);
  const said = await mockCall('/mock/broadcasts');
  ok('the whole server was told who is commanding',
    said.some((m) => /new Blue commander/i.test(m.message) && m.message.includes(NAME)),
    said.at(-1)?.message ?? 'nothing broadcast');

  // -------------------------------------------------------------------------
  step('7. Someone whose Discord DMs are closed');
  const w3 = fakeGuild({ dmsClosed: true });
  const me3 = w3.addMember(ME, NAME);
  const commanders3 = new CommanderManager({
    core, config: { commanderAcceptSec: 60, commanderAwaySec: 300, commanderDelaySec: 0, commanderPoolRoleName: 'Commander Pool' },
    log: w3.logger,
  });
  commanders3.attach(w3.guild);
  commanders3.matchId = state.matchId;
  const before = (await mockCall('/mock/messages')).filter((m) => m.steamId === STEAM).length;
  await commanders3.tick(linked, () => 'blue');
  const afterDm = (await mockCall('/mock/messages')).filter((m) => m.steamId === STEAM);
  ok('they are still told in game', afterDm.length === before + 1);
  ok('and told to type /accept, not to press a button they cannot see',
    /type \/accept/.test(afterDm.at(-1)?.message ?? ''), afterDm.at(-1)?.message ?? '');
  // Show the line that matched, not the last line written: printing the wrong
  // one makes a passing check look like a false positive.
  const dmWarning = w3.log.find((l) => /couldn't DM them/.test(l));
  ok('an admin is told the DM failed', Boolean(dmWarning),
    dmWarning?.split('\n').at(-1) ?? 'nothing logged');
  const stillWorks = await commanders3.accept(ME);
  ok('/accept still works for them', stillWorks.ok === true, stillWorks.message);
  ok('and the commander role is given', me3.roles.cache.size > 0);
  clearTimeout(commanders3.state.blue.offer?.timer);

  // -------------------------------------------------------------------------
  step('8. The failure everyone hits: a role above the bot');
  const w2 = fakeGuild({ botTop: 1 }); // every role is now above the bot
  const me2 = w2.addMember(ME, NAME);
  const verified2 = new VerifiedRole({ roleName: 'Verified', onError: w2.logger });
  verified2.attach(w2.guild);
  await verified2.set(ME, true);
  ok('the role is refused, as Discord would', !me2.roles.cache.size);
  ok('and it is reported where an admin will see it', w2.log.some((l) => /Server Settings/.test(l)),
    w2.log[0] ?? 'nothing logged');

  const commanders2 = new CommanderManager({
    core, config: { commanderAcceptSec: 60, commanderAwaySec: 300, commanderDelaySec: 0, commanderPoolRoleName: 'Commander Pool' },
    log: w2.logger,
  });
  commanders2.attach(w2.guild);
  commanders2.matchId = state.matchId;
  commanders2.latest = { players: linked };
  const granted = await commanders2.grant('blue', ME, 'test');
  ok('a refused commander role does not report success', granted === false);
  ok('and it says so in the log', w2.log.some((l) => /couldn't give/.test(l)),
    w2.log.at(-1) ?? 'nothing logged');
  ok('nobody is left thinking they are commander', commanders2.state.blue.commanderId === null,
    String(commanders2.state.blue.commanderId));

  // -------------------------------------------------------------------------
  step('9. /healthcheck agrees with what just happened');
  const healthy = roleHealth({
    required: assignedRoles({ verifiedRoleName: 'Verified', commanderPoolRoleName: 'Commander Pool' }),
    roles: w.roles, botTop: 100, canManageRoles: true,
  });
  ok('a good server reports no role problems', healthy.every((r) => r.ok));
  const broken = roleHealth({
    required: assignedRoles({ verifiedRoleName: 'Verified', commanderPoolRoleName: 'Commander Pool' }),
    roles: w2.roles, botTop: 1, canManageRoles: true,
  });
  ok('a broken one reports every role', broken.every((r) => !r.ok && r.why === 'above the bot'));
} finally {
  // The commander announcement is fired and not awaited, so give it a moment
  // to land before closing core underneath it.
  await wait(300);
  server?.close();
  await pool?.end?.();
  poller?.stop();
  mock.kill();
  await rm(DATA, { recursive: true, force: true });
}

console.log(failures
  ? `\n\u001b[31m${failures} step(s) failed.\u001b[0m`
  : '\n\u001b[32mThe core loop works end to end.\u001b[0m');
process.exit(failures ? 1 : 0);
