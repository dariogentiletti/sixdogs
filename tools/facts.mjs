// Loads community.json (what players see) plus stack.json (what it all runs on and
// costs) and fills templates with them. The `costs` block is derived from
// stack.json, so the bill cannot drift from the real stack.
// Used by the bot for the Discord posts and by tools/build.mjs for the website.
//
// Template syntax (the same in .md and .html):
//   {{donate.url}}                          a value (arrays of text join with blank lines)
//   {{#if donate.url}} ... {{else}} ... {{/if}}
//   {{#each costs.items}} {{item}}: {{monthly}} {{/each}}   ({{this}} = the item itself)
// A missing key is an error, so a typo shows up instead of printing nothing.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const FACTS_PATH = join(ROOT, 'community.json');
export const STACK_PATH = join(ROOT, 'stack.json');

const money = (n) => (n === 0 ? 'free' : `$${Number(n).toLocaleString('en-US')}`);

/**
 * Turn stack.json into the `costs` the templates already expect, so the bill on
 * the website and in #support-the-community is generated from what SIXDOGS
 * actually runs on. Add a service to stack.json and it shows up in both; there
 * is no second list to remember.
 *
 * A figure that hasn't been checked against a real invoice is shown as "about",
 * so nobody reads a guess as exact on a page asking for money.
 */
export function costsFromStack(stack) {
  const billed = (stack.services ?? []).filter((s) => s.onBill !== false);
  const items = billed.map((s) => ({
    item: s.name,
    monthly: s.confirmed || s.monthlyUsd === 0 ? money(s.monthlyUsd) : `about ${money(s.monthlyUsd)}`,
  }));
  const total = billed.reduce((sum, s) => sum + (Number(s.monthlyUsd) || 0), 0);
  const anyEstimated = billed.some((s) => !s.confirmed && s.monthlyUsd !== 0);
  return { items, total: `${anyEstimated ? 'about ' : ''}${money(total)}` };
}

export function loadFacts(path = FACTS_PATH, stackPath = STACK_PATH) {
  const facts = JSON.parse(readFileSync(path, 'utf8'));
  const stack = JSON.parse(readFileSync(stackPath, 'utf8'));
  const { items, total } = costsFromStack(stack);
  // `leftover` is wording and stays in community.json; the numbers come from the stack.
  facts.costs = { ...(facts.costs ?? {}), items, total };
  return facts;
}

const HTML_ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => HTML_ESC[c]);

function lookup(path, scopes) {
  if (path === 'this') return scopes[0];
  const parts = path.split('.');
  for (const scope of scopes) {
    let v = scope;
    let ok = true;
    for (const p of parts) {
      if (v !== null && typeof v === 'object' && p in v) v = v[p];
      else { ok = false; break; }
    }
    if (ok) return v;
  }
  throw new Error(`community.json has no "${path}"`);
}

const truthy = (v) => (Array.isArray(v) ? v.length > 0 : !!v);

// Tokenise into text, {{x}}, {{#if x}}, {{else}}, {{/if}}, {{#each x}}, {{/each}} and build a tree.
function parse(src) {
  const re = /\{\{\s*(#if|#each|\/if|\/each|else)?\s*([\w.]*)\s*\}\}/g;
  const root = { kind: 'root', body: [] };
  const stack = [{ node: root, target: root.body }];
  let last = 0, m;
  const top = () => stack[stack.length - 1];
  while ((m = re.exec(src))) {
    if (m.index > last) top().target.push({ kind: 'text', text: src.slice(last, m.index) });
    last = re.lastIndex;
    const [, tag, name] = m;
    if (tag === '#if' || tag === '#each') {
      const node = { kind: tag.slice(1), name, body: [], alt: [] };
      top().target.push(node);
      stack.push({ node, target: node.body });
    } else if (tag === 'else') {
      if (top().node.kind !== 'if') throw new Error('{{else}} outside {{#if}}');
      top().target = top().node.alt;
    } else if (tag === '/if' || tag === '/each') {
      const { node } = stack.pop();
      if (!node || node.kind !== tag.slice(1)) throw new Error(`${m[0]} doesn't match its opening tag`);
    } else if (!name) {
      top().target.push({ kind: 'text', text: m[0] }); // a bare {{ }} stays as written
    } else {
      top().target.push({ kind: 'var', name });
    }
  }
  if (stack.length > 1) throw new Error(`{{#${top().node.kind} ${top().node.name}}} is never closed`);
  if (last < src.length) top().target.push({ kind: 'text', text: src.slice(last) });
  return root;
}

function run(nodes, scopes, esc) {
  let out = '';
  for (const n of nodes) {
    if (n.kind === 'text') out += n.text;
    else if (n.kind === 'var') {
      const v = lookup(n.name, scopes);
      const s = Array.isArray(v) ? v.join('\n\n') : v === null || v === undefined ? '' : String(v);
      out += esc(s);
    } else if (n.kind === 'if') {
      out += run(truthy(lookup(n.name, scopes)) ? n.body : n.alt, scopes, esc);
    } else if (n.kind === 'each') {
      const list = lookup(n.name, scopes);
      if (!Array.isArray(list)) throw new Error(`"${n.name}" is not a list`);
      for (const item of list) out += run(n.body, [item, ...scopes], esc);
    }
  }
  return out;
}

/** Fill a template. `html: true` escapes values for HTML. */
export function render(src, facts, { html = false } = {}) {
  return run(parse(src).body, [facts], html ? escapeHtml : (s) => s);
}

