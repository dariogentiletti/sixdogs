import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assignedRoles, healthReport, playerHealth, roleHealth } from '../src/health.js';
import { FACTIONS } from '../src/factions.js';

const cfg = { verifiedRoleName: 'Verified', commanderPoolRoleName: 'Commander Pool' };
// The bot's own role at 50; everything it hands out normally sits below it.
const rolesAt = (position = 10, over = {}) =>
  new Map(assignedRoles(cfg).map((r) => [r.name, { position: over[r.name] ?? position }]));
const check = (roles, extra = {}) =>
  roleHealth({ required: assignedRoles(cfg), roles, botTop: 50, ...extra });

test('every role the bot hands out is checked, and only those', () => {
  const names = assignedRoles(cfg).map((r) => r.name);
  assert.ok(names.includes('Verified'));
  assert.ok(names.includes('Commander Pool'));
  for (const f of FACTIONS) {
    assert.ok(names.includes(f.roleName), f.roleName);
    assert.ok(names.includes(f.commanderRoleName), f.commanderRoleName);
  }
  // Given out by hand. The bot never touches them, so its position is irrelevant.
  for (const byHand of ['Admin', 'Moderator', '★ Supporter']) {
    assert.ok(!names.includes(byHand), `${byHand} should not be checked`);
  }
});

test('roles below the bot are fine', () => {
  assert.ok(check(rolesAt(10)).every((r) => r.ok));
});

// The commonest reason a Discord bot appears to do nothing at all, and it is
// invisible: setup looks fine, then every role assignment throws.
test('a role ABOVE the bot is caught, and the fix names the role', () => {
  const out = check(rolesAt(10, { 'Blue Commander': 60 }));
  const bad = out.filter((r) => !r.ok);
  assert.equal(bad.length, 1);
  assert.equal(bad[0].name, 'Blue Commander');
  assert.equal(bad[0].why, 'above the bot');
  assert.match(bad[0].fix, /drag the bot's own role ABOVE "Blue Commander"/i);
});

test('a role at exactly the bot position is also refused, as Discord does', () => {
  assert.equal(check(rolesAt(10, { Verified: 50 })).find((r) => r.name === 'Verified').ok, false);
});

test('a missing role says to run setup, not to drag anything', () => {
  const roles = rolesAt(10);
  roles.delete('Verified');
  const bad = check(roles).find((r) => r.name === 'Verified');
  assert.equal(bad.why, 'missing');
  assert.match(bad.fix, /setup-server/);
});

test('no Manage Roles permission is reported as that, not as a position problem', () => {
  const out = check(rolesAt(10), { canManageRoles: false });
  assert.ok(out.every((r) => !r.ok && r.why === 'no permission'));
  assert.match(out[0].fix, /Manage Roles/);
});

// The owner's actual report: a friend joined and nothing happened. If they
// never verified, every later step is correctly doing nothing, and that is
// what the answer has to say.
test('someone on the server who never verified is named as the reason', () => {
  const players = playerHealth({
    players: [{ name: 'Rook', steamId: '765', discordId: null }],
    members: new Set(),
  });
  assert.equal(players[0].linked, false);
  const out = healthReport({
    core: { ok: true, serverOk: true }, actions: { message: true }, roles: check(rolesAt(10)), players,
  });
  assert.match(out, /Rook — NOT linked/);
  assert.match(out, /run `\/verify` in Discord while in game/);
});

test('a linked player who left the Discord is spotted', () => {
  const players = playerHealth({
    players: [{ name: 'Vex', steamId: '766', discordId: '42' }],
    members: new Set(),
  });
  assert.equal(players[0].gone, true);
  assert.match(healthReport({
    core: { ok: true, serverOk: true }, actions: { message: true }, roles: [], players,
  }), /has left this Discord/);
});

test('a build that cannot send private messages kills verification, and says so', () => {
  const out = healthReport({
    core: { ok: true, serverOk: true }, actions: { message: false }, roles: [], players: [],
  });
  assert.match(out, /NOT supported by this server build/);
  assert.match(out, /Fix the ❌ lines/);
});

test('core down is reported before anything that depends on it', () => {
  const out = healthReport({
    core: { ok: false, error: 'core unreachable', serverOk: false }, actions: { message: false }, roles: [], players: [],
  });
  assert.match(out, /core unreachable/);
  assert.ok(out.indexOf('Core service') < out.indexOf('Game server'));
});

test('an empty server says to get someone to join rather than claiming success', () => {
  const out = healthReport({
    core: { ok: true, serverOk: true }, actions: { message: true }, roles: check(rolesAt(10)), players: [],
  });
  assert.match(out, /Nobody is on the game server/);
  assert.match(out, /Ask someone to join/);
});

test('all clear says so plainly', () => {
  const out = healthReport({
    core: { ok: true, serverOk: true },
    actions: { message: true },
    roles: check(rolesAt(10)),
    players: playerHealth({ players: [{ name: 'Rook', steamId: '765', discordId: '42' }], members: new Set(['42']) }),
  });
  assert.match(out, /Everything a new player needs is working/);
  assert.doesNotMatch(out, /❌/);
});
