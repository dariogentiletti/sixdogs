import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Every source file has to PARSE, including the ones no test imports.
//
// This exists because of a real outage. `bot/src/index.js` is the entry point,
// so nothing imports it and no test ever loaded it. A second `import { Events }`
// was added next to discord.js's own `Events`, which is a SyntaxError — the bot
// died on startup on Railway, took core down with it, and all 210 tests were
// green the whole time.
//
// `node --check` parses a file without running it, so it catches exactly that
// class of mistake: duplicate declarations, a stray bracket, a bad import. It
// cannot catch anything that only happens at run time, and it is not trying to.

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function sources(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.git' || name === 'data' || name.startsWith('data-')) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...sources(path));
    else if (/\.m?js$/.test(name)) out.push(path);
  }
  return out;
}

test('every source file parses, including the entry points nothing imports', () => {
  const files = [
    ...sources(join(root, 'bot', 'src')),
    ...sources(join(root, 'core', 'src')),
    ...sources(join(root, 'tools')),
    ...sources(join(root, 'mock')),
    join(root, 'run.mjs'),
  ];
  // The entry points are the whole reason this test exists, so fail loudly if
  // they ever stop being in the list.
  for (const must of ['bot/src/index.js', 'core/src/index.js', 'run.mjs']) {
    assert.ok(files.some((f) => f.endsWith(must)), `${must} is not being checked`);
  }

  const broken = [];
  for (const file of files) {
    try {
      execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
    } catch (err) {
      broken.push(`${file.slice(root.length + 1)}: ${String(err.stderr).trim().split('\n').slice(-1)[0]}`);
    }
  }
  assert.deepEqual(broken, [], `\n${broken.join('\n')}`);
});
