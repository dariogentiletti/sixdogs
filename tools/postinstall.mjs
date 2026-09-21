// Installs the core and bot dependencies after `npm install` at the root.
// Railway needs them; the website build does not.
//
// Cloudflare Pages builds only the website (tools/build.mjs), which needs
// nothing but Node itself. Pages still runs `npm install` because there is a
// package.json here, so without this check it would download discord.js,
// Postgres and PGlite just to render one static HTML file. CF_PAGES is set to
// "1" by Cloudflare's build image on every Pages build.
import { spawnSync } from 'node:child_process';

if (process.env.CF_PAGES) {
  console.log('[postinstall] Cloudflare Pages build: the website needs no dependencies, skipping.');
  process.exit(0);
}

for (const dir of ['core', 'bot']) {
  const r = spawnSync('npm', ['--prefix', dir, 'install', '--omit=dev', '--no-audit', '--no-fund'], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (r.status !== 0) {
    console.error(`[postinstall] npm install failed in ${dir}/`);
    process.exit(r.status ?? 1);
  }
}
