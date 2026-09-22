// Works out, with Discord's own rules, what each kind of member can do in every
// planned channel. This is the check that the server "just works" for people.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PermissionFlagsBits as P, PermissionsBitField } from 'discord.js';
import { channelPlan, rolePlan } from '../src/setup.js';

const bits = (list) => PermissionsBitField.resolve(list ?? []);
// Server-wide @everyone after setup: Discord's defaults minus View Channels and @everyone pings.
const BASE = PermissionsBitField.resolve(PermissionsBitField.Default) & ~P.ViewChannel & ~P.MentionEveryone;

/** Discord's overwrite order: @everyone, then all role denies, then all role allows. */
function effective(roles, ow) {
  const serverRoles = rolePlan('Commander Pool', { operationsEnabled: true });
  if (roles.some((r) => serverRoles.find((x) => x.name === r)?.permissions?.includes(P.Administrator))) return ~0n;
  let p = BASE;
  for (const r of roles) p |= bits(serverRoles.find((x) => x.name === r)?.permissions);
  const e = ow['@everyone'];
  if (e) p = (p & ~bits(e.deny)) | bits(e.allow);
  let d = 0n, a = 0n;
  for (const r of roles) if (ow[r]) { d |= bits(ow[r].deny); a |= bits(ow[r].allow); }
  return (p & ~d) | a;
}

const plan = channelPlan();
const channels = plan.flatMap((cat) => cat.channels.map((ch) => ({ ...ch, category: cat.category, ow: { ...cat.ow, ...(ch.ow ?? {}) } })));
const can = (roles, name, perm) => {
  const ch = channels.find((c) => c.name === name);
  assert.ok(ch, name);
  const p = effective(roles, ch.ow);
  // Discord: no View Channel means nothing else in that channel works.
  return (p & P.ViewChannel) !== 0n && (p & perm) !== 0n;
};

const UNVERIFIED = [];
const VERIFIED = ['Verified'];
const BLUE = ['Verified', 'Blue'];
const BLUE_CMD = ['Verified', 'Blue', 'Blue Commander'];
const RED = ['Verified', 'Red'];

test('not verified: can say hello in #general, but not post links or files', () => {
  for (const n of ['rules', 'how-to-play', 'roles', 'server-info', 'support-the-community', 'announcements', 'general', 'clips-screenshots']) {
    assert.ok(can(UNVERIFIED, n, P.ViewChannel), `sees #${n}`);
  }
  // Making people verify before they can say a word loses the ones who were
  // only half sure, so #general is open to everyone.
  assert.ok(can(UNVERIFIED, 'general', P.SendMessages), 'can talk in #general');
  assert.ok(can(UNVERIFIED, 'general', P.AddReactions), 'and react');

  // What they cannot do is post a link, a file or an embed, which is very
  // nearly the whole scam vector: a drive-by account is here to paste a URL.
  for (const p of [P.EmbedLinks, P.AttachFiles, P.UseExternalEmojis]) {
    assert.ok(!can(UNVERIFIED, 'general', p), `no ${p} in #general`);
  }
  assert.ok(!can(UNVERIFIED, 'general', P.CreatePublicThreads));

  // Everything else stays shut.
  for (const n of ['rules', 'how-to-play', 'roles', 'server-info', 'support-the-community', 'announcements', 'clips-screenshots']) {
    assert.ok(!can(UNVERIFIED, n, P.SendMessages), `can't write in #${n}`);
  }
  assert.ok(can(UNVERIFIED, 'get-verified', P.SendMessages) && can(UNVERIFIED, 'get-verified', P.UseApplicationCommands), 'can type /verify');
  assert.ok(can(UNVERIFIED, 'Command Lobby', P.ViewChannel), 'sees the lobby');
  assert.ok(!can(UNVERIFIED, 'Command Lobby', P.Connect), "can't join it");
  for (const f of ['Blue', 'Red', 'Green']) assert.ok(!can(UNVERIFIED, `${f} Command (listen)`, P.ViewChannel));
  assert.ok(!can(UNVERIFIED, 'staff-chat', P.ViewChannel));
});

// It sits in COMMUNITY so people find it, but it is still one message the bot
// edits and finds again by its footer. Chatting over it buries it out of the
// window the bot looks in, and then there are two boards.
test('#leaderboard is in COMMUNITY but nobody talks in it', () => {
  for (const who of [UNVERIFIED, VERIFIED, ['Verified', 'Moderator']]) {
    assert.ok(can(who, 'leaderboard', P.ViewChannel), `${who} sees it`);
    assert.ok(!can(who, 'leaderboard', P.SendMessages), `${who} cannot post in it`);
    assert.ok(!can(who, 'leaderboard', P.CreatePublicThreads), `${who} cannot start a thread`);
  }
  // A moderator still needs to be able to clear up if something does land.
  assert.ok(can(['Verified', 'Moderator'], 'leaderboard', P.ManageMessages));
});

test('verifying is still worth doing: links, files and pictures', () => {
  for (const p of [P.EmbedLinks, P.AttachFiles, P.UseExternalEmojis]) {
    assert.ok(can(VERIFIED, 'general', p), 'verified people get the lot');
  }
  assert.ok(can(VERIFIED, 'clips-screenshots', P.SendMessages), 'and the screenshots channel');
});

test('verified: chat in COMMUNITY, talk in the lobby, no team channel without a team', () => {
  assert.ok(can(VERIFIED, 'general', P.SendMessages));
  assert.ok(can(VERIFIED, 'clips-screenshots', P.AttachFiles));
  assert.ok(!can(VERIFIED, 'rules', P.SendMessages));
  assert.ok(can(VERIFIED, 'Command Lobby', P.Connect) && can(VERIFIED, 'Command Lobby', P.Speak));
  for (const f of ['Blue', 'Red', 'Green']) assert.ok(!can(VERIFIED, `${f} Command (listen)`, P.Connect));
});

test('Blue: lobby and Blue only; listens, never talks; can watch the live map', () => {
  assert.ok(can(BLUE, 'Command Lobby', P.Connect));
  assert.ok(can(BLUE, 'Blue Command (listen)', P.Connect));
  assert.ok(!can(BLUE, 'Blue Command (listen)', P.Speak));
  assert.ok(!can(BLUE, 'Blue Command (listen)', P.Stream));
  assert.ok(can(BLUE, 'Blue Command (listen)', P.UseEmbeddedActivities));
  assert.ok(!can(BLUE, 'Red Command (listen)', P.ViewChannel), "can't even see Red");
  assert.ok(!can(BLUE, 'Green Command (listen)', P.Connect));
  assert.ok(can(RED, 'Red Command (listen)', P.Connect) && !can(RED, 'Blue Command (listen)', P.Connect));
});

test('Blue commander: talks in Blue only', () => {
  assert.ok(can(BLUE_CMD, 'Blue Command (listen)', P.Speak));
  assert.ok(can(BLUE_CMD, 'Blue Command (listen)', P.UseEmbeddedActivities));
  assert.ok(!can(['Verified', 'Blue Commander'], 'Red Command (listen)', P.Connect));
});

test('staff and admins', () => {
  assert.ok(can(['Verified', 'Moderator'], 'staff-chat', P.SendMessages));
  assert.ok(can(['Verified', 'Moderator'], 'general', P.ManageMessages));
  assert.ok(!can(['Verified', 'Moderator'], 'Red Command (listen)', P.ViewChannel), 'moderators stay out of team comms');
  assert.ok(can(['Admin'], 'announcements', P.MentionEveryone));
  assert.ok(can(['Admin'], 'Red Command (listen)', P.Speak), 'Administrator sees everything (Discord rule)');
});
