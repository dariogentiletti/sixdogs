// The bill people see is generated from stack.json, so it cannot drift from
// what SIXDOGS actually runs on. These tests are the guard on that.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { costsFromStack, loadFacts, STACK_PATH } from '../../tools/facts.mjs';

const stack = JSON.parse(readFileSync(STACK_PATH, 'utf8'));

test('every real service reaches the bill, and the total is their sum', () => {
  const { items, total } = costsFromStack(stack);
  const billed = stack.services.filter((s) => s.onBill !== false);
  assert.equal(items.length, billed.length, 'no service silently missing from the bill');
  const sum = billed.reduce((n, s) => n + Number(s.monthlyUsd), 0);
  assert.ok(total.includes(String(sum)), `total should contain ${sum}, got "${total}"`);
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
        assert.doesNotMatch(k, /^(password|secret|token|api[_-]?key|credential)/i,
          `${path}${k} looks like somewhere a secret would end up`);
        if (!k.startsWith('_') && k !== 'notes' && k !== 'what' && k !== 'howTo') {
          walk(v, `${path}${k}.`);
        }
      }
    } else if (typeof node === 'string') {
      // A long unbroken run of random-looking characters is what a leaked key
      // looks like. Real values here are prices, names and short plan labels.
      assert.doesNotMatch(node, /\b[A-Za-z0-9_-]{24,}\b/, `${path} holds something key-shaped`);
    }
  };
  walk(JSON.parse(readFileSync(STACK_PATH, 'utf8')));
});
