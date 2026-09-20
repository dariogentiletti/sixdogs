import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PermissionsBitField, PermissionFlagsBits as P } from 'discord.js';
import { enforceLayout } from '../src/setup.js';

function fakeGuild() {
  const calls = [];
  const channels = [];
  let pos = 0;
  const mk = (name, { type = 0, parentId = 'INFO', rateLimitPerUser = 0 } = {}) => {
    const ow = new Map();
    const ch = {
      id: type === 4 ? name : `c-${name}`, name, type, parentId, rawPosition: pos++, rateLimitPerUser,
      setName: async (n) => { calls.push(['rename', name, n]); ch.name = n; },
      setRateLimitPerUser: async (n) => { calls.push(['slowmode', ch.name, n]); ch.rateLimitPerUser = n; },
      delete: async () => { calls.push(['delete', ch.name]); channels.splice(channels.indexOf(ch), 1); },
      permissionOverwrites: {
        cache: ow,
        set: async (list) => {
          calls.push(['perms', ch.name]);
          ow.clear();
          for (const o of list) ow.set(o.id, { allow: { bitfield: PermissionsBitField.resolve(o.allow) }, deny: { bitfield: PermissionsBitField.resolve(o.deny) } });
        },
      },
    };
    channels.push(ch);
    return ch;
  };
  for (const c of ['INFO', 'COMMUNITY', 'COMMAND', 'STAFF']) mk(c, { type: 4, parentId: null });
  ['rules', 'roles', 'server-info', 'announcements'].forEach((n) => mk(n));
  ['general', 'clips', 'looking-for-squad'].forEach((n) => mk(n, { parentId: 'COMMUNITY' }));
  ['Command Lobby', 'Blue Command (listen)', 'Red Command (listen)', 'Green Command (listen)'].forEach((n) => mk(n, { type: 2, parentId: 'COMMAND' }));
  ['staff-chat', 'admin-log'].forEach((n) => mk(n, { parentId: 'STAFF' }));
  const roles = ['Admin', 'Moderator', 'Verified', 'Blue', 'Red', 'Green', 'Blue Commander', 'Red Commander', 'Green Commander']
    .map((name) => ({ id: `R-${name}`, name }));
  roles.push({ id: 'E', name: '@everyone' });
  let everyonePerms = PermissionsBitField.resolve(PermissionsBitField.Default);
  const everyone = {
    id: 'E',
    get permissions() { return new PermissionsBitField(everyonePerms); },
    setPermissions: async (p) => { calls.push(['everyone']); everyonePerms = PermissionsBitField.resolve(p); },
  };
  const guild = {
    roles: { everyone, cache: { map: (fn) => roles.map(fn) } },
    members: { me: { id: 'BOT' } },
    channels: {
      cache: { find: (fn) => channels.find(fn) },
      fetch: async () => {},
      create: async ({ name, type = 0, parent, permissionOverwrites, rateLimitPerUser }) => {
        calls.push(['create', name]);
        const ch = mk(name, { type, parentId: parent, rateLimitPerUser });
        await ch.permissionOverwrites.set(permissionOverwrites);
        return ch;
      },
      setPositions: async (list) => {
        calls.push(['order']);
        for (const { channel, position } of list) channels.find((c) => c.id === channel).rawPosition = position;
      },
    },
  };
  return { guild, calls, channels };
}

test('first start: everything set to the plan; second start: nothing to do', async () => {
  const w = fakeGuild();
  const first = await enforceLayout(w.guild);
  for (const line of [
    '@everyone: server-wide View Channels and @everyone pings turned off',
    'renamed #clips to #clips-screenshots', 'removed #looking-for-squad',
    'created #get-verified', 'created #how-to-play', 'created #support-the-community',
    'permissions set on #rules', 'permissions set on #general',
    'permissions set on 🔊Blue Command (listen)', 'permissions set on #admin-log',
    'put the INFO channels in order',
  ]) assert.ok(first.includes(line), line);
  const info = w.channels.filter((c) => c.parentId === 'INFO').sort((a, b) => a.rawPosition - b.rawPosition).map((c) => c.name);
  assert.deepEqual(info, ['rules', 'get-verified', 'how-to-play', 'roles', 'server-info', 'support-the-community', 'announcements']);
  assert.equal(w.channels.find((c) => c.name === 'get-verified').rateLimitPerUser, 10);

  const blue = w.channels.find((c) => c.name === 'Blue Command (listen)').permissionOverwrites.cache;
  assert.ok(blue.get('R-Blue').allow.bitfield & P.UseEmbeddedActivities, 'the team can watch the live map');
  assert.ok(blue.get('R-Blue').deny.bitfield & P.Speak, 'but not talk');
  assert.ok(blue.get('R-Verified').deny.bitfield & P.Connect, 'other verified people are kept out');
  const rules = w.channels.find((c) => c.name === 'rules').permissionOverwrites.cache;
  assert.ok(rules.get('E').deny.bitfield & P.SendMessages, 'everyone cannot post in #rules');
  assert.ok(rules.get('BOT').allow.bitfield & P.SendMessages, 'the bot can');
  const ann = w.channels.find((c) => c.name === 'announcements').permissionOverwrites.cache;
  assert.ok(ann.get('R-Admin').allow.bitfield & P.SendMessages, 'Admins can post in #announcements');

  w.calls.length = 0;
  assert.deepEqual(await enforceLayout(w.guild), []);
  assert.deepEqual(w.calls, []);
});
