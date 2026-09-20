import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { render, loadFacts } from '../../tools/facts.mjs';
import { loadPosts } from '../src/posts.js';
import { publicStatus } from '../src/webstatus.js';

const facts = loadFacts();

test('template: values, if/else, each, html escaping', () => {
  const f = { a: 'x<y', list: [{ n: 1 }, { n: 2 }], empty: '', p: ['one', 'two'] };
  assert.equal(render('{{a}}', f), 'x<y');
  assert.equal(render('{{a}}', f, { html: true }), 'x&lt;y');
  assert.equal(render('{{#each list}}[{{n}}]{{/each}}', f), '[1][2]');
  assert.equal(render('{{#if empty}}yes{{else}}no{{/if}}', f), 'no');
  assert.equal(render('{{p}}', f), 'one\n\ntwo');
  assert.equal(render('keep {{ }} as is', f), 'keep {{ }} as is');
  assert.throws(() => render('{{nope.key}}', f), /no "nope.key"/);
});

test('every content post and the website template fill in from community.json', async () => {
  for (const file of readdirSync(new URL('../../content/', import.meta.url)).filter((n) => n.endsWith('.md'))) {
    const text = readFileSync(new URL(`../../content/${file}`, import.meta.url), 'utf8');
    assert.doesNotThrow(() => render(text, facts), file);
  }
  const html = render(readFileSync(new URL('../../website-src/index.html', import.meta.url), 'utf8'), facts, { html: true });
  assert.ok(!html.includes('{{'), 'website has unfilled placeholders');
  assert.ok(!/[—]/.test(JSON.stringify(facts)), 'no long dashes in community.json');
});

test('support post: donate button only once there is a link', async () => {
  const find = async (f) => (await loadPosts(undefined, f)).find((p) => p.channel === 'support-the-community').text;
  assert.ok(!/^button:/m.test(await find({ ...facts, donate: { ...facts.donate, url: '' } })));
  const withLink = await find({ ...facts, donate: { ...facts.donate, url: 'https://ko-fi.com/sixdogs', platform: 'PayPal', button: 'Donate with PayPal' } });
  assert.match(withLink, /^button: Donate with PayPal \| https:\/\/ko-fi.com\/sixdogs$/m);
  assert.match(withLink, new RegExp(facts.founder.letter[0].slice(0, 30).replace(/[()]/g, '\\$&')));
});

test('website status: public summary, no Discord IDs', () => {
  const state = {
    ok: true, matchId: 7, clockDirection: 'down',
    status: { serverName: 'SIXDOGS', map: 'Valley', matchSeconds: 600, players: { current: 2, max: 64 },
      factionScores: [{ name: 'Lonestar', colorHex: '#3a7bd5', score: 10 }, { name: 'Valkyra', colorHex: '#d13b3b', score: 4 }] },
    players: [
      { name: 'Rook', faction: 'Lonestar', kills: 5, discordId: '111' },
      { name: 'Ash', faction: 'Valkyra', kills: 1, discordId: null },
    ],
  };
  const out = publicStatus(state, { now: 0, commanderOf: (k) => (k === 'blue' ? '111' : null), nameOf: () => 'Rook' });
  assert.equal(out.state, 'live');
  assert.equal(out.teams.find((t) => t.key === 'blue').commander, 'Rook');
  assert.equal(out.endsAt, new Date(600_000).toISOString());
  assert.deepEqual(out.top.map((p) => p.name), ['Rook', 'Ash']);
  assert.ok(!JSON.stringify(out).includes('111'));
  assert.equal(publicStatus({ ok: false }).state, 'offline');
  assert.equal(publicStatus(null, { notConnected: true }).state, 'not-connected');
});
