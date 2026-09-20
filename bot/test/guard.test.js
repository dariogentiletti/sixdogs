import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PermissionsBitField, PermissionFlagsBits as P } from 'discord.js';
import { checkVoice, tidyGetVerified } from '../src/guard.js';

const perms = (...p) => new PermissionsBitField(p);

test('someone no longer allowed in a team channel is moved to the lobby', async () => {
  const lobby = { type: 2, name: 'Command Lobby', permissionsFor: () => perms(P.ViewChannel, P.Connect) };
  const blue = { name: 'Blue Command (listen)', permissionsFor: () => perms() };
  let movedTo;
  const member = {
    id: '1', user: { tag: 'x' }, guild: { channels: { cache: { find: (fn) => [lobby].find(fn) } } },
    voice: { channel: blue, setChannel: async (c) => { movedTo = c; } },
  };
  assert.equal(await checkVoice(member), 'moved to Command Lobby');
  assert.equal(movedTo, lobby);

  // Allowed: left alone. Not allowed in the lobby either: disconnected.
  member.voice.channel = { name: 'Blue', permissionsFor: () => perms(P.ViewChannel, P.Connect) };
  assert.equal(await checkVoice(member), null);
  member.voice.channel = blue;
  lobby.permissionsFor = () => perms(P.ViewChannel);
  assert.equal(await checkVoice(member), 'disconnected');
  assert.equal(movedTo, null);
});

test("#get-verified: people's messages are removed with a hint; admins and bots are left alone", async () => {
  let deleted = 0, hints = 0;
  const msg = (extra) => ({
    guild: {}, author: { id: '9', bot: false }, channel: { name: 'get-verified', send: async () => { hints++; return { delete: async () => {} }; } },
    member: { permissions: perms() }, delete: async () => { deleted++; }, ...extra,
  });
  assert.equal(await tidyGetVerified(msg()), true);
  assert.equal(await tidyGetVerified(msg({ member: { permissions: perms(P.Administrator) } })), false);
  assert.equal(await tidyGetVerified(msg({ author: { id: 'b', bot: true } })), false);
  assert.equal(await tidyGetVerified(msg({ channel: { name: 'general' } })), false);
  assert.deepEqual([deleted, hints], [1, 1]);
});
