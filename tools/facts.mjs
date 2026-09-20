// Loads community.json (the one place for SIXDOGS facts) and fills templates with it.
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

export const FACTS_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', 'community.json');

export function loadFacts(path = FACTS_PATH) {
  return JSON.parse(readFileSync(path, 'utf8'));
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

