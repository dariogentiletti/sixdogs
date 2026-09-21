// Rebuilds everything that is made from community.json:
//   website-src/index.html  ->  website/index.html
//   website/_redirects      (sixdogs.gg/discord, /join, /donate)
// and checks every Discord post template in content/ still fills in.
// Run from the SIXDOGS folder:  node tools/build.mjs
// (The guide pictures are rebuilt separately: design/verify-guide/build_panels.py.)

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadFacts, render } from './facts.mjs';

/**
 * Which commit this page was built from. Cloudflare Pages sets
 * CF_PAGES_COMMIT_SHA; locally we ask git. Stamped into the page so anyone can
 * answer "is the site serving my latest push?" by looking, instead of guessing.
 * A day was lost to a stale deploy that looked identical to a working one.
 */
function buildStamp() {
  const sha = process.env.CF_PAGES_COMMIT_SHA
    || (() => {
      try { return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(); }
      catch { return null; }
    })();
  return { sha: sha ? sha.slice(0, 7) : 'unknown', at: new Date().toISOString() };
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const facts = loadFacts();
const done = [];
const warn = [];

// Website page.
const stamp = buildStamp();
const page = render(readFileSync(join(root, 'website-src/index.html'), 'utf8'), facts, { html: true })
  .replace('<head>', '<head>\n<!-- Made by tools/build.mjs from website-src/index.html and community.json. Edit those, not this file. -->'
    + `\n<meta name="sixdogs-build" content="${stamp.sha} ${stamp.at}">`);
writeFileSync(join(root, 'website/index.html'), page);
done.push('website/index.html');

// Short links.
const redirects = [
  '# Made by tools/build.mjs from community.json. Edit that file, not this one.',
  `/discord   ${facts.discordInvite}   302`,
  `/join      ${facts.discordInvite}   302`,
];
if (facts.donate?.url) redirects.push(`/donate    ${facts.donate.url}   302`);
writeFileSync(join(root, 'website/_redirects'), redirects.join('\n') + '\n');
done.push('website/_redirects');

// Discord posts: the bot fills them when it starts; here we only check they still work.
for (const f of readdirSync(join(root, 'content')).filter((n) => n.endsWith('.md'))) {
  const text = readFileSync(join(root, 'content', f), 'utf8');
  if (!text.includes('{{')) continue;
  try { render(text, facts); done.push(`content/${f} (checked)`); }
  catch (err) { warn.push(`content/${f}: ${err.message}`); }
}

if (/YOURCODE/.test(facts.discordInvite)) warn.push('discordInvite still says YOURCODE');
if (!facts.donate?.url) warn.push(`donate.url is empty, so the ${facts.donate?.platform ?? 'donate'} button is hidden`);

console.log(`Built (${stamp.sha}):\n  ` + done.join('\n  '));
if (warn.length) console.log('Heads up:\n  ' + warn.join('\n  '));
if (warn.some((w) => w.startsWith('content/'))) process.exit(1);
