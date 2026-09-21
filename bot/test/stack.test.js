// The bill people see is generated from stack.json, so it cannot drift from
// what SIXDOGS actually runs on. These tests are the guard on that.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { costsFromStack, loadFacts, monthlyCost, STACK_PATH } from '../../tools/facts.mjs';

const stack = JSON.parse(readFileSync(STACK_PATH, 'utf8'));

test('every real service reaches the bill, and the total is their sum', () => {
  const { items, total } = costsFromStack(stack);
  const billed = stack.services.filter((s) => s.onBill !== false);
  assert.equal(items.length, billed.length, 'no service silently missing from the bill');
  // Uses the same helper the bill does, so a yearly service is counted at its
  // monthly share rather than skipped for having no monthlyUsd.
  const sum = billed.reduce((n, s) => n + monthlyCost(s), 0);
  const expected = (Math.round(sum * 100) / 100).toLocaleString('en-US', { maximumFractionDigits: 2 });
  assert.ok(total.includes(expected), `total should contain ${expected}, got "${total}"`);
});

test('the thing that went wrong before: bot hosting is on the bill', () => {
  // Railway was paid for and left off the costs entirely. It is a real monthly
  // expense, so it has to appear wherever the bill appears.
  const { items } = costsFromStack(stack);
  assert.ok(items.some((i) => /bot hosting/i.test(i.item)), 'bot hosting is missing');
  assert.ok(stack.services.some((s) => s.id === 'bot' && s.provider === 'Railway'));
});

test('an unchecked figure is shown as "about", a checked one is not', () => {
  const { items } = costsFromStack({
    services: [
      { name: 'Known', monthlyUsd: 20, confirmed: true },
      { name: 'Guessed', monthlyUsd: 7, confirmed: false },
      { name: 'Nothing', monthlyUsd: 0, confirmed: false },
    ],
  });
  assert.deepEqual(items, [
    { item: 'Known', monthly: '$20' },
    { item: 'Guessed', monthly: 'about $7' },
    { item: 'Nothing', monthly: 'free' },
  ]);
});

test('a total built only from checked figures is stated plainly', () => {
  const { total } = costsFromStack({
    services: [{ name: 'A', monthlyUsd: 100, confirmed: true }, { name: 'B', monthlyUsd: 15, confirmed: true }],
  });
  assert.equal(total, '$115', 'no hedging when every figure is real');
});

test('onBill false keeps something out of the public bill but in the stack', () => {
  const { items, total } = costsFromStack({
    services: [
      { name: 'Shown', monthlyUsd: 10, confirmed: true },
      { name: 'Hidden', monthlyUsd: 999, confirmed: true, onBill: false },
    ],
  });
  assert.deepEqual(items.map((i) => i.item), ['Shown']);
  assert.equal(total, '$10');
});

test('loadFacts serves the derived bill, not a stale copy in community.json', () => {
  const facts = loadFacts();
  assert.ok(Array.isArray(facts.costs.items) && facts.costs.items.length);
  assert.ok(facts.costs.total);
  assert.ok(facts.costs.leftover, 'the wording still comes from community.json');
  const raw = JSON.parse(readFileSync(new URL('../../community.json', import.meta.url), 'utf8'));
  assert.equal(raw.costs.items, undefined, 'no second list of costs to forget about');
  assert.equal(raw.costs.total, undefined);
});

test('the stack file stays free of anything secret', () => {
  // Looks at the shape, not the prose: the file's own note tells people not to
  // put passwords in it, and a plain word search would flag that note.
  const walk = (node, path = '') => {
    if (node && typeof node === 'object') {
      for (const [k, v] of Object.entries(node)) {
        assert.doesNotMatch(k, /(password|passwd|secret|token|api[_-]?key|credential|private[_-]?key)/i,
          `${path}${k} looks like somewhere a secret would end up`);
        if (!k.startsWith('_') && k !== 'notes' && k !== 'what' && k !== 'howTo') {
          walk(v, `${path}${k}.`);
        }
      }
    } else if (typeof node === 'string') {
      // A long unbroken run of random-looking characters is what a leaked key
      // looks like. Two things are deliberately not that: a UUID, which is an
      // identifier by design (the server ID is printed on the website), and a
      // URL. Everything else here is prices, names and short plan labels.
      const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (uuid.test(node) || /^https?:\/\//.test(node)) return;
      assert.doesNotMatch(node, /\b[A-Za-z0-9_-]{24,}\b/, `${path} holds something key-shaped`);
    }
  };
  walk(JSON.parse(readFileSync(STACK_PATH, 'utf8')));
});

test('a yearly bill is shown as its monthly share', () => {
  // The domain is paid once a year; the bill is monthly.
  assert.equal(monthlyCost({ yearlyUsd: 65 }).toFixed(2), '5.42');
  assert.equal(monthlyCost({ monthlyUsd: 5 }), 5);
  assert.equal(monthlyCost({}), 0);

  const { items, total } = costsFromStack({
    services: [
      { name: 'Monthly thing', monthlyUsd: 115, confirmed: true },
      { name: 'Yearly thing', yearlyUsd: 65, confirmed: true },
    ],
  });
  assert.deepEqual(items, [
    { item: 'Monthly thing', monthly: '$115' },
    { item: 'Yearly thing', monthly: '$5.42' },
  ]);
  assert.equal(total, '$120.42', 'the yearly one is counted at its monthly share');
});

test('whole amounts do not grow decimals', () => {
  const { items, total } = costsFromStack({
    services: [{ name: 'A', monthlyUsd: 115, confirmed: true }, { name: 'B', monthlyUsd: 5, confirmed: true }],
  });
  assert.deepEqual(items.map((i) => i.monthly), ['$115', '$5']);
  assert.equal(total, '$120');
});

test('the live bill has no guesses left in it', () => {
  const { items, total } = costsFromStack(JSON.parse(readFileSync(STACK_PATH, 'utf8')));
  assert.ok(!total.startsWith('about'), 'every figure is confirmed, so the total is stated plainly');
  assert.ok(items.every((i) => !i.monthly.startsWith('about')), items.map((i) => i.monthly).join(', '));
});

test('the secret check still catches a real credential', () => {
  // Guard on the guard: loosening it for UUIDs must not blind it to keys.
  const walk = (node, path = '') => {
    if (node && typeof node === 'object') {
      for (const [k, v] of Object.entries(node)) {
        assert.doesNotMatch(k, /(password|passwd|secret|token|api[_-]?key|credential|private[_-]?key)/i, `${path}${k}`);
        if (!k.startsWith('_') && k !== 'notes' && k !== 'what' && k !== 'howTo') walk(v, `${path}${k}.`);
      }
    } else if (typeof node === 'string') {
      const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (uuid.test(node) || /^https?:\/\//.test(node)) return;
      assert.doesNotMatch(node, /\b[A-Za-z0-9_-]{24,}\b/, `${path} holds something key-shaped`);
    }
  };
  // A UUID and a URL are fine.
  assert.doesNotThrow(() => walk({ serverId: '41186c61-6d6b-4149-ace0-375bacdee3f8', url: 'https://ko-fi.com/sixdogs' }));
  // A pasted token is not.
  assert.throws(() => walk({ note: 'fKJDMF3cVb4bWiWRUR20z42FCoOAbZtdxhMy' }), /key-shaped/);
  // Nor is a key-ish field name, wherever the word sits in it.
  for (const bad of ['PUSH_TOKEN', 'STATUS_PUSH_TOKEN', 'rconPassword', 'apiKey', 'privateKey']) {
    assert.throws(() => walk({ [bad]: 'x' }), new RegExp(bad), bad);
  }
  // A name that merely contains an innocent word is still fine.
  assert.doesNotThrow(() => walk({ plan: 'Hobby', provider: 'Railway' }));
});
