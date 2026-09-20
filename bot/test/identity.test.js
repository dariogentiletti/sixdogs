import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { applyIdentity } from '../src/identity.js';

const APPLIED = fileURLToPath(new URL('../assets/.avatar-applied', import.meta.url));

function fake({ username, nickname }) {
  const calls = [];
  const client = { user: { username,
    setUsername: async (n) => { calls.push(['name', n]); client.user.username = n; },
    setAvatar: async (buf) => { calls.push(['avatar', buf.length > 0]); } } };
  const me = { nickname, setNickname: async (n) => { calls.push(['nick', n]); me.nickname = n; } };
  return { client, guild: { members: { me } }, calls };
}

test('renames, clears the nickname, uploads the avatar once', async () => {
  await rm(APPLIED, { force: true });
  const w = fake({ username: 'SIXDOGS Bot', nickname: 'SIXDOGS Bot' });
  const first = await applyIdentity(w.client, w.guild, { name: 'SIXDOGS' });
  assert.deepEqual(w.calls, [['name', 'SIXDOGS'], ['nick', null], ['avatar', true]]);
  assert.equal(first.length, 3);

  // Second start: nothing left to do, so no calls (keeps clear of Discord's rate limits).
  w.calls.length = 0;
  const second = await applyIdentity(w.client, w.guild, { name: 'SIXDOGS' });
  assert.deepEqual(w.calls, []);
  assert.deepEqual(second, []);
  await rm(APPLIED, { force: true });
});

test('a rate-limited rename is reported, not fatal', async () => {
  const w = fake({ username: 'Old', nickname: null });
  w.client.user.setUsername = async () => { throw new Error('You are changing your username too fast'); };
  const r = await applyIdentity(w.client, w.guild, { name: 'SIXDOGS' });
  assert.match(r[0], /^! couldn't change the name yet/);
  await rm(APPLIED, { force: true });
});
