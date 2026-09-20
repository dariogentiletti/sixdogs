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
