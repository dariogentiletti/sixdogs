import { config } from './config.js';
import { RconClient } from './rcon.js';
import { createPool, migrate } from './db.js';
import { Poller } from './poller.js';
import { Verifier } from './verify.js';
import { createApi } from './api.js';

const REQUIRED_ROUTES = [
  ['GET', '/v1/status'],
  ['GET', '/v1/players'],
];

async function loadCapabilitiesWithRetry(rcon) {
  for (let attempt = 1; ; attempt++) {
    try {
      const caps = await rcon.loadCapabilities();
      console.log(`[core] connected to WARDOGS RCON (api ${caps?.apiVersion ?? '?'}, build ${caps?.build ?? '?'})`);
      return caps;
    } catch (err) {
      if (err.code === 'auth') {
        console.error('[core] The game server rejected RCON_PASSWORD. Fix it in your settings: .env, or the variables set by your host, then restart.');
      } else {
        console.warn(`[core] can't reach RCON yet (${err.message}). Retrying in 30s...`);
        if (attempt === 1) {
          console.warn('[core] If this keeps happening: ask your host whether RCON is enabled (bEnabled=true) and bound to an address this machine can reach — it defaults to 127.0.0.1 only.');
        }
      }
      await new Promise((r) => setTimeout(r, 30_000));
    }
  }
}

// Started by run.mjs: exit when it does, so closing the window never leaves an old copy running.
if (process.env.SIXDOGS_SUPERVISED === '1') {
  process.stdin.on('end', () => process.exit(0));
  process.stdin.on('close', () => process.exit(0));
  process.stdin.resume();
}

async function main() {
  const pool = await createPool(config.databaseUrl, config.dataDir);
  await migrate(pool);
  console.log('[core] database ready');

  const rcon = new RconClient({ baseUrl: config.rconUrl, password: config.rconPassword, timeoutMs: config.requestTimeoutMs });
  const poller = new Poller({ rcon, pool, config });
  await poller.init();
  const verifier = new Verifier({ pool, rcon, poller, ttlSec: config.verifyCodeTtlSec });

  const api = createApi({ pool, poller, verifier, rcon, config });
  api.listen(config.port, () => console.log(`[core] internal API on :${config.port}`));

  await loadCapabilitiesWithRetry(rcon);
  const missing = REQUIRED_ROUTES.filter(([m, p]) => !rcon.has(m, p));
  if (missing.length) {
    console.error(`[core] This server build lacks ${missing.map((r) => r.join(' ')).join(', ')} — polling can't work.`);
  }
  if (!rcon.has('POST', '/v1/players/{steamId}/message')) {
    console.warn('[core] This server build has no private player messages: /verify and commander whispers will not work.');
  }
  // Server ID: players can type it in the game's "Join by ID" box. Shown on the Discord live board.
  if (rcon.has('GET', '/v1/server-id')) {
    try { poller.state.serverId = (await rcon.serverId())?.serverId ?? null; } catch { /* optional */ }
  }
  poller.start();

  const shutdown = async (sig) => {
    console.log(`[core] ${sig} received, shutting down`);
    poller.stop();
    api.close();
    await pool.end().catch(() => {});
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('[core] fatal:', err);
  process.exit(1);
});
