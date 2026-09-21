import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderPost, loadPosts, checkLimits, linkChannels } from '../src/posts.js';

test('channel placeholders become links; unknown ones stay readable', () => {
  const ids = { roles: '111', general: '222' };
  assert.equal(linkChannels('in {#roles}, {#general}, {#nowhere}', (n) => ids[n] ?? null), 'in <#111>, <#222>, #nowhere');
});

test('file format: cards, colours, sections, side-by-side boxes, footer', () => {
  const p = renderPost(`# First\ncolor: red\nIntro {#roles}\n\n## Section\nBody\n\n### IP\nTBD\n### Port\nTBD\nfooter: small\n---\n# Second\nHi`, () => '9');
  assert.equal(p.content, '');
  assert.equal(p.embeds.length, 2);
  const [a, b] = p.embeds;
  assert.equal(a.title, 'First');
  assert.equal(a.color, 0xd13b3b);
  assert.equal(a.description, 'Intro <#9>');
  assert.deepEqual(a.fields, [
    { name: 'Section', value: 'Body', inline: false },
    { name: 'IP', value: 'TBD', inline: true },
    { name: 'Port', value: 'TBD', inline: true },
  ]);
  assert.deepEqual(a.footer, { text: 'small' });
  assert.equal(b.title, 'Second');
  assert.equal(b.description, 'Hi');
});

test('the shipped posts fit Discord, have their pictures, and read like a person wrote them', async () => {
  const { existsSync } = await import('node:fs');
  const { DEFAULT_CONTENT_DIR } = await import('../src/posts.js');
  const posts = (await loadPosts()).filter((p) => p.channel !== 'server-info'); // live board, file unused
  assert.deepEqual(posts.map((p) => p.channel), ['announcements', 'get-verified', 'how-to-play', 'rules', 'support-the-community']);
  for (const p of posts) {
    const payload = renderPost(p.text, () => '1');
    assert.deepEqual(checkLimits(payload), [], p.channel);
    for (const img of [...payload.images, ...payload.panels]) assert.ok(existsSync(`${DEFAULT_CONTENT_DIR}/${img}`), `${p.channel}: ${img} missing`);
    const all = JSON.stringify(payload.embeds);
    assert.ok(!/[—–]/.test(all), `${p.channel} has a long dash`);
    assert.ok(!/don't have (our own|a) (game )?server/i.test(all), `${p.channel} says there's no server`);
    assert.ok(!/\b(delve|thrilled|vibrant|seamless|elevate|embark|journey|unleash|tapestry)\b/i.test(all), `${p.channel} sounds generated`);
  }
});

test('posts: picture and link buttons', async () => {
  const { renderPost, signature } = await import('../src/posts.js');
  const p = renderPost('# Get verified\nimage: verify-guide.png\nbutton: wardogs.tech | https://wardogs.tech/', () => null);
  assert.deepEqual(p.images, ['verify-guide.png']);
  assert.equal(p.embeds[0].image.url, 'attachment://verify-guide.png');
  assert.equal(p.components[0].toJSON().components[0].url, 'https://wardogs.tech/');
  // Discord's copy (cdn URL) compares equal to ours when nothing changed.
  const discord = [{ ...p.embeds[0], image: { url: 'https://cdn.discordapp.com/attachments/1/2/verify-guide.png?ex=abc' } }];
  assert.equal(signature(discord, p.components, { 'verify-guide.png': 10 }), signature(p.embeds, p.components, { 'verify-guide.png': 10 }));
  assert.notEqual(signature(discord, p.components, { 'verify-guide.png': 11 }), signature(p.embeds, p.components, { 'verify-guide.png': 10 }));
});

test('posts: panel pictures become their own messages, before or after the cards', () => {
  const p = renderPost('panel: a.jpg\npanel: b.jpg\n\n# Title\nText\npanel: c.jpg', () => null);
  assert.deepEqual(p.panels, ['a.jpg', 'b.jpg', 'c.jpg']);
  assert.equal(p.panelsBefore, 2);
  assert.equal(p.embeds.length, 1);
  assert.equal(p.embeds[0].description, 'Text');
});

test('posts: // lines are notes and never show up', () => {
  const p = renderPost('// note\n# Title\nHi\n// button: X | https://example.com', () => null);
  assert.equal(p.embeds[0].description, 'Hi');
  assert.equal(p.components.length, 0);
});

// ---- #announcements is append only ----

import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { syncPosts, APPEND_CHANNELS } from '../src/posts.js';

/**
 * A guild with one text channel, remembering what was sent, edited and deleted.
 * `history` is what the bot has already posted there, newest last.
 */
function fakeGuild(history = []) {
  const sent = [];
  const edited = [];
  const deleted = [];
  const msgs = history.map((h, i) => ({
    id: String(i),
    author: { id: 'BOT' },
    createdTimestamp: i,
    content: '',
    embeds: h.embeds,
    components: [],
    attachments: new Map(),
    edit: async (p) => { edited.push({ id: String(i), p }); },
    delete: async () => { deleted.push(String(i)); },
  }));
  const channel = {
    id: 'C',
    name: 'announcements',
    type: 0,
    messages: { fetch: async () => new Map(msgs.map((m) => [m.id, m])) },
    send: async (p) => { sent.push(p); return { id: 'new' }; },
  };
  return {
    guild: { client: { user: { id: 'BOT' } }, channels: { cache: [channel] } },
    sent, edited, deleted,
  };
}

async function contentDir(text) {
  const dir = await mkdtemp(join(tmpdir(), 'sixdogs-posts-'));
  await writeFile(join(dir, 'announcements.md'), text, 'utf8');
  return dir;
}

const NEWS = "# What's new: 21 September 2026\ncolor: gold\nWe changed some things.";
const OLDER = "# What's new: 1 September 2026\ncolor: gold\nWe changed other things.";

test('#announcements is in the append list, #rules is not', () => {
  assert.ok(APPEND_CHANNELS.includes('announcements'));
  assert.ok(!APPEND_CHANNELS.includes('rules'));
});

test('a new announcement is SENT, never an edit of the last one', async () => {
  const dir = await contentDir(NEWS);
  const w = fakeGuild([{ embeds: renderPost(OLDER, () => '1').embeds }]);
  const report = await syncPosts(w.guild, { dir });
  assert.equal(w.sent.length, 1, 'posted as a new message');
  assert.equal(w.edited.length, 0, 'nothing edited, so people actually see it');
  assert.equal(w.deleted.length, 0, 'the older announcement is left as history');
  assert.match(report.join(' '), /posted a new announcement/);
  await rm(dir, { recursive: true, force: true });
});

// The failure that would matter most: posting the same thing again on every
// restart would turn the channel into spam within a day.
test('an unchanged announcement is not posted again', async () => {
  const dir = await contentDir(NEWS);
  const w = fakeGuild([
    { embeds: renderPost(OLDER, () => '1').embeds },
    { embeds: renderPost(NEWS, () => '1').embeds },
  ]);
  const report = await syncPosts(w.guild, { dir });
  assert.equal(w.sent.length, 0);
  assert.equal(w.edited.length, 0);
  assert.match(report.join(' '), /already has this one/);
  await rm(dir, { recursive: true, force: true });
});

test('only the most recent post is compared, so old ones never trigger a repost', async () => {
  const dir = await contentDir(NEWS);
  // The same text appears further back in the history, but the latest differs.
  const w = fakeGuild([
    { embeds: renderPost(NEWS, () => '1').embeds },
    { embeds: renderPost(OLDER, () => '1').embeds },
  ]);
  await syncPosts(w.guild, { dir });
  assert.equal(w.sent.length, 1, 'the newest is what counts');
  await rm(dir, { recursive: true, force: true });
});

test('an empty channel gets the announcement', async () => {
  const dir = await contentDir(NEWS);
  const w = fakeGuild([]);
  await syncPosts(w.guild, { dir });
  assert.equal(w.sent.length, 1);
  await rm(dir, { recursive: true, force: true });
});

test('turning append off puts a channel back to editing in place', async () => {
  const dir = await contentDir(NEWS);
  const w = fakeGuild([{ embeds: renderPost(OLDER, () => '1').embeds }]);
  await syncPosts(w.guild, { dir, append: [] });
  assert.equal(w.sent.length, 0);
  assert.equal(w.edited.length, 1, 'edited in place, the way #rules works');
  await rm(dir, { recursive: true, force: true });
});

test('the shipped announcement carries a date in its title', async () => {
  const [announcement] = (await loadPosts()).filter((p) => p.channel === 'announcements');
  const { title } = renderPost(announcement.text, () => '1').embeds[0];
  assert.match(title, /\d{1,2} \w+ \d{4}/, `"${title}" should say when it arrived`);
});
