import { test } from 'node:test';
import assert from 'node:assert/strict';
import { roleMenu, entryForEmoji, menuPayload, isMenuMessage, CLASS_ROLE_NAMES } from '../src/rolemenu.js';
import { rolePlan, channelPlan } from '../src/setup.js';

test('menu has commander, match alerts + the six WARDOGS classes', () => {
  const names = roleMenu('Commander Pool').map((r) => r.roleName);
  assert.deepEqual(names, ['Commander Pool', 'Match Alerts', 'Assault', 'Medic', 'Recon', 'Support', 'Driver', 'Pilot']);
  const emojis = roleMenu().map((r) => r.emoji);
  assert.equal(new Set(emojis).size, emojis.length, 'emojis are unique');
});

test('emoji lookup tolerates the missing variation selector', () => {
  assert.equal(entryForEmoji('🎖️', 'Commander Pool').roleName, 'Commander Pool');
  assert.equal(entryForEmoji('🎖', 'Commander Pool').roleName, 'Commander Pool');
  assert.equal(entryForEmoji('🚁').roleName, 'Pilot');
  assert.equal(entryForEmoji('😀'), null);
});

test('menu message is recognised only in #roles from the bot', () => {
  const msg = { author: { id: 'bot' }, channel: { name: 'roles' }, ...menuPayload('Commander Pool') };
  assert.ok(isMenuMessage(msg, 'bot', 'roles'));
  // the old plain-text menu is still recognised, so it gets upgraded in place
  assert.ok(isMenuMessage({ author: { id: 'bot' }, channel: { name: 'roles' }, content: '**Pick your roles**\nold', embeds: [] }, 'bot', 'roles'));
  assert.ok(!isMenuMessage({ ...msg, author: { id: 'someone' } }, 'bot', 'roles'));
  assert.ok(!isMenuMessage({ ...msg, channel: { name: 'general' } }, 'bot', 'roles'));
});

test('setup creates the class roles (mentionable) and the #roles channel', () => {
  const plan = rolePlan();
  for (const n of CLASS_ROLE_NAMES) assert.ok(plan.find((r) => r.name === n && r.mentionable), n);
  const info = channelPlan().find((c) => c.category === 'INFO');
  assert.ok(info.channels.some((c) => c.name === 'roles'));
});

test('menu copy: "Label: text" lines, no stray commas after the label', () => {
  const d = menuPayload('Commander Pool').embeds[0].description;
  for (const r of roleMenu()) assert.ok(d.includes(`**${r.label}**: `), r.label);
  assert.ok(!/\*\*, /.test(d));
});

test('operations are off by default, and fully present when enabled', () => {
  assert.ok(!channelPlan().some((c) => c.category === 'OPERATIONS'));
  assert.ok(!rolePlan().some((r) => r.name === 'Operator'));
  const on = { operationsEnabled: true };
  assert.ok(channelPlan(on).some((c) => c.category === 'OPERATIONS'));
  const roles = new Set(['@everyone', '@bot', ...rolePlan('Commander Pool', on).map((r) => r.name)]);
  for (const cat of channelPlan(on)) for (const ch of cat.channels) for (const n of Object.keys(ch.ow ?? {})) assert.ok(roles.has(n), n);
  for (const cat of channelPlan(on)) for (const n of Object.keys(cat.ow)) assert.ok(roles.has(n), n);
});

test('an existing OPERATIONS category gets hidden, channels synced to it', async () => {
  const { applyOperationsVisibility } = await import('../src/setup.js');
  const calls = [];
  const everyone = { id: 'E' };
  const category = { id: 'C', type: 4, name: 'OPERATIONS',
    permissionsFor: () => ({ has: () => true }), permissionOverwrites: { cache: { size: 3 }, set: async (o) => calls.push(['set', o]) } };
  const child = { parentId: 'C', permissionsLocked: false, lockPermissions: async () => calls.push(['lock']) };
  const all = [category, child];
  const guild = { roles: { everyone }, channels: { cache: { find: (fn) => all.find(fn), filter: (fn) => { const r = all.filter(fn); return { every: (f) => r.every(f), values: () => r[Symbol.iterator]() }; } } } };
  const line = await applyOperationsVisibility(guild, { operationsEnabled: false });
  assert.match(line, /hidden/);
  assert.deepEqual(calls.map((c) => c[0]), ['set', 'lock']);
  assert.equal(await applyOperationsVisibility(guild, { operationsEnabled: true }), null);
});
