import { fileURLToPath } from 'node:url';

// All settings come from environment variables (see ../../.env.example).

function required(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`[config] Missing required environment variable ${name}. See .env.example.`);
    process.exit(1);
  }
  return v;
}

function num(name, fallback) {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) {
    console.error(`[config] ${name} must be a number, got "${v}"`);
    process.exit(1);
  }
  return n;
}

let rconUrl = required('RCON_URL').trim().replace(/\/+$/, '');
// The WARDOGS RCON listener is plain HTTP. An https:// URL will simply fail, so
// refuse it loudly instead of "fixing" it silently.
if (rconUrl.startsWith('https://')) {
  console.error('[config] RCON_URL must start with http:// — the WARDOGS RCON listener does not speak HTTPS.');
  process.exit(1);
}
if (!rconUrl.startsWith('http://')) rconUrl = `http://${rconUrl}`;

export const config = {
  rconUrl,
  rconPassword: required('RCON_PASSWORD'),
  databaseUrl: process.env.DATABASE_URL || null, // unset = built-in database
  dataDir: process.env.DATA_DIR || fileURLToPath(new URL('../../data', import.meta.url)),
  internalToken: required('INTERNAL_TOKEN'),
  port: num('CORE_PORT', 8080),
  pollIntervalMs: Math.max(3000, num('POLL_INTERVAL_MS', 5000)), // never faster than 3s
  slowPollIntervalMs: num('SLOW_POLL_INTERVAL_MS', 10000),
  healthCheckEveryMs: num('HEALTH_CHECK_EVERY_MS', 60000),
  backpressureDepth: num('BACKPRESSURE_QUEUE_DEPTH', 5),
  sampleRetentionDays: num('SAMPLE_RETENTION_DAYS', 14),
  verifyCodeTtlSec: num('VERIFY_CODE_TTL_SEC', 600),
  verifyCodeDigits: num('VERIFY_CODE_DIGITS', 3), // shorter is friendlier to type; see MAX_ATTEMPTS in verify.js
  ratingWindowDays: num('RATING_WINDOW_DAYS', 60),
  // Seeding: pledges in Discord that add up to a "come and play" ping.
  seedTarget: Math.max(2, num('SEED_TARGET', 10)),
  seedPledgeMinutes: Math.max(5, num('SEED_PLEDGE_MINUTES', 45)),
  seedCooldownMinutes: Math.max(3, num('SEED_COOLDOWN_MINUTES', 45)),
  // Don't call anyone in once this many are already playing. 0 = same as the target.
  seedQuietAbove: num('SEED_QUIET_ABOVE', 0) || null,
  ratingVoteMinutes: num('RATING_VOTE_MINUTES', 30),
  requestTimeoutMs: num('RCON_TIMEOUT_MS', 4000),
};
