// Starts SIXDOGS without Docker: core + bot (+ the fake game server with --mock).
//
//   node run.mjs --mock    practice run against a fake WARDOGS server
//   node run.mjs           real game server (RCON_URL / RCON_PASSWORD from .env);
//                          with no game server configured yet, runs the Discord side only
//                          (/setup-server, #roles) and skips everything game-related.
//
// Reads settings from .env next to this file. Ctrl+C stops everything.

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const mock = process.argv.includes('--mock');
const isWin = process.platform === 'win32';

function fail(msg) {
  console.error(`\n  ✖ ${msg}\n`);
  process.exit(1);
}

// ---- Node version ----
const major = Number(process.versions.node.split('.')[0]);
if (major < 20) fail(`Node.js ${process.versions.node} is too old. Install the LTS version from https://nodejs.org`);

// ---- .env ----
const envPath = join(root, '.env');
if (!existsSync(envPath)) fail('No .env file. Copy .env.example to .env and fill in DISCORD_TOKEN and DISCORD_GUILD_ID.');
const env = {};
for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
  if (!m || line.trim().startsWith('#')) continue;
  env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
}
if (!env.DISCORD_TOKEN) fail('DISCORD_TOKEN is empty in .env (Developer Portal → your app → Bot → Reset Token).');
if (!env.DISCORD_GUILD_ID) fail('DISCORD_GUILD_ID is empty in .env (right-click your server icon → Copy Server ID).');
if (!env.INTERNAL_TOKEN || env.INTERNAL_TOKEN.startsWith('make-up')) env.INTERNAL_TOKEN = randomBytes(24).toString('hex');
let discordOnly = false;
if (mock) {
  env.RCON_URL = 'http://127.0.0.1:7776';
  env.RCON_PASSWORD = 'test';
} else {
  const noUrl = !env.RCON_URL || env.RCON_URL.includes('203.0.113.10');
  const noPass = !env.RCON_PASSWORD || env.RCON_PASSWORD === 'change-me';
  if (noUrl || noPass) discordOnly = true; // no game server yet: Discord features only
}
// Built-in database unless a real Postgres URL is given.
if (env.DATABASE_URL === '') delete env.DATABASE_URL;

// ---- dependencies ----
for (const dir of ['core', 'bot']) {
  if (!existsSync(join(root, dir, 'node_modules'))) {
    console.log(`Installing ${dir} dependencies (first run only)...`);
    const r = spawnSync(isWin ? 'npm.cmd' : 'npm', ['install', '--omit=dev', '--no-audit', '--no-fund'], {
      cwd: join(root, dir), stdio: 'inherit', shell: isWin,
    });
    if (r.status !== 0) fail(`npm install failed in ${dir}/. Check your internet connection and try again.`);
  }
}

// ---- processes ----
const colors = { mock: 35, core: 36, bot: 33 };
const children = [];
let stopping = false;

function start(name, script, extraEnv) {
  const child = spawn(process.execPath, [script], {
    cwd: join(root, name === 'mock' ? 'mock' : name),
    env: { ...process.env, ...extraEnv, SIXDOGS_SUPERVISED: '1' },
    // stdin is a pipe from this process: if this window is closed, the pipe
    // breaks and the child exits too (no orphaned old bot left running).
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const prefix = `\x1b[${colors[name]}m${name.padEnd(4)}\x1b[0m │ `;
  const pipe = (stream, out) => {
    let buf = '';
    stream.on('data', (d) => {
      buf += d;
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const l of lines) out.write(prefix + l + '\n');
    });
  };
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  child.on('exit', (code) => {
    if (stopping) return;
    console.error(`${prefix}stopped (exit code ${code}). Stopping everything.`);
    shutdown(code || 1);
  });
  children.push(child);
  return child;
}

function shutdown(code = 0) {
  stopping = true;
  for (const c of children) c.kill();
  setTimeout(() => process.exit(code), 500);
}
process.on('SIGINT', () => { console.log('\nStopping...'); shutdown(0); });

const coreEnv = {
  RCON_URL: env.RCON_URL,
  RCON_PASSWORD: env.RCON_PASSWORD,
  INTERNAL_TOKEN: env.INTERNAL_TOKEN,
  CORE_PORT: env.CORE_PORT || '8080',
  // Practice data is kept separate so fake links never leak into the real setup.
  DATA_DIR: env.DATA_DIR || process.env.DATA_DIR || join(root, mock ? 'data-practice' : 'data'),
  ...(env.DATABASE_URL ? { DATABASE_URL: env.DATABASE_URL } : {}),
  ...Object.fromEntries(Object.entries(env).filter(([k]) => /^(POLL_|SLOW_POLL|SAMPLE_|VERIFY_|RCON_TIMEOUT|DATA_DIR|HEALTH_|BACKPRESSURE|RATING_)/.test(k))),
};
// The bot gets everything EXCEPT the RCON password and database URL.
const { RCON_PASSWORD, DATABASE_URL, POSTGRES_PASSWORD, ...botBase } = env;
const botEnv = { ...botBase, CORE_URL: `http://127.0.0.1:${coreEnv.CORE_PORT}`, ...(discordOnly ? { CORE_DISABLED: '1' } : {}) };

async function waitForCore() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`${botEnv.CORE_URL}/internal/health`);
      if (r.ok) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
}

console.log(mock
  ? '\n  SIXDOGS practice mode — fake game server on http://localhost:7776\n  Open http://localhost:7776 in your browser to see verification codes and start new matches.\n  Press Ctrl+C to stop.\n'
  : discordOnly
    ? '\n  SIXDOGS — Discord only (no game server in .env yet)\n  Works now: /setup-server, the #roles menu, admin commands.\n  Waits for a game server: /verify, faction roles, commander picks.\n  Press Ctrl+C to stop.\n'
    : `\n  SIXDOGS — game server ${env.RCON_URL}\n  Press Ctrl+C to stop.\n`);

if (discordOnly) {
  start('bot', 'src/index.js', botEnv);
} else {
  if (mock) start('mock', 'mock-wardogs.mjs', {});
  await new Promise((r) => setTimeout(r, mock ? 500 : 0));
  start('core', 'src/index.js', coreEnv);
  await waitForCore();
  start('bot', 'src/index.js', botEnv);
}
